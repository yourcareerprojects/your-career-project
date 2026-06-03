/**
 * Public API for post-save structured semantic enrichment (deferred / ensure-*).
 * Implementation stays in cvSemanticCompose (LLM + merge) and cvSemanticMap (signals).
 */

const compose = require('./cvSemanticCompose');
const map = require('./cvSemanticMap');

module.exports = {
  resolveStructuredSemanticInterpretation: compose.resolveStructuredSemanticInterpretation,
  mergeStructuredSemanticIntoProfile: compose.mergeStructuredSemanticIntoProfile,
  stripGoodAtFromProfile: map.stripGoodAtFromProfile,
  structuredSemanticHasProfileSignals: map.structuredSemanticHasProfileSignals,
  structuredSeniorityHasSignals: map.structuredSeniorityHasSignals,
};
