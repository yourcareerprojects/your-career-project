/**
 * Identity Snapshot Service
 * =========================
 *
 * Persists a **lightweight** prior Career Identity state so the Evolution Engine
 * can compare “then vs now” without storing full evidence graphs.
 *
 * In the exploration pipeline this snapshot acts as the current accumulation
 * baseline: it is seeded on first run and advanced only after a run actually
 * produces fresh role suggestions.
 *
 * What is stored (`lastIdentitySnapshot` on CareerIdentityProfile)
 * ---------------------------------------------------------------
 *   {
 *     version: 1,                 // format version — bump + migrate on change
 *     capturedAt: Date,           // when this snapshot was taken
 *     pieces: [                   // puzzle pieces only (emerging+)
 *       { traitId, category, confidence, layer }
 *     ],
 *     domains: [                  // derived category summaries
 *       { category, pieceCount, maxConfidence }
 *     ]
 *   }
 *
 * Intentionally omitted: evidence, labels, connections, votes, fingerprints.
 * Those are not required for change scoring and would bloat every write.
 *
 * Future-proofing
 * ---------------
 * - `version` gates migrations via {@link migrateSnapshot}.
 * - Domain summaries are explicit so later scorers can diff domains without
 *   re-deriving from pieces.
 *
 * Integration status
 * ------------------
 * Written by the identity exploration pipeline when seeding the first baseline,
 * when empty-pool results need to unblock a stuck threshold, and when the user
 * consumes delivered role suggestions (`resetExplorationProgressBaseline`).
 *
 * Public API
 * ----------
 * - {@link createSnapshot}  — pure builder from traits / profile / nodes
 * - {@link loadLatestSnapshot} — read `lastIdentitySnapshot` for a user
 * - {@link saveSnapshot} — persist a snapshot (or build+persist from source)
 */

const mongoose = require('mongoose');
const CareerIdentityProfile = require('../../models/CareerIdentityProfile');
const { getTraitDefinition } = require('../../../constants/identityTraitCatalog');
const { classifyIdentityLayer } = require('../../../constants/identityPuzzleThresholds');

/** Current on-disk / in-memory snapshot format version. */
const IDENTITY_SNAPSHOT_VERSION = 1;

/**
 * @typedef {Object} SnapshotPiece
 * @property {string} traitId
 * @property {string} category
 * @property {number} confidence  // 0–1
 * @property {'confirmed'|'emerging'|null} [layer]
 */

/**
 * @typedef {Object} SnapshotDomain
 * @property {string} category
 * @property {number} pieceCount
 * @property {number} maxConfidence  // 0–1
 */

/**
 * @typedef {Object} IdentitySnapshot
 * @property {number} version
 * @property {Date} capturedAt
 * @property {SnapshotPiece[]} pieces
 * @property {SnapshotDomain[]} domains
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function roundConfidence(value) {
  return Math.round(clamp01(value) * 1000) / 1000;
}

/**
 * @param {unknown} userId
 * @returns {import('mongoose').Types.ObjectId}
 */
function toObjectId(userId) {
  if (userId instanceof mongoose.Types.ObjectId) return userId;
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    const err = new Error('Invalid userId');
    err.status = 400;
    throw err;
  }
  return new mongoose.Types.ObjectId(String(userId));
}

/**
 * Pull a trait/piece list from common identity shapes.
 * @param {unknown} source
 * @returns {unknown[]}
 */
function extractRawPieces(source) {
  if (source == null) return [];
  if (Array.isArray(source)) return source;
  if (typeof source !== 'object') return [];

  // Already a snapshot
  if (Array.isArray(source.pieces) && source.version != null) {
    return source.pieces;
  }
  // CareerIdentityProfile document / lean
  if (Array.isArray(source.traits)) return source.traits;
  // serializeProfile() output
  if (Array.isArray(source.nodes)) return source.nodes;
  // Nested { snapshot: {...} } accidental wrap
  if (source.snapshot && typeof source.snapshot === 'object') {
    return extractRawPieces(source.snapshot);
  }
  return [];
}

/**
 * @param {unknown} raw
 * @returns {SnapshotPiece|null}
 */
