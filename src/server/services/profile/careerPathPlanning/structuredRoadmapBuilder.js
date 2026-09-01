/**
 * @deprecated Template roadmap generation has been retired.
 * Roadmaps are now produced by the LLM career coach from CareerContextBuilder facts.
 * This module remains only so older imports fail loudly instead of silently using templates.
 */

function generateStructuredRoadmap() {
  throw new Error(
    'generateStructuredRoadmap is deprecated. Use CareerContextBuilder + the LLM career coach instead.'
  );
}

function roadmapToPhases() {
  throw new Error(
    'roadmapToPhases is deprecated. Use buildPathPlanFromCoachPlan instead.'
  );
}

module.exports = {
  generateStructuredRoadmap,
  roadmapToPhases,
};
