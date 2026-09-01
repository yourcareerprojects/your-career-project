/**
 * Career Exploration Service
 * ==========================
 *
 * Turns identity-evolution signals into a short, diverse set of job
 * recommendations (5–10), instead of re-showing the globally highest matches.
 *
 * Input
 * -----
 * - deltaJobMatches: [{ role, oldScore, newScore, delta }, ...]
 * - identityChangeScore: number | { changeScore, reasons }
 *
 * Output
 * ------
 *   {
 *     triggerLevel: 'none'|'mild'|'moderate'|'strong',
 *     explorationJobs: [{ role, oldScore, newScore, delta, source }, ...],
 *     explanation: string
 *   }
 *
 * Selection mix (configurable): 40% highest delta, 30% new domains,
 * 20% unexpected, 10% wildcard. Avoids duplicates / rated / accepted jobs.
 * Uses MMR when role embeddings exist; deterministic domain diversity otherwise.
 *
 * Integration status: sessions are persisted + surfaced via identity exploration
 * notification APIs (SSE / latest / seen) and Career Identity discovery UI.
 *
 * @module services/careerIdentity/careerExplorationService
 */

const {
  CAREER_EXPLORATION_MIX,
  CAREER_EXPLORATION_THRESHOLDS,
  CAREER_EXPLORATION_SOURCES,
  CAREER_EXPLORATION_TRIGGER_LEVELS,
} = require('../../../constants/careerExplorationConfig');
const { listTraitDefinitions } = require('../../../constants/identityTraitCatalog');
const { getTraitEmbedding } = require('./traitEmbeddingsStore');
const { cosineSimilarity, mmrSelect } = require('../embedding/embeddingService');
const { getSnapshotDomainIds } = require('./snapshotService');

function resolveConfig(override = {}) {
  const mix = { ...CAREER_EXPLORATION_MIX, ...(override.mix || {}) };
  const thresholds = { ...CAREER_EXPLORATION_THRESHOLDS, ...(override.thresholds || {}) };
  return { mix, thresholds, language: override.language === 'de' ? 'de' : 'en' };
}

/**
 * Largest-remainder allocation so bucket counts sum exactly to targetSize.
 */
function allocateBucketCounts(mix, targetSize) {
  const entries = [
    ['HIGHEST_DELTA', mix.HIGHEST_DELTA],
    ['NEW_DOMAIN', mix.NEW_DOMAIN],
    ['UNEXPECTED', mix.UNEXPECTED],
    ['WILDCARD', mix.WILDCARD],
  ];

  const raw = entries.map(([key, share]) => {
    const exact = Math.max(0, Number(share) || 0) * targetSize;
    return { key, exact, floor: Math.floor(exact), frac: exact - Math.floor(exact) };
  });

  let allocated = raw.reduce((sum, row) => sum + row.floor, 0);
  let remaining = Math.max(0, targetSize - allocated);

  const byFrac = [...raw].sort((a, b) => {
    if (b.frac !== a.frac) return b.frac - a.frac;
    return a.key.localeCompare(b.key);
  });

  const counts = {};
  for (const row of raw) counts[row.key] = row.floor;
  for (const row of byFrac) {
    if (remaining <= 0) break;
    counts[row.key] += 1;
    remaining -= 1;
  }

  allocated = Object.values(counts).reduce((a, b) => a + b, 0);
  if (allocated < targetSize) {
    counts.HIGHEST_DELTA += targetSize - allocated;
  }

  return counts;
}

function resolveTriggerLevel(changeScore, thresholds) {
  const score = Number(changeScore) || 0;
  if (score < thresholds.TRIGGER_NONE_BELOW) return CAREER_EXPLORATION_TRIGGER_LEVELS.NONE;
  if (score < thresholds.TRIGGER_MILD_BELOW) return CAREER_EXPLORATION_TRIGGER_LEVELS.MILD;
  if (score < thresholds.TRIGGER_MODERATE_BELOW) return CAREER_EXPLORATION_TRIGGER_LEVELS.MODERATE;
  return CAREER_EXPLORATION_TRIGGER_LEVELS.STRONG;
}

function normalizeIdentityChange(identityChangeScore) {
  if (typeof identityChangeScore === 'number') {
    return { changeScore: identityChangeScore, reasons: [] };
  }
  if (identityChangeScore && typeof identityChangeScore === 'object') {
    return {
      changeScore: Number(identityChangeScore.changeScore) || 0,
      reasons: Array.isArray(identityChangeScore.reasons)
        ? identityChangeScore.reasons.map(String)
        : [],
    };
  }
  return { changeScore: 0, reasons: [] };
}

