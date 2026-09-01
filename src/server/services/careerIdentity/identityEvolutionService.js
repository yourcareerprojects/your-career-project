/**
 * Identity Evolution Engine
 * =========================
 *
 * Compares two Career Identity puzzle snapshots and produces an
 * **Identity Change Score** — a tunable 0–100 signal for “has this person’s
 * identity shifted enough to warrant a new exploration / job recommendation?”
 *
 * Motivation
 * -----------
 * Users continuously interact with jobs, content, and career activities.
 * Those interactions update puzzle pieces and confidence. Recommending new
 * jobs after every tiny confidence nudge is noisy. This engine answers:
 * “how much did the identity *meaningfully* change between then and now?”
 *
 * Inputs
 * ------
 * Snapshots of puzzle pieces (identity traits at/above the emerging layer).
 * Accepted shapes (normalized automatically):
 *
 *   { traitId, category, confidence, layer? }
 *   { id, category, confidence, layer? }          // API / serializeProfile nodes
 *
 * Confidence is 0–1 (Career Identity canonical scale).
 *
 * Output
 * ------
 *   {
 *     changeScore: number,   // 0 … MAX_CHANGE_SCORE
 *     reasons: string[],     // human-readable drivers, highest impact first
 *   }
 *
 * Integration
 * -----------
 * **Not wired yet.** Call `calculateIdentityChangeScore(previous, current)`
 * from a future refresh / exploration gate. Persist prior trait snapshots
 * yourself — this module is pure comparison.
 *
 * Tuning
 * ------
 * All numeric knobs live in `src/constants/identityEvolutionWeights.js`.
 * Scorers are independent modules in {@link IDENTITY_EVOLUTION_SCORERS};
 * add or reorder them without touching aggregation.
 */

const { getTraitDefinition } = require('../../../constants/identityTraitCatalog');
const {
  IDENTITY_EVOLUTION_WEIGHTS,
  IDENTITY_EVOLUTION_THRESHOLDS,
} = require('../../../constants/identityEvolutionWeights');

/**
 * @typedef {Object} IdentityPiece
 * @property {string} traitId
 * @property {string} [category]
 * @property {number} confidence  // 0–1
 * @property {'confirmed'|'emerging'|string} [layer]
 */

/**
 * @typedef {Object} IdentityChangeResult
 * @property {number} changeScore
 * @property {string[]} reasons
 */

/**
 * @typedef {Object} ScorerContribution
 * @property {string} id
 * @property {number} score
 * @property {string[]} reasons
 */

/**
 * @typedef {Object} EvolutionContext
 * @property {Map<string, IdentityPiece>} previousById
 * @property {Map<string, IdentityPiece>} currentById
 * @property {IdentityPiece[]} previousPieces
 * @property {IdentityPiece[]} currentPieces
 * @property {typeof IDENTITY_EVOLUTION_WEIGHTS} weights
 * @property {typeof IDENTITY_EVOLUTION_THRESHOLDS} thresholds
 * @property {'en'|'de'} language
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function roundScore(value) {
  return Math.round(Math.max(0, Number(value) || 0) * 10) / 10;
}

/**
 * @param {unknown} piece
 * @returns {IdentityPiece|null}
 */
function normalizePiece(piece) {
  if (!piece || typeof piece !== 'object') return null;
  const traitId = String(piece.traitId || piece.id || '').trim();
  if (!traitId) return null;

  const def = getTraitDefinition(traitId);
  const category = String(piece.category || def?.category || '').trim() || 'unknown';
  const confidence = clamp01(piece.confidence);

  return {
    traitId,
    category,
    confidence,
    layer: piece.layer || null,
  };
}

/**
 * @param {unknown} pieces
 * @returns {IdentityPiece[]}
 */
function normalizePieces(pieces) {
  const list = Array.isArray(pieces) ? pieces : [];
  const byId = new Map();
  for (const raw of list) {
    const piece = normalizePiece(raw);
    if (!piece) continue;
    // Last write wins if duplicates appear.
    byId.set(piece.traitId, piece);
  }
  return [...byId.values()];
}

/**
 * @param {IdentityPiece[]} pieces
 * @returns {Map<string, IdentityPiece>}
 */
function indexByTraitId(pieces) {
  return new Map(pieces.map((p) => [p.traitId, p]));
}

/**
 * Prefer catalog display name; fall back to a readable traitId.
 * @param {string} traitId
 * @param {'en'|'de'} language
 * @returns {string}
 */
