/**
 * IdentityEngine — assembles Career Identity profiles from evidence.
 * Careers are evidence only; graph nodes are always identity traits.
 */

const User = require('../../models/User');
const CareerIdentityProfile = require('../../models/CareerIdentityProfile');
const {
  listTraitDefinitions,
  getTraitDefinition,
} = require('../../../constants/identityTraitCatalog');
const {
  processUserEvidence,
  computeSourceFingerprint,
} = require('./evidenceProcessor');
const {
  calculateTraitConfidence,
  calculateConnectionStrength,
} = require('./traitConfidenceCalculator');
const {
  classifyIdentityLayer,
  getLayerStatusMessage,
  selectPuzzleTraits,
  IDENTITY_LAYERS,
} = require('../../../constants/identityPuzzleThresholds');
const { normalizeOverlapKey } = require('./evidenceTextUtils');
const {
  applyTraitVotesToEvidence,
  upsertTraitVoteList,
  getTraitVoteFromList,
  normalizeTraitVote,
  buildVoteWouldRemoveMap,
  evidenceMapFromCachedTraits,
} = require('./traitVoteEvidence');
const {
  computeIdentityEngineFingerprint,
  shouldReuseCachedIdentity,
} = require('./identityEngineFingerprint');
const {
  emitIdentityEvent,
  IDENTITY_PIPELINE_EVENTS,
} = require('./pipeline/identityEventBus');
const logger = require('../../utils/logger');

function localize(localized, lang) {
  if (!localized || typeof localized !== 'object') return '';
  const code = String(lang || 'en').toLowerCase().split('-')[0];
  return localized[code] || localized.en || localized.de || '';
}

function isVersionConflictError(err) {
  return Boolean(
    err
    && (err.name === 'VersionError'
      || err.name === 'DocumentNotFoundError'
      || /No matching document found for id/i.test(String(err.message || '')))
  );
}

/**
 * Persist identity profile fields with retries for concurrent writers
 * (page load refresh + pipeline + votes often race on the same doc).
 */
async function saveIdentityProfileWithRetry(profile, fields, { userId, maxAttempts = 3 } = {}) {
  let doc = profile;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      if (!doc) {
        doc = new CareerIdentityProfile({ userId });
      }
      Object.assign(doc, fields);
      if (Object.prototype.hasOwnProperty.call(fields, 'timeline')) {
        doc.set('timeline', fields.timeline, { strict: false });
      }
      await doc.save();
      return doc;
    } catch (err) {
      lastError = err;
      if (!isVersionConflictError(err) || attempt >= maxAttempts) {
        throw err;
      }
      logger.warn('identity.engine.save_version_conflict_retry', {
        userId: String(userId || doc?.userId || ''),
        attempt,
        maxAttempts,
        version: doc?.__v,
      });
      const fresh = doc?._id
        ? await CareerIdentityProfile.findById(doc._id)
        : await CareerIdentityProfile.findOne({ userId });
      doc = fresh || new CareerIdentityProfile({ userId });
    }
  }

  throw lastError || new Error('Failed to save career identity profile');
}