function getRoleKey(role) {
  if (!role || typeof role !== 'object') return null;
  const raw =
    role.escoId
    || role.careerPathId
    || role._id
    || role.id
    || role.stepId
    || null;
  if (raw == null) return null;
  return String(raw);
}

function toIdSet(values) {
  const set = new Set();
  for (const value of values || []) {
    if (value == null || value === '') continue;
    set.add(String(value));
  }
  return set;
}

function isExcludedMatch(match, excludedKeys) {
  const key = getRoleKey(match?.role);
  if (!key) return false;
  return excludedKeys.has(key);
}

function getRoleDomainTags(role) {
  if (!role || typeof role !== 'object') return [];
  const tags = new Set();

  const push = (value) => {
    const s = String(value || '').trim();
    if (!s || s === 'UNASSIGNED') return;
    tags.add(s);
    tags.add(s.toLowerCase().replace(/\s+/g, '_'));
  };

  push(role.domain);
  for (const d of role.domains || []) push(d);
  for (const d of role.identityDomains || []) push(d);
  for (const d of role.matchedCategories || []) push(d);
  for (const d of role.categories || []) push(d);

  const skillDomains = role.skillDomains?.skill_domains || role.skill_domains || [];
  for (const entry of skillDomains) {
    const label = entry?.domain?.en || entry?.domain || entry?.name;
    push(label);
  }

  return [...tags];
}

function resolveNewDomains(options = {}) {
  if (Array.isArray(options.newDomains) && options.newDomains.length > 0) {
    return [...new Set(options.newDomains.map((d) => String(d || '').trim()).filter(Boolean))];
  }

  const prev = toIdSet(getSnapshotDomainIds(options.previousIdentity));
  const curr = getSnapshotDomainIds(options.currentIdentity);
  const fromSnapshots = curr.filter((d) => !prev.has(d));
  if (fromSnapshots.length > 0) return fromSnapshots;

  const reasons = normalizeIdentityChange(options.identityChangeScore).reasons;
  const fromReasons = [];
  for (const reason of reasons) {
    const match = String(reason).match(/^New\s+(.+?)\s+domain$/i);
    if (!match) continue;
    const slug = match[1].trim().toLowerCase().replace(/\s+/g, '_');
    if (slug) fromReasons.push(slug);
  }
  return [...new Set(fromReasons)];
}

function scoreNewDomainAffinity(match, newDomains, deps = {}) {
  if (!newDomains || newDomains.length === 0) return 0;
  const tags = getRoleDomainTags(match.role).map((t) => t.toLowerCase());
  const normalizedDomains = newDomains.map((d) => String(d).toLowerCase().replace(/\s+/g, '_'));

  for (const domain of normalizedDomains) {
    if (tags.includes(domain)) return 1;
    if (tags.some((t) => t.includes(domain) || domain.includes(t))) return 0.85;
  }

  const getEmbedding = deps.getEmbedding || getTraitEmbedding;
  const listTraits = deps.listTraits || listTraitDefinitions;
  const roleVec = match.role?.roleVectors?.identity_vector || match.role?.identity_vector;
  if (!roleVec || !(Array.isArray(roleVec) || roleVec instanceof Float32Array)) return 0;

  const roleFloat = roleVec instanceof Float32Array ? roleVec : Float32Array.from(roleVec);
  const domainSet = new Set(normalizedDomains);
  const traits = listTraits().filter((t) => domainSet.has(String(t.category || '').toLowerCase()));
  if (traits.length === 0) return 0;

  let best = 0;
  let scored = 0;
  let sum = 0;
  for (const trait of traits) {
    const emb = getEmbedding(trait.id);
    if (!emb || emb.length !== roleFloat.length) continue;
    const sim = cosineSimilarity(emb, roleFloat);
    if (!Number.isFinite(sim)) continue;
    scored += 1;
    sum += sim;
    if (sim > best) best = sim;
  }
  if (scored === 0) return 0;
  return Math.max(best, sum / scored);
}

function getMatchEmbedding(match) {
  const role = match?.role;
  if (!role) return null;
  const raw =
    role.roleVectors?.identity_vector
    || role.identity_vector
    || role.roleVectors?.finalVectors?.outOfTheBox
    || role.roleVectors?.hybrid_vector
    || null;
  if (!raw) return null;
  if (raw instanceof Float32Array) return raw.length > 0 ? raw : null;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  return Float32Array.from(raw.map(Number));
}

