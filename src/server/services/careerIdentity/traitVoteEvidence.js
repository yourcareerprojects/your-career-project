/**
 * User self-assessment votes on identity traits ("Passt das zu dir?").
 *
 * Votes are stored on the Career Identity profile and injected as assessment
 * evidence on refresh — never as hand-edited confidence.
 *
 * - confirm → modest positive evidence (gentle upgrade)
 * - reject  → modest negative evidence (gentle downgrade)
 * - unsure  → recorded for UI only; keep collecting other evidence
 */

const { localized, stableId, pushEvidence } = require('./evidenceTextUtils');
const { calculateTraitConfidence } = require('./traitConfidenceCalculator');
const { classifyIdentityLayer } = require('../../../constants/identityPuzzleThresholds');

const TRAIT_VOTE_VALUES = Object.freeze(['confirm', 'unsure', 'reject']);

/** Keep vote signals softer than CV/career evidence so one tap does not dominate the puzzle. */
const VOTE_EVIDENCE_WEIGHT = 0.48;
const VOTE_EVIDENCE_STRENGTH = 0.52;

function normalizeTraitVote(vote) {
  if (vote == null || vote === '') return null;
  const value = String(vote).toLowerCase().trim();
  return TRAIT_VOTE_VALUES.includes(value) ? value : null;
}

/**
 * @param {string} traitId
 * @param {'confirm'|'reject'} vote
 * @param {string} userId
 * @param {Date} [updatedAt]
 * @returns {object}
 */
function buildTraitVoteEvidence(traitId, vote, userId, updatedAt = new Date()) {
  const base = {
    evidenceId: stableId('trait_vote', String(userId || ''), traitId, vote),
    sourceType: 'assessment',
    sourceId: `user_vote:${traitId}`,
    weight: VOTE_EVIDENCE_WEIGHT,
    matchStrength: VOTE_EVIDENCE_STRENGTH,
    timestamp: updatedAt ? new Date(updatedAt) : new Date(),
    label: localized('Your feedback', 'Dein Feedback'),
    contentKey: `user_vote:${vote}:${traitId}`,
  };

  if (vote === 'confirm') {
    return {
      ...base,
      polarity: 'positive',
      explanation: localized(
        'You confirmed that this fits you well.',
        'Du hast bestätigt, dass das sehr gut zu dir passt.'
      ),
    };
  }

  if (vote === 'reject') {
    return {
      ...base,
      polarity: 'negative',
      explanation: localized(
        'You indicated that this does not really fit you.',
        'Du hast angegeben, dass das nicht wirklich zu dir passt.'
      ),
    };
  }

  return null;
}

/**
 * Merge stored trait votes into the evidence map used for assembly.
 * Unsure votes are intentionally skipped (no scoring signal).
 *
 * @param {Map<string, Array>} evidenceByTrait
 * @param {Array<{ traitId?: string, vote?: string, updatedAt?: Date }>} traitVotes
 * @param {string} userId
 */
function applyTraitVotesToEvidence(evidenceByTrait, traitVotes, userId) {
  for (const entry of traitVotes || []) {
    const traitId = String(entry?.traitId || '').trim();
    const vote = normalizeTraitVote(entry?.vote);
    if (!traitId || !vote || vote === 'unsure') continue;

    const evidence = buildTraitVoteEvidence(traitId, vote, userId, entry.updatedAt);
    if (!evidence) continue;
    pushEvidence(evidenceByTrait, traitId, evidence);
  }
}

/**
 * Upsert or clear a single trait vote in a votes array (immutable).
 * @returns {Array}
 */
function upsertTraitVoteList(existingVotes, traitId, vote) {
  const id = String(traitId || '').trim();
  const normalized = normalizeTraitVote(vote);
  const list = Array.isArray(existingVotes)
    ? existingVotes
        .filter((entry) => entry && entry.traitId)
        .map((entry) => ({
          traitId: String(entry.traitId),
          vote: normalizeTraitVote(entry.vote),
          updatedAt: entry.updatedAt ? new Date(entry.updatedAt) : new Date(),
        }))
        .filter((entry) => entry.vote)
    : [];

  const next = list.filter((entry) => entry.traitId !== id);
  if (normalized) {
    next.push({ traitId: id, vote: normalized, updatedAt: new Date() });
  }
  return next;
}

