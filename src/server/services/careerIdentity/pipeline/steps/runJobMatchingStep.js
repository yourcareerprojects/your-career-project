/**
 * Pipeline step: job matching for exploration (initial fit vs delta).
 * Grounds matches in the user profile when available (skills / hybrid OOTB fit).
 */

const logger = require('../../../../utils/logger');
const deltaJobMatchingService = require('../../deltaJobMatchingService');
const { IDENTITY_PIPELINE_MODES } = require('../../../../../constants/identityPipelineModes');
const { loadRolePoolForDeltaMatching } = require('../collectors/rolePoolLoader');
const {
  loadUserProfileForExplorationMatching,
} = require('../collectors/userProfileForExplorationLoader');
const {
  createProfileFitScorer,
  warmProfileFitVectors,
} = require('../../profileFitScorer');

/**
 * @param {{
 *   pipelineId: string,
 *   userId: string,
 *   explorationMode: string,
 *   previousSnapshot: object|null,
 *   currentSnapshot: object,
 *   roles?: object[],
 *   rolePoolLimit?: number,
 *   userProfile?: object|null,
 *   skillLabels?: string[],
 * }} ctx
 * @returns {Promise<{
 *   deltaJobMatches: object[],
 *   rolePoolSize: number,
 *   matchSource: string,
 *   profileGrounding: boolean,
 * }>}
 */
async function runJobMatchingStep(ctx) {
  const profileLoad = await loadUserProfileForExplorationMatching({
    userId: ctx.userId,
    pipelineId: ctx.pipelineId,
    userProfile: ctx.userProfile,
  });

  const skillLabels = Array.isArray(ctx.skillLabels) && ctx.skillLabels.length > 0
    ? ctx.skillLabels
    : profileLoad.skillLabels;

  const roles =
    Array.isArray(ctx.roles) && ctx.roles.length > 0
      ? ctx.roles
      : await loadRolePoolForDeltaMatching({
          pipelineId: ctx.pipelineId,
          userId: ctx.userId,
          limit: ctx.rolePoolLimit,
          skillLabels,
        });

  const scoreProfileFit = createProfileFitScorer(profileLoad.userProfile);
  const profileGrounding = Boolean(scoreProfileFit);
  const isFirst = ctx.explorationMode === IDENTITY_PIPELINE_MODES.FIRST;

  if (profileGrounding) {
    const warmStartedAt = Date.now();
    try {
      await warmProfileFitVectors(profileLoad.userProfile);
      logger.info('identity.pipeline.step.job_matching_profile_warmed', {
        pipelineId: ctx.pipelineId,
        userId: String(ctx.userId),
        durationMs: Date.now() - warmStartedAt,
      });
    } catch (err) {
      logger.warn('identity.pipeline.step.job_matching_profile_warm_failed', {
        pipelineId: ctx.pipelineId,
        userId: String(ctx.userId),
        message: err?.message || String(err),
      });
    }
  }

  logger.info('identity.pipeline.step.job_matching_start', {
    pipelineId: ctx.pipelineId,
    userId: String(ctx.userId),
    explorationMode: ctx.explorationMode,
    rolePoolSize: roles.length,
    profileGrounding,
  });

  const matchStartedAt = Date.now();
  const matchOptions = {
    roles,
    ...(scoreProfileFit ? { scoreProfileFit } : {}),
  };

  let matchSource = isFirst ? 'initial_fit' : 'identity_delta';
  let deltaJobMatches;

  if (isFirst) {
    deltaJobMatches = await deltaJobMatchingService.matchJobsByInitialIdentityFit({
      currentIdentity: ctx.currentSnapshot,
      ...matchOptions,
    });
  } else {
    // Single pool pass: identity shortlist → parallel profile refine.
    // If delta filters empty the pool, reuse those scores for absolute-fit fallback
    // (no second OOTB scan over hundreds of roles).
    const result = await deltaJobMatchingService.matchJobsByIdentityDelta({
      previousIdentity: ctx.previousSnapshot,
      currentIdentity: ctx.currentSnapshot,
      ...matchOptions,
      fallbackToInitialFit: true,
      returnMeta: true,
    });
    // Support plain-array mocks/callers as well as { matches, matchSource }.
    if (Array.isArray(result)) {
      deltaJobMatches = result;
      matchSource = 'identity_delta';
    } else {
      deltaJobMatches = Array.isArray(result?.matches) ? result.matches : [];
      matchSource = result?.matchSource || 'identity_delta';
    }
    if (matchSource === 'initial_fit_fallback') {
      logger.info('identity.pipeline.step.job_matching_delta_empty_fallback', {
        pipelineId: ctx.pipelineId,
        userId: String(ctx.userId),
        fallbackMatchCount: deltaJobMatches.length,
        rolePoolSize: roles.length,
        profileGrounding,
      });
    }
  }

  logger.info('identity.pipeline.step.job_matching_done', {
    pipelineId: ctx.pipelineId,
    userId: String(ctx.userId),
    explorationMode: ctx.explorationMode,
    matchSource,
    rolePoolSize: roles.length,
    deltaMatchCount: deltaJobMatches.length,
    profileGrounding,
    durationMs: Date.now() - matchStartedAt,
    topDeltas: deltaJobMatches.slice(0, 5).map((m) => ({
      key: m.role?.escoId || m.role?._id || m.role?.id,
      delta: m.delta,
      newScore: m.newScore,
      identityFit: m.identityFit,
      profileFit: m.profileFit,
    })),
  });

  return {
    deltaJobMatches,
    rolePoolSize: roles.length,
    matchSource,
    profileGrounding,
  };
}

module.exports = { runJobMatchingStep };