function diversifyByDomain(pool, k, scoreFn, usedDomains) {
  const remaining = pool.slice();
  const selected = [];

  while (selected.length < k && remaining.length > 0) {
    remaining.sort((a, b) => {
      const aDomains = getRoleDomainTags(a.role);
      const bDomains = getRoleDomainTags(b.role);
      const aNovel = aDomains.some((d) => !usedDomains.has(d.toLowerCase())) ? 1 : 0;
      const bNovel = bDomains.some((d) => !usedDomains.has(d.toLowerCase())) ? 1 : 0;
      if (bNovel !== aNovel) return bNovel - aNovel;
      const scoreDiff = scoreFn(b) - scoreFn(a);
      if (scoreDiff !== 0) return scoreDiff;
      return String(getRoleKey(a.role) || '').localeCompare(String(getRoleKey(b.role) || ''));
    });

    const picked = remaining.shift();
    selected.push(picked);
    for (const d of getRoleDomainTags(picked.role)) {
      usedDomains.add(d.toLowerCase());
    }
  }

  return selected;
}

async function selectWithDiversity(pool, k, scoreFn, options = {}) {
  if (k <= 0 || pool.length === 0) return [];
  if (k >= pool.length && !options.forceMmr) {
    return pool
      .slice()
      .sort((a, b) => {
        const diff = scoreFn(b) - scoreFn(a);
        if (diff !== 0) return diff;
        return String(getRoleKey(a.role) || '').localeCompare(String(getRoleKey(b.role) || ''));
      })
      .slice(0, k);
  }

  const useMmr = options.useMmr !== false;
  const mmrFn = options.mmrSelectFn || mmrSelect;
  const usedDomains = options.usedDomains || new Set();

  if (useMmr) {
    const embedMap = new Map();
    let embedCount = 0;
    for (const item of pool) {
      const emb = getMatchEmbedding(item);
      if (emb) {
        embedMap.set(item, emb);
        embedCount += 1;
      }
    }

    if (embedCount > 0 && typeof mmrFn === 'function') {
      const selected = await mmrFn(pool, {
        k,
        lambda: options.lambda,
        minNovelty: options.minNovelty,
        normalizationMode: 'global',
        precomputedEmbedMap: embedMap,
        scoreFn: (item) => scoreFn(item),
        embedFn: async (item) => getMatchEmbedding(item) || new Float32Array([0]),
      });
      return selected.map((item) => {
        const { diversity, ...rest } = item;
        return rest;
      });
    }
  }

  return diversifyByDomain(pool, k, scoreFn, usedDomains);
}

function sortByDeltaDesc(matches) {
  return matches.slice().sort((a, b) => {
    const deltaDiff = b.delta - a.delta;
    if (deltaDiff !== 0) return deltaDiff;
    const newDiff = b.newScore - a.newScore;
    if (newDiff !== 0) return newDiff;
    return String(getRoleKey(a.role) || '').localeCompare(String(getRoleKey(b.role) || ''));
  });
}

function takeUnused(pool, selectedKeys) {
  return pool.filter((m) => {
    const key = getRoleKey(m.role);
    return key && !selectedKeys.has(key);
  });
}

function commitPicks(jobs, picks, source, selectedKeys) {
  for (const match of picks) {
    const key = getRoleKey(match.role);
    if (!key || selectedKeys.has(key)) continue;
    selectedKeys.add(key);
    jobs.push({
      role: match.role,
      oldScore: match.oldScore,
      newScore: match.newScore,
      delta: match.delta,
      identityFit: Number.isFinite(match.identityFit) ? match.identityFit : undefined,
      profileFit: Number.isFinite(match.profileFit) ? match.profileFit : undefined,
      source,
    });
  }
}

const DOMAIN_PHRASES_EN = Object.freeze({
  leadership: 'leadership-related strengths',
  thinking_style: 'analytical strengths',
  problem_solving: 'problem-solving strengths',
  values: 'core values',
  interests: 'emerging interests',
  strengths: 'personal strengths',
  work_style: 'work-style preferences',
  motivation: 'motivations',
  environment: 'preferred work environments',
  communication: 'communication strengths',
  learning: 'learning preferences',
  social_orientation: 'people-oriented strengths',
});

function domainToPhrase(domain) {
  const key = String(domain || '').toLowerCase().replace(/\s+/g, '_');
  if (DOMAIN_PHRASES_EN[key]) return DOMAIN_PHRASES_EN[key];
  const readable = key.replace(/_/g, ' ').trim();
  if (!readable) return '';
  return readable + '-related strengths';
}

