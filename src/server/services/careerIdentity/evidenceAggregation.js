/**
 * Unified evidence aggregation pipeline.
 *
 * Evidence → Text → Semantic Matching → Candidate Traits → Weighted Evidence
 *
 * All evidence sources share the same semantic matcher and trait discovery config.
 * Per-source weight formulas live in evidenceWeighting.js (unchanged).
 */

const { createTraitDiscovery } = require('./traitDiscovery');
const { pushEvidence, normalizeEvidenceText } = require('./evidenceTextUtils');
const { collectAllTextEvidence } = require('./evidenceSources');
const { shouldAcceptTraitMatch } = require('./evidenceQuality');

/**
 * Apply semantic trait candidates to the evidence bucket for one text evidence item.
 *
 * @param {Map<string, Array>} bucket
 * @param {import('./evidenceSources').TextEvidenceItem} item
 * @param {Map<string, number>} candidateTraits traitId → match strength
 */
function applyCandidateTraits(bucket, item, candidateTraits) {
  for (const [traitId, strength] of candidateTraits.entries()) {
    if (!shouldAcceptTraitMatch(item.text, traitId, strength)) continue;
    pushEvidence(bucket, traitId, item.toEvidence(traitId, strength));
  }
}

/**
 * Run the unified semantic evidence pipeline for a user.
 *
 * @param {object} user
 * @param {object} [options] - forwarded to createTraitDiscovery (minSimilarity, topK, discoverTraitsFromText)
 * @returns {Promise<{ evidenceByTrait: Map<string, Array> }>}
 */
async function aggregateSemanticEvidence(user, options = {}) {
  const bucket = new Map();
  const items = collectAllTextEvidence(user);

  if (items.length === 0) {
    return { evidenceByTrait: bucket };
  }

  const discovery = createTraitDiscovery(options);
  const texts = items.map((item) => item.text);
  const candidateTraitsByText = await discovery.discoverTraitsForTexts(texts);

  for (const item of items) {
    const candidateTraits =
      candidateTraitsByText.get(normalizeEvidenceText(item.text)) || new Map();
    applyCandidateTraits(bucket, item, candidateTraits);
  }

  return { evidenceByTrait: bucket };
}

module.exports = {
  applyCandidateTraits,
  aggregateSemanticEvidence,
};
