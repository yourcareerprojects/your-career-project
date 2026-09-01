/**
 * Pipeline step: generate exploration candidates from ranked delta matches.
 */

const logger = require('../../../../utils/logger');
const careerExplorationService = require('../../careerExplorationService');
const { collectRatedAndAcceptedJobIds } = require('../collectors/ratedJobsCollector');
const { collectPreviouslyShownJobIds } = require('../collectors/previouslyShownJobsCollector');
const { rankExplorationCandidates } = require('../../explorationRankingService');

/**
 * @param {{
 *   pipelineId: string,
 *   userId: string,
 *   deltaJobMatches: object[],
 *   changeScore: number,
 *   reasons: string[],
 *   previousSnapshot?: object,
 *   currentSnapshot?: object,
 *   language?: 'en'|'de',
 *   recentlyRatedJobIds?: string[],
 *   acceptedJobIds?: string[],
 *   previouslyShownJobIds?: string[],
 *   explorationSize?: number,
 *   gate?: object,
 * }} ctx
 * @returns {Promise<{
 *   triggerLevel: string,
 *   explorationJobs: object[],
 *   explanation: string,
 *   ranking: object,
 * }>}
 */
async function generateExplorationStep(ctx) {
  let recentlyRatedJobIds = ctx.recentlyRatedJobIds;
  let acceptedJobIds = ctx.acceptedJobIds;
  let previouslyShownJobIds = ctx.previouslyShownJobIds;

  if (!recentlyRatedJobIds || !acceptedJobIds) {
    const collected = await collectRatedAndAcceptedJobIds(ctx.userId);
    recentlyRatedJobIds = collected.recentlyRatedJobIds;
    acceptedJobIds = collected.acceptedJobIds;
  }

  if (!previouslyShownJobIds) {
    previouslyShownJobIds = await collectPreviouslyShownJobIds(ctx.userId);
  }

  const presentation = ctx.gate?.presentation || {};
  const minJobs = Math.max(1, Number(presentation.minJobs) || 1);
  const maxJobs = Math.max(
    minJobs,
    Math.min(10, Number(presentation.maxJobs) || Number(ctx.explorationSize) || 5)
  );

  const ranking = rankExplorationCandidates(ctx.deltaJobMatches, {
    previouslyShownJobIds,
  });

  const targetCount = Math.min(maxJobs, ranking.ranked.length);

  const exploration = await careerExplorationService.generateCareerExploration({
    deltaJobMatches: ranking.ranked,
    identityChangeScore: {
      changeScore: ctx.changeScore,
      reasons: ctx.reasons || [],
    },
    previousIdentity: ctx.previousSnapshot,
    currentIdentity: ctx.currentSnapshot,
    recentlyRatedJobIds,
    acceptedJobIds,
    targetCount,
    bypassTriggerLevelGate: true,
    config: {
      language: ctx.language === 'en' ? 'en' : 'de',
      thresholds: {
        MIN_JOBS: minJobs,
        MAX_JOBS: maxJobs,
        DEFAULT_JOBS: targetCount || maxJobs,
      },
    },
  });

  logger.info('identity.pipeline.step.generate_exploration', {
    pipelineId: ctx.pipelineId,
    userId: String(ctx.userId),
    triggerLevel: exploration.triggerLevel,
    minJobs,
    maxJobs,
    targetCount,
    candidateCount: ranking.candidateCount,
    excludedPreviouslyShown: ranking.excludedCount,
    jobCount: exploration.explorationJobs.length,
    explanation: exploration.explanation,
    sources: exploration.explorationJobs.map((j) => j.source),
    prominence: presentation.prominence,
  });

  return {
    ...exploration,
    ranking: {
      candidateCount: ranking.candidateCount,
      excludedPreviouslyShown: ranking.excludedCount,
      surfacedCount: exploration.explorationJobs.length,
    },
  };
}

module.exports = { generateExplorationStep };