function buildExplorationExplanation(identityChange, newDomains, language = 'en') {
  const phrases = [];
  for (const domain of newDomains || []) {
    const phrase = domainToPhrase(domain);
    if (phrase && !phrases.includes(phrase)) phrases.push(phrase);
  }

  if (phrases.length < 2) {
    for (const reason of identityChange.reasons || []) {
      const conf = String(reason).match(/^(.+?)\s+confidence increased$/i);
      if (conf) {
        const name = conf[1].trim();
        if (name && phrases.length < 3) {
          const phrase = name.toLowerCase() + '-related strengths';
          if (!phrases.includes(phrase)) phrases.push(phrase);
        }
      }
      const neu = String(reason).match(/^New puzzle piece:\s*(.+)$/i);
      if (neu && phrases.length < 3) {
        const phrase = neu[1].trim().toLowerCase() + '-related strengths';
        if (!phrases.includes(phrase)) phrases.push(phrase);
      }
    }
  }

  if (language === 'de') {
    if (phrases.length === 0) {
      return 'Deine berufliche Identität hat sich kürzlich spürbar weiterentwickelt.';
    }
    if (phrases.length === 1) {
      return 'Deine Identität hat sich kürzlich in Richtung ' + phrases[0] + ' verschoben.';
    }
    const head = phrases.slice(0, -1).join(', ');
    return 'Deine Identität hat sich kürzlich in Richtung ' + head + ' und ' + phrases[phrases.length - 1] + ' verschoben.';
  }

  if (phrases.length === 0) {
    if (identityChange.changeScore >= 30) {
      return 'Your career identity has recently shifted in a meaningful way.';
    }
    return 'Your career identity has not changed enough to trigger a new exploration.';
  }

  if (phrases.length === 1) {
    return 'Your identity has recently shifted toward ' + phrases[0] + '.';
  }

  if (phrases.length === 2) {
    return 'Your identity has recently shifted toward ' + phrases[0] + ' and ' + phrases[1] + '.';
  }

  return 'Your identity has recently shifted toward ' + phrases[0] + ', ' + phrases[1] + ', and ' + phrases[2] + '.';
}

