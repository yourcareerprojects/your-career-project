'use strict';

/** Identity fields copied from CareerPath at scoring time. */
const PHASE2_IDENTITY_KEYS = ['_id', 'escoId', 'title'];

/** Hybrid score fields merged from enrichCareerPathWithHybridScores. */
const PHASE2_SCORE_KEYS = [
  'hybridScoreNextRole',
  'hybridCosineNextRole',
  'hybridScoreOutOfTheBox',
  'hybridCosineOutOfTheBox',
  'identitySimilarityOutOfTheBox',
  'structuredSimilarityOutOfTheBox',
];

/** CareerPath fields hydrated lazily for MMR pool members before buildStepObject. */
const PHASE2_ENRICHMENT_CP_KEYS = [
  'description',
  'requiredSkills',
  'altTitles',
  'hiddenTitles',
  'seniority',
  'keyResponsibilities',
  'skillDomains',
  'skillModel',
];

const PHASE2_ENRICHMENT_CP_PROJECTION = {
  _id: 1,
  description: 1,
  requiredSkills: 1,
  altTitles: 1,
  hiddenTitles: 1,
  seniority: 1,
  keyResponsibilities: 1,
  skillDomains: 1,
  skillModel: 1,
};

function buildPhase2MinimalScoredPath(cpDoc, scored) {
  const minimal = {};
  for (let i = 0; i < PHASE2_IDENTITY_KEYS.length; i += 1) {
    const k = PHASE2_IDENTITY_KEYS[i];
    if (cpDoc && Object.prototype.hasOwnProperty.call(cpDoc, k)) {
      minimal[k] = cpDoc[k];
    }
  }
  if (scored && typeof scored === 'object') {
    for (let si = 0; si < PHASE2_SCORE_KEYS.length; si += 1) {
      const k = PHASE2_SCORE_KEYS[si];
      if (Object.prototype.hasOwnProperty.call(scored, k)) {
        minimal[k] = scored[k];
      }
    }
  }
  return minimal;
}

function mergePhase2EnrichmentIntoPath(path, enrichmentDoc) {
  if (!path || !enrichmentDoc || typeof enrichmentDoc !== 'object') return path;
  for (let i = 0; i < PHASE2_ENRICHMENT_CP_KEYS.length; i += 1) {
    const k = PHASE2_ENRICHMENT_CP_KEYS[i];
    if (Object.prototype.hasOwnProperty.call(enrichmentDoc, k)) {
      path[k] = enrichmentDoc[k];
    }
  }
  return path;
}

async function hydrateScoredPathsWithMeta(rows, metaLoader) {
  if (typeof metaLoader !== 'function') return;
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return;
  const needIds = list.map((p) => p && p._id).filter(Boolean);
  if (needIds.length === 0) return;
  const loaded = await metaLoader(needIds);
  for (let i = 0; i < list.length; i += 1) {
    const p = list[i];
    if (!p) continue;
    const k = String(p._id || '');
    if (!loaded.has(k)) continue;
    const doc = loaded.get(k);
    if (doc !== undefined) mergePhase2EnrichmentIntoPath(p, doc);
  }
}

module.exports = {
  PHASE2_IDENTITY_KEYS,
  PHASE2_SCORE_KEYS,
  PHASE2_ENRICHMENT_CP_KEYS,
  PHASE2_ENRICHMENT_CP_PROJECTION,
  buildPhase2MinimalScoredPath,
  mergePhase2EnrichmentIntoPath,
  hydrateScoredPathsWithMeta,
};