function getTraitVoteFromList(traitVotes, traitId) {
  const id = String(traitId || '').trim();
  const found = (traitVotes || []).find((entry) => entry?.traitId === id);
  return normalizeTraitVote(found?.vote);
}

/**
 * @param {object|null|undefined} item
 * @returns {boolean}
 */
function isUserVoteEvidence(item) {
  return Boolean(
    item
    && item.sourceType === 'assessment'
    && String(item.sourceId || '').startsWith('user_vote:')
  );
}

/**
 * Rebuild an evidence map from persisted puzzle traits, stripping prior user-vote
 * assessment rows so votes can be re-applied cleanly without re-running discovery.
 *
 * @param {Array<{ traitId?: string, evidence?: object[] }>|null|undefined} traits
 * @returns {Map<string, object[]>}
 */
function evidenceMapFromCachedTraits(traits) {
  const map = new Map();
  for (const trait of traits || []) {
    const traitId = String(trait?.traitId || '').trim();
    if (!traitId) continue;
    const kept = [];
    for (const item of trait.evidence || []) {
      if (!item || isUserVoteEvidence(item)) continue;
      kept.push({
        evidenceId: item.evidenceId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        weight: item.weight,
        matchStrength: item.matchStrength,
        polarity: item.polarity === 'negative' ? 'negative' : 'positive',
        timestamp: item.timestamp ? new Date(item.timestamp) : new Date(),
        explanation: item.explanation,
        label: item.label,
        contentKey: item.contentKey,
      });
    }
    if (kept.length > 0) {
      map.set(traitId, kept);
    }
  }
  return map;
}

/**
 * True when applying `nextVote` would push confidence below the emerging threshold.
 * Existing user-vote assessment evidence is replaced for the simulation
 * (confirm/reject inject new vote evidence; unsure/null leave scoring evidence only).
 *
 * @param {Array} evidence
 * @param {string} traitId
 * @param {string} userId
 * @param {'confirm'|'unsure'|'reject'|null|undefined} nextVote
 * @returns {boolean}
 */
function wouldVoteRemoveTrait(evidence, traitId, userId, nextVote) {
  const withoutVoteEvidence = (Array.isArray(evidence) ? evidence : []).filter(
    (item) => !isUserVoteEvidence(item)
  );
  const normalized = normalizeTraitVote(nextVote);
  let nextEvidence = withoutVoteEvidence;

  if (normalized === 'confirm' || normalized === 'reject') {
    const voteEvidence = buildTraitVoteEvidence(traitId, normalized, userId);
    if (!voteEvidence) return false;
    nextEvidence = [...withoutVoteEvidence, voteEvidence];
  }

  const confidence = calculateTraitConfidence(nextEvidence);
  return classifyIdentityLayer(confidence) == null;
}

/**
 * True when applying a reject vote would push confidence below the emerging threshold.
 * @deprecated Prefer wouldVoteRemoveTrait(..., 'reject')
 */
function wouldRejectRemoveTrait(evidence, traitId, userId) {
  return wouldVoteRemoveTrait(evidence, traitId, userId, 'reject');
}

/**
 * Per-action flags for the client confirmation dialog.
 * `clear` = clearing the current vote (clicking the active choice again).
 *
 * @param {Array} evidence
 * @param {string} traitId
 * @param {string} userId
 * @returns {{ confirm: boolean, unsure: boolean, reject: boolean, clear: boolean }}
 */
function buildVoteWouldRemoveMap(evidence, traitId, userId) {
  return {
    confirm: wouldVoteRemoveTrait(evidence, traitId, userId, 'confirm'),
    unsure: wouldVoteRemoveTrait(evidence, traitId, userId, 'unsure'),
    reject: wouldVoteRemoveTrait(evidence, traitId, userId, 'reject'),
    clear: wouldVoteRemoveTrait(evidence, traitId, userId, null),
  };
}

module.exports = {
  TRAIT_VOTE_VALUES,
  VOTE_EVIDENCE_WEIGHT,
  VOTE_EVIDENCE_STRENGTH,
  normalizeTraitVote,
  buildTraitVoteEvidence,
  applyTraitVotesToEvidence,
  upsertTraitVoteList,
  getTraitVoteFromList,
  isUserVoteEvidence,
  evidenceMapFromCachedTraits,
  wouldVoteRemoveTrait,
  wouldRejectRemoveTrait,
  buildVoteWouldRemoveMap,
};