function normalizeSnapshotPiece(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const traitId = String(raw.traitId || raw.id || '').trim();
  if (!traitId) return null;

  const def = getTraitDefinition(traitId);
  const category = String(raw.category || def?.category || '').trim() || 'unknown';
  const confidence = roundConfidence(raw.confidence);
  const layer =
    raw.layer === 'confirmed' || raw.layer === 'emerging'
      ? raw.layer
      : classifyIdentityLayer(confidence);

  /** @type {SnapshotPiece} */
  const piece = { traitId, category, confidence };
  if (layer) piece.layer = layer;
  return piece;
}

/**
 * @param {SnapshotPiece[]} pieces
 * @returns {SnapshotDomain[]}
 */
function buildDomainSummaries(pieces) {
  /** @type {Map<string, { category: string, pieceCount: number, maxConfidence: number }>} */
  const byCategory = new Map();

  for (const piece of pieces) {
    const category = piece.category || 'unknown';
    const existing = byCategory.get(category);
    if (!existing) {
      byCategory.set(category, {
        category,
        pieceCount: 1,
        maxConfidence: piece.confidence,
      });
      continue;
    }
    existing.pieceCount += 1;
    if (piece.confidence > existing.maxConfidence) {
      existing.maxConfidence = piece.confidence;
    }
  }

  return [...byCategory.values()]
    .map((domain) => ({
      category: domain.category,
      pieceCount: domain.pieceCount,
      maxConfidence: roundConfidence(domain.maxConfidence),
    }))
    .sort((a, b) => a.category.localeCompare(b.category));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function looksLikeSnapshot(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && !Array.isArray(value)
      && Array.isArray(value.pieces)
      && (value.version != null || value.capturedAt != null)
  );
}

/**
 * Coerce capturedAt to a Date.
 * @param {unknown} value
 * @param {Date} [fallback]
 * @returns {Date}
 */
function resolveCapturedAt(value, fallback = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return fallback instanceof Date ? fallback : new Date();
}

/**
 * Upgrade older snapshot documents to {@link IDENTITY_SNAPSHOT_VERSION}.
 * Currently v1 is the only format; this is the extension point for v2+.
 *
 * @param {unknown} snapshot
 * @returns {IdentitySnapshot|null}
 */