async function generateCareerExploration(options = {}) {
  const { mix, thresholds, language } = resolveConfig(options.config);
  const identityChange = normalizeIdentityChange(options.identityChangeScore);
  const triggerLevel = resolveTriggerLevel(identityChange.changeScore, thresholds);
  const newDomains = resolveNewDomains(options);

  const explanation = buildExplorationExplanation(identityChange, newDomains, language);

  if (
    !options.bypassTriggerLevelGate
    && triggerLevel === CAREER_EXPLORATION_TRIGGER_LEVELS.NONE
  ) {
    return { triggerLevel, explorationJobs: [], explanation };
  }

  const excludedKeys = toIdSet([
    ...(options.recentlyRatedJobIds || []),
    ...(options.acceptedJobIds || []),
    ...(options.excludedJobIds || []),
  ]);

  const pool = (Array.isArray(options.deltaJobMatches) ? options.deltaJobMatches : [])
    .filter((m) => m && m.role && Number.isFinite(m.delta) && Number.isFinite(m.newScore))
    .filter((m) => !isExcludedMatch(m, excludedKeys));

  if (pool.length === 0) {
    return { triggerLevel, explorationJobs: [], explanation };
  }

  let targetCount = Number(options.targetCount);
  if (!Number.isFinite(targetCount) || targetCount <= 0) {
    targetCount = thresholds.DEFAULT_JOBS;
  }
  targetCount = Math.max(thresholds.MIN_JOBS, Math.min(thresholds.MAX_JOBS, Math.round(targetCount)));
  targetCount = Math.min(targetCount, pool.length);

  const bucketCounts = allocateBucketCounts(mix, targetCount);
  const selectedKeys = new Set();
  const explorationJobs = [];
  const usedDomains = new Set();
  const mmrOpts = {
    mmrSelectFn: options.mmrSelectFn,
    lambda: thresholds.MMR_LAMBDA,
    minNovelty: thresholds.MMR_MIN_NOVELTY,
    usedDomains,
  };

  const affinityFn =
    typeof options.domainAffinityFn === 'function'
      ? options.domainAffinityFn
      : (match) => scoreNewDomainAffinity(match, newDomains);

  {
    const candidates = sortByDeltaDesc(takeUnused(pool, selectedKeys));
    const picks = await selectWithDiversity(
      candidates,
      bucketCounts.HIGHEST_DELTA,
      (m) => m.delta,
      { ...mmrOpts, useMmr: thresholds.USE_MMR_FOR_HIGHEST_DELTA }
    );
    commitPicks(explorationJobs, picks, CAREER_EXPLORATION_SOURCES.HIGHEST_DELTA, selectedKeys);
  }

  {
    let candidates = takeUnused(pool, selectedKeys)
      .map((m) => ({ match: m, affinity: affinityFn(m) }))
      .filter((row) => row.affinity >= thresholds.NEW_DOMAIN_AFFINITY_MIN)
      .sort((a, b) => {
        if (b.affinity !== a.affinity) return b.affinity - a.affinity;
        return b.match.delta - a.match.delta;
      })
      .map((row) => row.match);

    if (candidates.length === 0) {
      candidates = sortByDeltaDesc(takeUnused(pool, selectedKeys));
    }

    const picks = await selectWithDiversity(
      candidates,
      bucketCounts.NEW_DOMAIN,
      (m) => affinityFn(m) * 0.6 + m.delta * 0.4,
      { ...mmrOpts, useMmr: thresholds.USE_MMR_FOR_NEW_DOMAIN }
    );
    commitPicks(explorationJobs, picks, CAREER_EXPLORATION_SOURCES.NEW_DOMAIN, selectedKeys);
  }

  {
    let candidates = takeUnused(pool, selectedKeys).filter(
      (m) =>
        m.delta >= thresholds.UNEXPECTED_DELTA_MIN
        && m.delta <= thresholds.UNEXPECTED_DELTA_MAX
        && m.newScore >= thresholds.UNEXPECTED_NEW_SCORE_MIN
        && m.newScore <= thresholds.UNEXPECTED_NEW_SCORE_MAX
    );

    if (candidates.length === 0) {
      const ranked = sortByDeltaDesc(takeUnused(pool, selectedKeys));
      const start = Math.floor(ranked.length * 0.3);
      candidates = ranked.slice(start);
    } else {
      candidates = candidates.sort((a, b) => {
        const mid = (thresholds.UNEXPECTED_DELTA_MIN + thresholds.UNEXPECTED_DELTA_MAX) / 2;
        const aDist = Math.abs(a.delta - mid);
        const bDist = Math.abs(b.delta - mid);
        if (aDist !== bDist) return aDist - bDist;
        return String(getRoleKey(a.role) || '').localeCompare(String(getRoleKey(b.role) || ''));
      });
    }

    const picks = await selectWithDiversity(
      candidates,
      bucketCounts.UNEXPECTED,
      (m) => m.newScore,
      { ...mmrOpts, useMmr: thresholds.USE_MMR_FOR_UNEXPECTED }
    );
    commitPicks(explorationJobs, picks, CAREER_EXPLORATION_SOURCES.UNEXPECTED, selectedKeys);
  }

  {
    const candidates = takeUnused(pool, selectedKeys).sort((a, b) => {
      const aKey = String(getRoleKey(a.role) || '');
      const bKey = String(getRoleKey(b.role) || '');
      const aScore = aKey.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0) % 997;
      const bScore = bKey.split('').reduce((s, ch) => s + ch.charCodeAt(0), 0) % 997;
      if (aScore !== bScore) return aScore - bScore;
      return aKey.localeCompare(bKey);
    });

    const picks = await selectWithDiversity(
      candidates,
      bucketCounts.WILDCARD,
      (m) => m.newScore,
      { ...mmrOpts, useMmr: thresholds.USE_MMR_FOR_WILDCARD }
    );
    commitPicks(explorationJobs, picks, CAREER_EXPLORATION_SOURCES.WILDCARD, selectedKeys);
  }

  if (explorationJobs.length < targetCount) {
    const backfill = sortByDeltaDesc(takeUnused(pool, selectedKeys));
    commitPicks(
      explorationJobs,
      backfill.slice(0, targetCount - explorationJobs.length),
      CAREER_EXPLORATION_SOURCES.HIGHEST_DELTA,
      selectedKeys
    );
  }

  return {
    triggerLevel,
    explorationJobs: explorationJobs.slice(0, targetCount),
    explanation,
  };
}

module.exports = {
  generateCareerExploration,
  allocateBucketCounts,
  resolveTriggerLevel,
  buildExplorationExplanation,
  resolveNewDomains,
  getRoleKey,
  getRoleDomainTags,
  scoreNewDomainAffinity,
  selectWithDiversity,
  CAREER_EXPLORATION_MIX,
  CAREER_EXPLORATION_THRESHOLDS,
  CAREER_EXPLORATION_SOURCES,
  CAREER_EXPLORATION_TRIGGER_LEVELS,
};
