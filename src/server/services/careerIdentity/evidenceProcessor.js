/**
 * EvidenceProcessor — turns user profile / CV / career / simulation signals
 * into normalized IdentityEvidence records keyed by trait id.
 *
 * Trait discovery runs through the unified pipeline in evidenceAggregation.js.
 * Extension point: future AI sources plug in via processAdditionalEvidence().
 */

const crypto = require('crypto');
const { aggregateSemanticEvidence } = require('./evidenceAggregation');
const { pushEvidence, textBlob, stableId } = require('./evidenceTextUtils');

/**
 * Future AI / coaching / journal sources can call this with pre-shaped evidence.
 * @param {Map<string, Array>} bucket
 * @param {{ traitId: string, evidence: object }[]} items
 */
function processAdditionalEvidence(bucket, items) {
  for (const item of items || []) {
    if (!item?.traitId || !item?.evidence) continue;
    pushEvidence(bucket, item.traitId, item.evidence);
  }
}

/**
 * Run all evidence sources through the unified semantic pipeline.
 * @returns {Promise<{ evidenceByTrait: Map<string, Array> }>}
 */
async function processUserEvidence(user, options = {}) {
  const { evidenceByTrait } = await aggregateSemanticEvidence(user, options);

  if (Array.isArray(options.additionalEvidence) && options.additionalEvidence.length) {
    processAdditionalEvidence(evidenceByTrait, options.additionalEvidence);
  }

  return { evidenceByTrait };
}

/**
 * Fingerprint of user fields that should trigger a refresh when changed.
 */
function computeSourceFingerprint(user) {
  const payload = {
    answers: user?.profile?.userIdentityAnswers || {},
    who: user?.profile?.who_are_you?.identity_embedding_text || '',
    structured: user?.profile?.structuredUserInfo || {},
    docs: (user?.profile?.documents || []).map((d) => ({
      id: d._id || d.path,
      status: d.extractionStatus,
      semantic: d.semanticEnrichmentStatus,
    })),
    simCount: Array.isArray(user?.simulationResults) ? user.simulationResults.length : 0,
    lastSim: user?.lastSimulationResult?._id || user?.lastSimulationResult?.updatedAt || null,
    simRatings: (user?.simulationResults || []).slice(-5).map((sim) => ({
      id: sim.id || sim._id,
      updatedAt: sim.updatedAt || sim.timestamp || null,
      evals: [
        ...(sim.results?.nextSteps || []),
        ...(sim.results?.outsideTheBox || []),
      ]
        .slice(0, 40)
        .map((role) => ({
          id: role.stepId || role.escoId || role.id,
          eval: role.userEvaluation || null,
        })),
    })),
  };
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

module.exports = {
  processUserEvidence,
  processAdditionalEvidence,
  computeSourceFingerprint,
  textBlob,
  stableId,
};