function migrateSnapshot(snapshot) {
  if (snapshot == null) return null;
  if (typeof snapshot !== 'object' || Array.isArray(snapshot)) return null;

  const version = Number(snapshot.version) || 1;

  // v1 (and pre-version documents that already have pieces[])
  if (version <= IDENTITY_SNAPSHOT_VERSION) {
    const pieces = [];
    const seen = new Set();
    for (const raw of Array.isArray(snapshot.pieces) ? snapshot.pieces : []) {
      const piece = normalizeSnapshotPiece(raw);
      if (!piece || seen.has(piece.traitId)) continue;
      seen.add(piece.traitId);
      pieces.push(piece);
    }
    pieces.sort((a, b) => {
      const confDiff = b.confidence - a.confidence;
      if (confDiff !== 0) return confDiff;
      return a.traitId.localeCompare(b.traitId);
    });

    const domains =
      Array.isArray(snapshot.domains) && snapshot.domains.length > 0
        ? snapshot.domains
            .map((d) => {
              if (!d || typeof d !== 'object') return null;
              const category = String(d.category || d.id || '').trim();
              if (!category) return null;
              return {
                category,
                pieceCount: Math.max(0, Number(d.pieceCount) || 0),
                maxConfidence: roundConfidence(d.maxConfidence),
              };
            })
            .filter(Boolean)
            .sort((a, b) => a.category.localeCompare(b.category))
        : buildDomainSummaries(pieces);

    return {
      version: IDENTITY_SNAPSHOT_VERSION,
      capturedAt: resolveCapturedAt(snapshot.capturedAt),
      pieces,
      domains,
    };
  }

  // Newer-than-supported versions: best-effort normalize rather than throw,
  // so older app servers keep working after a forward deploy wrote vN.
  return migrateSnapshot({ ...snapshot, version: IDENTITY_SNAPSHOT_VERSION });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a lightweight identity snapshot from puzzle pieces or a profile shape.
 *
 * Accepted inputs:
 * - `SnapshotPiece[]` / trait arrays
 * - `{ traits }` CareerIdentityProfile
 * - `{ nodes }` serializeProfile output
 * - an existing snapshot (re-normalized)
 *
 * @param {unknown} source
 * @param {{ capturedAt?: Date|string|number }} [options]
 * @returns {IdentitySnapshot}
 */
function createSnapshot(source, options = {}) {
  const rawPieces = extractRawPieces(source);
  const pieces = [];
  const seen = new Set();

  for (const raw of rawPieces) {
    const piece = normalizeSnapshotPiece(raw);
    if (!piece || seen.has(piece.traitId)) continue;
    seen.add(piece.traitId);
    pieces.push(piece);
  }

  pieces.sort((a, b) => {
    const confDiff = b.confidence - a.confidence;
    if (confDiff !== 0) return confDiff;
    return a.traitId.localeCompare(b.traitId);
  });

  return {
    version: IDENTITY_SNAPSHOT_VERSION,
    capturedAt: resolveCapturedAt(options.capturedAt),
    pieces,
    domains: buildDomainSummaries(pieces),
  };
}

/**
 * Load the user's latest stored identity snapshot, or null if none exists.
 * Applies {@link migrateSnapshot} so callers always see the current format.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @returns {Promise<IdentitySnapshot|null>}
 */
async function loadLatestSnapshot(userId) {
  const oid = toObjectId(userId);
  const profile = await CareerIdentityProfile.findOne({ userId: oid })
    .select('lastIdentitySnapshot')
    .lean();

  if (!profile?.lastIdentitySnapshot) return null;
  return migrateSnapshot(profile.lastIdentitySnapshot);
}

/**
 * Persist an identity snapshot as `lastIdentitySnapshot`.
 *
 * Accepts either:
 * - a snapshot object (`createSnapshot` output), or
 * - any source `createSnapshot` understands (traits / nodes / pieces).
 *
 * Creates the CareerIdentityProfile document if the user has none yet
 * (snapshot-only stub). Does **not** refresh identity traits.
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {unknown} snapshotOrSource
 * @param {{ capturedAt?: Date|string|number }} [options]
 * @returns {Promise<IdentitySnapshot>} the normalized snapshot that was saved
 */
async function saveSnapshot(userId, snapshotOrSource, options = {}) {
  const oid = toObjectId(userId);
  const snapshot = looksLikeSnapshot(snapshotOrSource)
    ? migrateSnapshot({
        ...snapshotOrSource,
        capturedAt:
          options.capturedAt != null
            ? resolveCapturedAt(options.capturedAt, snapshotOrSource.capturedAt)
            : snapshotOrSource.capturedAt,
      })
    : createSnapshot(snapshotOrSource, options);

  if (!snapshot) {
    const err = new Error('Invalid identity snapshot');
    err.status = 400;
    throw err;
  }

  const existing = await loadLatestSnapshot(userId);
  if (existing?.capturedAt) {
    const existingTs = resolveCapturedAt(existing.capturedAt).getTime();
    const incomingTs = resolveCapturedAt(snapshot.capturedAt).getTime();
    if (incomingTs < existingTs) {
      return migrateSnapshot(existing);
    }
  }

  await CareerIdentityProfile.findOneAndUpdate(
    { userId: oid },
    {
      $set: { lastIdentitySnapshot: snapshot },
      $setOnInsert: { userId: oid },
    },
    { upsert: true, new: true }
  );

  return snapshot;
}

/**
 * Pieces array suitable for `calculateIdentityChangeScore(previous, current)`.
 * @param {IdentitySnapshot|null|undefined} snapshot
 * @returns {SnapshotPiece[]}
 */
function getSnapshotPieces(snapshot) {
  if (!snapshot) return [];
  const migrated = migrateSnapshot(snapshot);
  return migrated?.pieces || [];
}

/**
 * Domain category ids from a snapshot (sorted).
 * @param {IdentitySnapshot|null|undefined} snapshot
 * @returns {string[]}
 */
function getSnapshotDomainIds(snapshot) {
  if (!snapshot) return [];
  const migrated = migrateSnapshot(snapshot);
  return (migrated?.domains || []).map((d) => d.category);
}

module.exports = {
  IDENTITY_SNAPSHOT_VERSION,
  createSnapshot,
  loadLatestSnapshot,
  saveSnapshot,
  migrateSnapshot,
  getSnapshotPieces,
  getSnapshotDomainIds,
  buildDomainSummaries,
};