function traitDisplayName(traitId, language = 'en') {
  const def = getTraitDefinition(traitId);
  if (def?.name) {
    return def.name[language] || def.name.en || traitId;
  }
  return String(traitId)
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * @param {string} category
 * @returns {string}
 */
function domainDisplayName(category) {
  return String(category || 'unknown')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * @param {string[]} names
 * @param {number} maxListed
 * @returns {string}
 */
function joinNames(names, maxListed) {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length === 0) return '';
  if (unique.length <= maxListed) {
    if (unique.length === 1) return unique[0];
    if (unique.length === 2) return `${unique[0]} and ${unique[1]}`;
    return `${unique.slice(0, -1).join(', ')}, and ${unique[unique.length - 1]}`;
  }
  const head = unique.slice(0, maxListed).join(', ');
  return `${head}, and ${unique.length - maxListed} more`;
}

/**
 * @param {IdentityPiece[]} pieces
 * @returns {Set<string>}
 */
function categoriesOf(pieces) {
  return new Set(pieces.map((p) => p.category).filter(Boolean));
}

/**
 * Top-K trait ids by confidence (desc), stable by traitId on ties.
 * @param {IdentityPiece[]} pieces
 * @param {number} k
 * @returns {string[]}
 */
function topTraitIds(pieces, k) {
  return [...pieces]
    .sort((a, b) => {
      const confDiff = b.confidence - a.confidence;
      if (confDiff !== 0) return confDiff;
      return a.traitId.localeCompare(b.traitId);
    })
    .slice(0, Math.max(0, k))
    .map((p) => p.traitId);
}

/**
 * Jaccard distance of two id sets: 0 = identical, 1 = disjoint.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {number}
 */
function jaccardDistance(a, b) {
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersection = 0;
  for (const id of setA) {
    if (setB.has(id)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  if (union === 0) return 0;
  return 1 - intersection / union;
}

/**
 * Normalized L1 distance between category confidence mass distributions.
 * Returns value in ≈ [0, 1] (half of raw L1 of two probability vectors).
 * @param {IdentityPiece[]} previous
 * @param {IdentityPiece[]} current
 * @returns {number}
 */
function categoryMassShift(previous, current) {
  /** @type {Map<string, number>} */
  const prevMass = new Map();
  /** @type {Map<string, number>} */
  const currMass = new Map();

  let prevTotal = 0;
  let currTotal = 0;

  for (const piece of previous) {
    prevMass.set(piece.category, (prevMass.get(piece.category) || 0) + piece.confidence);
    prevTotal += piece.confidence;
  }
  for (const piece of current) {
    currMass.set(piece.category, (currMass.get(piece.category) || 0) + piece.confidence);
    currTotal += piece.confidence;
  }

  if (prevTotal <= 0 && currTotal <= 0) return 0;

  const categories = new Set([...prevMass.keys(), ...currMass.keys()]);
  let l1 = 0;
  for (const category of categories) {
    const p = prevTotal > 0 ? (prevMass.get(category) || 0) / prevTotal : 0;
    const c = currTotal > 0 ? (currMass.get(category) || 0) / currTotal : 0;
    l1 += Math.abs(p - c);
  }
  // Two probability distributions: L1 ∈ [0, 2] → normalize to [0, 1].
  return l1 / 2;
}

// ---------------------------------------------------------------------------
// Scorers (modular — each returns { id, score, reasons })
// ---------------------------------------------------------------------------

/**
 * Traits present now that were absent before.
 * @param {EvolutionContext} ctx
 * @returns {ScorerContribution}
 */
function scoreNewPieces(ctx) {
  const { previousById, currentPieces, weights, thresholds, language } = ctx;
  const added = currentPieces.filter((p) => !previousById.has(p.traitId));
  if (added.length === 0) {
    return { id: 'new_pieces', score: 0, reasons: [] };
  }

  const score = added.length * weights.NEW_PIECE;
  const names = added
    .sort((a, b) => b.confidence - a.confidence)
    .map((p) => traitDisplayName(p.traitId, language));

  /** @type {string[]} */
  const reasons = [];
  if (added.length === 1) {
    reasons.push(`New puzzle piece: ${names[0]}`);
  } else if (added.length <= thresholds.MAX_REASON_TRAITS_LISTED) {
    reasons.push(
      `${added.length} new puzzle pieces (${joinNames(names, thresholds.MAX_REASON_TRAITS_LISTED)})`
    );
  } else {
    reasons.push(`${added.length} new puzzle pieces`);
    reasons.push(`Including ${joinNames(names, thresholds.MAX_REASON_TRAITS_LISTED)}`);
  }

  return { id: 'new_pieces', score, reasons };
}

/**
 * Traits that left the puzzle (typically fell below emerging).
 * @param {EvolutionContext} ctx
 * @returns {ScorerContribution}
 */
function scoreRemovedPieces(ctx) {
  const { currentById, previousPieces, weights, thresholds, language } = ctx;
  const removed = previousPieces.filter((p) => !currentById.has(p.traitId));
  if (removed.length === 0) {
    return { id: 'removed_pieces', score: 0, reasons: [] };
  }

  const score = removed.length * weights.REMOVED_PIECE;
  const names = removed
    .sort((a, b) => b.confidence - a.confidence)
    .map((p) => traitDisplayName(p.traitId, language));

  /** @type {string[]} */
  const reasons = [];
  if (removed.length === 1) {
    reasons.push(`Removed puzzle piece: ${names[0]}`);
  } else if (removed.length <= thresholds.MAX_REASON_TRAITS_LISTED) {
    reasons.push(
      `${removed.length} removed puzzle pieces (${joinNames(names, thresholds.MAX_REASON_TRAITS_LISTED)})`
    );
  } else {
    reasons.push(`${removed.length} removed puzzle pieces`);
  }

  return { id: 'removed_pieces', score, reasons };
}

/**
 * Meaningful confidence gains on traits present in both snapshots.
 * @param {EvolutionContext} ctx
 * @returns {ScorerContribution}
 */
function scoreConfidenceIncreases(ctx) {
  const { previousById, currentPieces, weights, thresholds, language } = ctx;
  /** @type {{ name: string, delta: number }[]} */
  const gains = [];
  let totalDelta = 0;

  for (const current of currentPieces) {
    const previous = previousById.get(current.traitId);
    if (!previous) continue;
    const delta = current.confidence - previous.confidence;
    if (delta < thresholds.MIN_CONFIDENCE_DELTA) continue;
    totalDelta += delta;
    gains.push({ name: traitDisplayName(current.traitId, language), delta });
  }

  if (gains.length === 0) {
    return { id: 'confidence_increases', score: 0, reasons: [] };
  }

  gains.sort((a, b) => b.delta - a.delta);
  const score = totalDelta * weights.CONFIDENCE_INCREASE_PER_UNIT;
  const top = gains.slice(0, thresholds.MAX_REASON_TRAITS_LISTED);

  const reasons =
    top.length === 1
      ? [`${top[0].name} confidence increased`]
      : top.map((g) => `${g.name} confidence increased`);

  return { id: 'confidence_increases', score, reasons };
}

/**
 * Meaningful confidence drops on shared traits.
 * @param {EvolutionContext} ctx
 * @returns {ScorerContribution}
 */
function scoreConfidenceDecreases(ctx) {
  const { previousById, currentPieces, weights, thresholds, language } = ctx;
  /** @type {{ name: string, delta: number }[]} */
  const drops = [];
  let totalDelta = 0;

  for (const current of currentPieces) {
    const previous = previousById.get(current.traitId);
    if (!previous) continue;
    const delta = previous.confidence - current.confidence;
    if (delta < thresholds.MIN_CONFIDENCE_DELTA) continue;
    totalDelta += delta;
    drops.push({ name: traitDisplayName(current.traitId, language), delta });
  }

  if (drops.length === 0) {
    return { id: 'confidence_decreases', score: 0, reasons: [] };
  }

  drops.sort((a, b) => b.delta - a.delta);
  const score = totalDelta * weights.CONFIDENCE_DECREASE_PER_UNIT;
  const top = drops.slice(0, thresholds.MAX_REASON_TRAITS_LISTED);

  const reasons =
    top.length === 1
      ? [`${top[0].name} confidence decreased`]
      : top.map((d) => `${d.name} confidence decreased`);

  return { id: 'confidence_decreases', score, reasons };
}

/**
 * Identity categories (domains) that appear for the first time / disappear.
 * @param {EvolutionContext} ctx
 * @returns {ScorerContribution}
 */
function scoreDomainChanges(ctx) {
  const { previousPieces, currentPieces, weights } = ctx;
  const prevCats = categoriesOf(previousPieces);
  const currCats = categoriesOf(currentPieces);

  const added = [...currCats].filter((c) => !prevCats.has(c)).sort();
  const removed = [...prevCats].filter((c) => !currCats.has(c)).sort();

  const reasons = [];
  let score = 0;

  for (const category of added) {
    score += weights.NEW_DOMAIN;
    reasons.push(`New ${domainDisplayName(category)} domain`);
  }
  for (const category of removed) {
    score += weights.REMOVED_DOMAIN;
    reasons.push(`Removed ${domainDisplayName(category)} domain`);
  }

  return { id: 'domain_changes', score, reasons };
}

/**
 * Layer promotions / demotions on shared traits (emerging ↔ confirmed).
 * Folded into structural identity moves alongside semantic shift scoring.
 * @param {EvolutionContext} ctx
 * @returns {ScorerContribution}
 */
function scoreLayerTransitions(ctx) {
  const { previousById, currentPieces, weights, language } = ctx;
  const reasons = [];
  let score = 0;

  for (const current of currentPieces) {
    const previous = previousById.get(current.traitId);
    if (!previous || !previous.layer || !current.layer) continue;
    if (previous.layer === current.layer) continue;

    const name = traitDisplayName(current.traitId, language);
    if (previous.layer === 'emerging' && current.layer === 'confirmed') {
      score += weights.LAYER_PROMOTION;
      reasons.push(`${name} promoted to confirmed`);
    } else if (previous.layer === 'confirmed' && current.layer === 'emerging') {
      score += weights.LAYER_DEMOTION;
      reasons.push(`${name} demoted to emerging`);
    }
  }

  return { id: 'layer_transitions', score, reasons };
}

/**
 * Major semantic shifts: core trait set turnover + category mass redistribution.
 * Deterministic and offline (no embedding calls).
 * @param {EvolutionContext} ctx
 * @returns {ScorerContribution}
 */
function scoreSemanticShifts(ctx) {
  const { previousPieces, currentPieces, weights, thresholds } = ctx;
  const reasons = [];
  let score = 0;

  // Empty → empty is no shift; empty → populated is covered by new_pieces/domains.
  if (previousPieces.length === 0 || currentPieces.length === 0) {
    return { id: 'semantic_shifts', score: 0, reasons: [] };
  }

  const prevTop = topTraitIds(previousPieces, thresholds.SEMANTIC_TOP_K);
  const currTop = topTraitIds(currentPieces, thresholds.SEMANTIC_TOP_K);
  const coreDistance = jaccardDistance(prevTop, currTop);

  if (coreDistance >= thresholds.MIN_SEMANTIC_SHIFT) {
    score += coreDistance * weights.SEMANTIC_SHIFT_PER_UNIT;
    reasons.push('Major semantic shift in core identity traits');
  }

  const massShift = categoryMassShift(previousPieces, currentPieces);
  if (massShift >= thresholds.MIN_CATEGORY_MASS_SHIFT) {
    score += massShift * weights.CATEGORY_MASS_SHIFT_PER_UNIT;
    reasons.push('Identity confidence shifted across domains');
  }

  return { id: 'semantic_shifts', score, reasons };
}

/**
 * Ordered list of modular scorers. Add / remove / reorder freely.
 * Each scorer must be pure and return {@link ScorerContribution}.
 */
const IDENTITY_EVOLUTION_SCORERS = Object.freeze([
  scoreNewPieces,
  scoreRemovedPieces,
  scoreConfidenceIncreases,
  scoreConfidenceDecreases,
  scoreDomainChanges,
  scoreLayerTransitions,
  scoreSemanticShifts,
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Merge caller overrides onto frozen defaults (shallow).
 * @param {Partial<typeof IDENTITY_EVOLUTION_WEIGHTS>|undefined} override
 * @returns {typeof IDENTITY_EVOLUTION_WEIGHTS}
 */
function resolveWeights(override) {
  if (!override || typeof override !== 'object') return IDENTITY_EVOLUTION_WEIGHTS;
  return { ...IDENTITY_EVOLUTION_WEIGHTS, ...override };
}

/**
 * @param {Partial<typeof IDENTITY_EVOLUTION_THRESHOLDS>|undefined} override
 * @returns {typeof IDENTITY_EVOLUTION_THRESHOLDS}
 */
function resolveThresholds(override) {
  if (!override || typeof override !== 'object') return IDENTITY_EVOLUTION_THRESHOLDS;
  return { ...IDENTITY_EVOLUTION_THRESHOLDS, ...override };
}

/**
 * Compare two identity puzzle snapshots and compute a change score.
 *
 * @param {Array<Object>} previousPieces - Prior puzzle traits / API nodes
 * @param {Array<Object>} currentPieces  - Latest puzzle traits / API nodes
 * @param {{
 *   weights?: Partial<typeof IDENTITY_EVOLUTION_WEIGHTS>,
 *   thresholds?: Partial<typeof IDENTITY_EVOLUTION_THRESHOLDS>,
 *   language?: 'en'|'de',
 *   includeDebug?: boolean,
 * }} [options]
 * @returns {IdentityChangeResult & { debug?: ScorerContribution[] }}
 *
 * @example
 * calculateIdentityChangeScore(before, after)
 * // {
 * //   changeScore: 42,
 * //   reasons: [
 * //     '3 new puzzle pieces',
 * //     'Leadership confidence increased',
 * //     'New Leadership domain'
 * //   ]
 * // }
 */
function calculateIdentityChangeScore(previousPieces, currentPieces, options = {}) {
  const weights = resolveWeights(options.weights);
  const thresholds = resolveThresholds(options.thresholds);
  const language = options.language === 'de' ? 'de' : 'en';

  const previous = normalizePieces(previousPieces);
  const current = normalizePieces(currentPieces);

  /** @type {EvolutionContext} */
  const ctx = {
    previousById: indexByTraitId(previous),
    currentById: indexByTraitId(current),
    previousPieces: previous,
    currentPieces: current,
    weights,
    thresholds,
    language,
  };

  /** @type {ScorerContribution[]} */
  const contributions = IDENTITY_EVOLUTION_SCORERS.map((scorer) => scorer(ctx));

  let rawScore = 0;
  /** @type {{ reason: string, score: number }[]} */
  const rankedReasons = [];

  for (const contribution of contributions) {
    const part = Math.max(0, Number(contribution.score) || 0);
    rawScore += part;
    for (const reason of contribution.reasons || []) {
      if (!reason) continue;
      rankedReasons.push({ reason, score: part });
    }
  }

  // Higher-scoring scorer groups first, then insertion order within a group.
  rankedReasons.sort((a, b) => b.score - a.score);
  const reasons = [];
  const seen = new Set();
  for (const entry of rankedReasons) {
    if (seen.has(entry.reason)) continue;
    seen.add(entry.reason);
    reasons.push(entry.reason);
  }

  const changeScore = roundScore(Math.min(thresholds.MAX_CHANGE_SCORE, rawScore));

  /** @type {IdentityChangeResult & { debug?: ScorerContribution[] }} */
  const result = { changeScore, reasons };
  if (options.includeDebug) {
    result.debug = contributions;
  }
  return result;
}

/**
 * Convenience gate for exploration triggers.
 * Prefer {@link evaluateAdaptiveExplorationGate} for production — this helper
 * keeps a fixed fallback bar for unit tests and legacy callers.
 *
 * @param {number|IdentityChangeResult} changeScoreOrResult
 * @param {number} [triggerScore] - defaults to EXPLORATION_TRIGGER_SCORE
 * @returns {boolean}
 */
function shouldTriggerExploration(changeScoreOrResult, triggerScore) {
  const score =
    typeof changeScoreOrResult === 'number'
      ? changeScoreOrResult
      : Number(changeScoreOrResult?.changeScore) || 0;
  const bar =
    triggerScore != null
      ? Number(triggerScore)
      : IDENTITY_EVOLUTION_THRESHOLDS.EXPLORATION_TRIGGER_SCORE;
  return score >= bar;
}

/**
 * Expose scorer registry for tests and custom pipelines.
 * @returns {ReadonlyArray<Function>}
 */
function listIdentityEvolutionScorers() {
  return IDENTITY_EVOLUTION_SCORERS;
}

module.exports = {
  calculateIdentityChangeScore,
  shouldTriggerExploration,
  listIdentityEvolutionScorers,
  normalizePieces,
  normalizePiece,
  // Re-export knobs for callers that want to document / fingerprint config.
  IDENTITY_EVOLUTION_WEIGHTS,
  IDENTITY_EVOLUTION_THRESHOLDS,
  // Individual scorers (advanced / unit tests)
  scoreNewPieces,
  scoreRemovedPieces,
  scoreConfidenceIncreases,
  scoreConfidenceDecreases,
  scoreDomainChanges,
  scoreLayerTransitions,
  scoreSemanticShifts,
};