function dedupeEvidence(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const content = normalizeOverlapKey(item.contentKey || '');
    // Prefer content-based dedupe so the same phrase from reflection + narrative
    // does not appear twice under different source labels.
    const key = content
      ? `content:${content}`
      : item.evidenceId || `${item.sourceType}:${item.sourceId}:${item.explanation?.en}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function buildConnections(traits) {
  const byId = new Map(traits.map((t) => [t.traitId, t]));
  const edgeKeys = new Set();
  const connections = [];

  for (const trait of traits) {
    const def = getTraitDefinition(trait.traitId);
    if (!def) continue;
    for (const relatedId of def.relatedTraitIds || []) {
      if (!byId.has(relatedId)) continue;
      const key = [trait.traitId, relatedId].sort().join('::');
      if (edgeKeys.has(key)) continue;
      edgeKeys.add(key);
      const other = byId.get(relatedId);
      connections.push({
        fromTraitId: trait.traitId,
        toTraitId: relatedId,
        strength: calculateConnectionStrength(trait.confidence, other.confidence),
      });
    }
  }
  return connections;
}

function layerSortRank(layer) {
  return layer === IDENTITY_LAYERS.CONFIRMED ? 0 : 1;
}

/**
 * Seed positions by identity category (sectors), then separate overlaps.
 * Confirmed pieces sit in the main cluster; emerging pieces orbit farther out.
 * Coordinates are normalized (~[-1, 1]); the client fine-tunes by pixel size.
 */
function assignGraphLayout(traits) {
  const count = traits.length || 1;
  const minSeparation = Math.min(0.42, 0.9 / Math.sqrt(count));

  const categoryOrder = [];
  const byCategory = new Map();
  for (const trait of traits) {
    const category = trait.category || 'other';
    if (!byCategory.has(category)) {
      byCategory.set(category, []);
      categoryOrder.push(category);
    }
    byCategory.get(category).push(trait);
  }

  const categoryCount = Math.max(1, categoryOrder.length);
  const placed = [];

  categoryOrder.forEach((category, catIndex) => {
    const members = byCategory
      .get(category)
      .slice()
      .sort((a, b) => {
        const layerDiff = layerSortRank(a.layer) - layerSortRank(b.layer);
        if (layerDiff !== 0) return layerDiff;
        return (Number(b.confidence) || 0) - (Number(a.confidence) || 0);
      });
    const sectorAngle = (catIndex / categoryCount) * Math.PI * 2 - Math.PI / 2;
    const clusterNorm = 0.4 + (catIndex % 2) * 0.06;
    const spread = Math.min(0.7, 0.22 + members.length * 0.08);

    members.forEach((trait, i) => {
      const isEmerging = trait.layer === IDENTITY_LAYERS.EMERGING;
      const localAngle =
        members.length === 1 ? 0 : ((i / (members.length - 1)) - 0.5) * 2 * spread;
      const angle = sectorAngle + localAngle;
      const baseRadius = isEmerging
        ? 0.72 + (i % 3) * 0.05
        : clusterNorm - (Number(trait.confidence) || 0) * 0.16 + (i % 3) * 0.03;
      const radius = Math.max(0.14, Math.min(0.95, baseRadius));
      placed.push({
        ...trait,
        position: {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          radius,
          angle,
        },
      });
    });
  });

  for (let iter = 0; iter < 60; iter += 1) {
    let moved = false;
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i].position;
        const b = placed[j].position;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 1e-4) {
          const angle = (i * 2.399963229728653) % (Math.PI * 2);
          dx = Math.cos(angle);
          dy = Math.sin(angle);
          dist = 1e-4;
        }
        if (dist >= minSeparation) continue;
        const push = (minSeparation - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        a.x -= ux * push;
        a.y -= uy * push;
        b.x += ux * push;
        b.y += uy * push;
        moved = true;
      }
    }

    for (const trait of placed) {
      const pos = trait.position;
      const dist = Math.hypot(pos.x, pos.y) || 0.001;
      const target = Math.max(0.18, Math.min(0.95, pos.radius));
      pos.x += ((pos.x / dist) * target - pos.x) * 0.08;
      pos.y += ((pos.y / dist) * target - pos.y) * 0.08;
      const clamped = Math.hypot(pos.x, pos.y);
      if (clamped > 0.98) {
        pos.x = (pos.x / clamped) * 0.98;
        pos.y = (pos.y / clamped) * 0.98;
      }
      pos.angle = Math.atan2(pos.y, pos.x);
      pos.radius = Math.hypot(pos.x, pos.y);
    }

    if (!moved) break;
  }

  return placed;
}

/**
 * Resolve puzzle layer for a stored or freshly assembled trait.
 * Always derived from confidence so cached profiles follow current thresholds.
 * @param {{ confidence?: number }} trait
 * @returns {'confirmed'|'emerging'|null}
 */
function resolveTraitLayer(trait) {
  return classifyIdentityLayer(trait?.confidence);
}

/**
 * Build trait snapshots from an evidence map.
 * Only traits at or above the emerging threshold become puzzle pieces.
 */
function assembleTraits(evidenceByTrait) {
  const traits = [];
  for (const def of listTraitDefinitions()) {
    const evidence = dedupeEvidence(evidenceByTrait.get(def.id) || []);
    if (evidence.length === 0) continue;
    const confidence = calculateTraitConfidence(evidence);
    const layer = classifyIdentityLayer(confidence);
    if (!layer) continue;

    const lastUpdated = evidence.reduce((max, e) => {
      const ts = e.timestamp ? new Date(e.timestamp) : new Date(0);
      return ts > max ? ts : max;
    }, new Date(0));

    traits.push({
      traitId: def.id,
      category: def.category,
      confidence,
      layer,
      evidenceCount: evidence.length,
      evidence,
      lastUpdated: lastUpdated.getTime() ? lastUpdated : new Date(),
    });
  }

  return selectPuzzleTraits(traits);
}

async function loadUser(userId) {
  const user = await User.findById(userId).lean();
  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }
  return user;
}

/**
 * Recompute and persist the user's Career Identity profile.
 *
 * @param {string} userId
 * @param {{
 *   language?: string,
 *   force?: boolean,
 *   votesOnly?: boolean,
 *   skipPipelineEmit?: boolean,
 *   profile?: object,
 *   additionalEvidence?: object[],
 * }} [options]
 */
async function refreshIdentity(userId, options = {}) {
  const user = await loadUser(userId);
  const fingerprint = computeSourceFingerprint(user);
  const engineFingerprint = computeIdentityEngineFingerprint();
  const language = options.language === 'en' ? 'en' : 'de';

  let profile = options.profile || await CareerIdentityProfile.findOne({ userId });
  if (!options.force && !options.votesOnly && shouldReuseCachedIdentity(profile, fingerprint, engineFingerprint)) {
    return serializeProfile(profile, language);
  }

  const traitVotes = Array.isArray(profile?.traitVotes)
    ? profile.traitVotes.map((entry) => ({
        traitId: entry.traitId,
        vote: entry.vote,
        updatedAt: entry.updatedAt,
      }))
    : [];

  const canReuseEvidenceForVotes =
    Boolean(options.votesOnly)
    && !options.force
    && shouldReuseCachedIdentity(profile, fingerprint, engineFingerprint);

  let evidenceByTrait;
  if (canReuseEvidenceForVotes) {
    evidenceByTrait = evidenceMapFromCachedTraits(profile.traits);
    logger.info('identity.engine.votes_only_recompute', {
      userId: String(userId),
      cachedTraitCount: Array.isArray(profile.traits) ? profile.traits.length : 0,
      voteCount: traitVotes.length,
    });
  } else {
    ({ evidenceByTrait } = await processUserEvidence(user, options));
  }

  applyTraitVotesToEvidence(evidenceByTrait, traitVotes, userId);
  const traits = assembleTraits(evidenceByTrait);
  const connections = buildConnections(traits);

  profile = await saveIdentityProfileWithRetry(
    profile,
    {
      traits,
      connections,
      traitVotes,
      timeline: undefined,
      lastRefreshedAt: new Date(),
      sourceFingerprint: fingerprint,
      engineFingerprint,
      language,
    },
    { userId }
  );

  const identity = serializeProfile(profile, language);

  // Event-driven exploration pipeline (handlers registered at server startup).
  // Emitted only on actual recompute — not on cache reuse.
  if (!options.skipPipelineEmit) {
    try {
      emitIdentityEvent(IDENTITY_PIPELINE_EVENTS.PUZZLE_UPDATED, {
        userId: String(userId),
        identity,
        traits: traits.map((t) => ({
          traitId: t.traitId,
          category: t.category,
          confidence: t.confidence,
          layer: t.layer,
        })),
        language,
        force: Boolean(options.force),
      });
    } catch (err) {
      logger.error('identity.engine.puzzle_updated_emit_failed', {
        userId: String(userId),
        error: err,
      });
    }
  }

  return identity;
}

/**
 * Get identity profile, refreshing when user sources or engine config drift.
 */
async function getIdentity(userId, options = {}) {
  return refreshIdentity(userId, { ...options, force: false });
}

/**
 * Force recompute.
 */
async function forceRefreshIdentity(userId, options = {}) {
  return refreshIdentity(userId, { ...options, force: true });
}

function serializeTraitDetail(trait, language, userVote = null, userId = '') {
  const def = getTraitDefinition(trait.traitId);
  if (!def) return null;

  const layer = resolveTraitLayer(trait);
  if (!layer) return null;

  const statusLocalized = getLayerStatusMessage(layer);
  const voteWouldRemove = buildVoteWouldRemoveMap(
    trait.evidence,
    trait.traitId,
    userId || 'user'
  );

  return {
    id: trait.traitId,
    category: trait.category || def.category,
    name: localize(def.name, language),
    nameLocalized: def.name,
    description: localize(def.description, language),
    descriptionLocalized: def.description,
    confidence: trait.confidence,
    confidencePercent: Math.round((trait.confidence || 0) * 100),
    layer,
    statusMessage: statusLocalized ? localize(statusLocalized, language) : null,
    statusMessageLocalized: statusLocalized,
    userVote: normalizeTraitVote(userVote),
    voteWouldRemove,
    /** @deprecated Use voteWouldRemove.reject */
    rejectWouldRemove: voteWouldRemove.reject,
    evidenceCount: trait.evidenceCount || (trait.evidence || []).length,
    evidence: (trait.evidence || []).map((e) => ({
      evidenceId: e.evidenceId,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      weight: e.weight,
      polarity: e.polarity === 'negative' ? 'negative' : 'positive',
      timestamp: e.timestamp,
      explanation: localize(e.explanation, language),
      explanationLocalized: e.explanation,
      label: localize(e.label, language),
      labelLocalized: e.label,
    })),
    lastUpdated: trait.lastUpdated,
    relatedTraitIds: def.relatedTraitIds || [],
    position: trait.position || null,
  };
}

function serializeProfile(profile, language = 'de') {
  const lean = typeof profile.toObject === 'function' ? profile.toObject() : profile;
  // Re-apply layer rules and display caps so cached profiles stay consistent.
  const puzzleTraits = selectPuzzleTraits(
    (lean.traits || [])
      .map((trait) => {
        const layer = resolveTraitLayer(trait);
        if (!layer) return null;
        return { ...trait, layer };
      })
      .filter(Boolean)
  );

  const traitsWithLayout = assignGraphLayout(puzzleTraits);
  const traitVotes = lean.traitVotes || [];
  const userId = String(lean.userId || '');

  const nodes = traitsWithLayout
    .map((trait) =>
      serializeTraitDetail(
        trait,
        language,
        getTraitVoteFromList(traitVotes, trait.traitId),
        userId
      )
    )
    .filter(Boolean);

  const visibleIds = new Set(nodes.map((n) => n.id));
  const connections = (lean.connections || [])
    .filter((c) => visibleIds.has(c.fromTraitId) && visibleIds.has(c.toTraitId))
    .map((c) => ({
      fromTraitId: c.fromTraitId,
      toTraitId: c.toTraitId,
      strength: c.strength,
    }));

  return {
    id: String(lean._id || ''),
    userId: String(lean.userId),
    lastRefreshedAt: lean.lastRefreshedAt,
    nodes,
    connections,
    empty: nodes.length === 0,
  };
}

/**
 * Trait detail for sidebar.
 */
async function getTraitDetail(userId, traitId, options = {}) {
  const language = options.language === 'en' ? 'en' : 'de';
  const identity = await getIdentity(userId, { language });
  const node = (identity.nodes || []).find((n) => n.id === traitId);
  if (!node) {
    const def = getTraitDefinition(traitId);
    if (!def) {
      const err = new Error('Trait not found');
      err.status = 404;
      throw err;
    }
    const profile = await CareerIdentityProfile.findOne({ userId }).lean();
    return {
      id: def.id,
      category: def.category,
      name: localize(def.name, language),
      description: localize(def.description, language),
      confidence: 0,
      confidencePercent: 0,
      layer: null,
      statusMessage: null,
      userVote: getTraitVoteFromList(profile?.traitVotes, traitId),
      evidenceCount: 0,
      evidence: [],
      relatedTraitIds: def.relatedTraitIds || [],
      empty: true,
    };
  }
  return node;
}

/**
 * Record user feedback on a puzzle piece and recompute identity.
 * Uses a votes-only recompute when the cached profile fingerprints are still
 * valid — skips the expensive semantic evidence pipeline.
 *
 * @param {string} userId
 * @param {string} traitId
 * @param {'confirm'|'unsure'|'reject'|null} vote
 * @param {{ language?: string }} [options]
 */
async function setTraitVote(userId, traitId, vote, options = {}) {
  const language = options.language === 'en' ? 'en' : 'de';
  const def = getTraitDefinition(traitId);
  if (!def) {
    const err = new Error('Trait not found');
    err.status = 404;
    throw err;
  }

  const normalized = normalizeTraitVote(vote);
  if (vote != null && vote !== '' && normalized == null) {
    const err = new Error('Invalid vote. Use confirm, unsure, reject, or null.');
    err.status = 400;
    throw err;
  }

  let profile = await CareerIdentityProfile.findOne({ userId });
  if (!profile) {
    // Ensure a profile shell exists before storing votes.
    await refreshIdentity(userId, { language, force: true, skipPipelineEmit: true });
    profile = await CareerIdentityProfile.findOne({ userId });
  }
  if (!profile) {
    const err = new Error('Failed to initialize career identity');
    err.status = 500;
    throw err;
  }

  const previousVote = getTraitVoteFromList(profile.traitVotes, traitId);
  if (previousVote === normalized) {
    return serializeProfile(profile, language);
  }

  profile.traitVotes = upsertTraitVoteList(profile.traitVotes, traitId, normalized);

  // Re-apply votes on cached trait evidence when sources are unchanged.
  // Falls back to full discovery inside refreshIdentity when fingerprints drift.
  return refreshIdentity(userId, {
    language,
    votesOnly: true,
    profile,
  });
}

module.exports = {
  getIdentity,
  forceRefreshIdentity,
  getTraitDetail,
  setTraitVote,
  serializeProfile,
  assembleTraits,
  buildConnections,
  assignGraphLayout,
  resolveTraitLayer,
  localize,
};
