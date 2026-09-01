/**
 * Pipeline step: persist an IdentityExplorationSession and link it on the profile.
 */

const logger = require('../../../../utils/logger');
const IdentityExplorationSession = require('../../../../models/IdentityExplorationSession');
const CareerIdentityProfile = require('../../../../models/CareerIdentityProfile');
const { IDENTITY_PIPELINE_CONFIG } = require('../../../../../constants/identityPipelineConfig');
const {
  getUnreadExplorationSession,
  isUnreadNotifiableExplorationSession,
} = require('../explorationSessionService');

function localizeTitle(title) {
  if (title == null) return null;
  if (typeof title === 'string') {
    return title.slice(0, IDENTITY_PIPELINE_CONFIG.STORED_TITLE_MAX_LENGTH);
  }
  if (typeof title === 'object') {
    const en = title.en != null ? String(title.en) : '';
    const de = title.de != null ? String(title.de) : '';
    return {
      en: en.slice(0, IDENTITY_PIPELINE_CONFIG.STORED_TITLE_MAX_LENGTH),
      de: de.slice(0, IDENTITY_PIPELINE_CONFIG.STORED_TITLE_MAX_LENGTH) || null,
    };
  }
  return null;
}

/**
 * @param {object} job
 * @returns {object}
 */
function serializeExplorationJobForStorage(job) {
  const role = job.role || {};
  return {
    careerPathId: role._id ? String(role._id) : role.careerPathId ? String(role.careerPathId) : null,
    escoId: role.escoId ? String(role.escoId) : null,
    title: localizeTitle(role.title),
    domain: role.domain ? String(role.domain) : null,
    oldScore: job.oldScore,
    newScore: job.newScore,
    delta: job.delta,
    identityFit: Number.isFinite(job.identityFit) ? job.identityFit : null,
    profileFit: Number.isFinite(job.profileFit) ? job.profileFit : null,
    source: job.source,
  };
}

/**
 * Update the profile pointer only when safe:
 * - always for notifiable completed deliveries
 * - for skip/fail only when no unread delivery is still waiting
 *
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {object} session
 * @param {boolean} isNotifiable
 */
async function linkSessionOnProfile(userId, session, isNotifiable) {
  if (isNotifiable) {
    // Keep a single Discover delivery: older unread sessions are superseded.
    await IdentityExplorationSession.updateMany(
      {
        userId,
        status: 'completed',
        seenAt: null,
        _id: { $ne: session._id },
        'explorationJobs.0': { $exists: true },
      },
      { $set: { seenAt: new Date() } }
    );

    await CareerIdentityProfile.findOneAndUpdate(
      { userId },
      { $set: { lastExplorationSessionId: session._id } },
      { upsert: false }
    );
    return;
  }

  const unread = await getUnreadExplorationSession(userId);
  if (isUnreadNotifiableExplorationSession(unread)) {
    logger.info('identity.pipeline.step.store_exploration_session.keep_unread_pointer', {
      userId: String(userId),
      keptSessionId: String(unread._id),
      ignoredSessionId: String(session._id),
      ignoredStatus: session.status,
    });
    return;
  }

  await CareerIdentityProfile.findOneAndUpdate(
    { userId },
    { $set: { lastExplorationSessionId: session._id } },
    { upsert: false }
  );
}

/**
 * @param {{
 *   pipelineId: string,
 *   userId: string,
 *   status: string,
 *   changeScore?: number,
 *   reasons?: string[],
 *   triggerLevel?: string,
 *   explanation?: string,
 *   explorationJobs?: object[],
 *   deltaMatchCount?: number,
 *   rolePoolSize?: number,
 *   language?: 'en'|'de',
 *   triggerSource?: string,
 *   errorMessage?: string|null,
 * }} ctx
 * @returns {Promise<object>} lean session
 */
async function storeExplorationSessionStep(ctx) {
  const reasons = IDENTITY_PIPELINE_CONFIG.STORE_CHANGE_REASONS
    ? (ctx.reasons || []).slice(0, 20)
    : [];

  const explorationJobs = (ctx.explorationJobs || []).map(serializeExplorationJobForStorage);
  const isNotifiable =
    ctx.status === 'completed' && explorationJobs.length > 0;

  const session = await IdentityExplorationSession.create({
    userId: ctx.userId,
    pipelineId: ctx.pipelineId,
    status: ctx.status,
    changeScore: ctx.changeScore || 0,
    reasons,
    triggerLevel: ctx.triggerLevel || 'none',
    explanation: ctx.explanation || '',
    gate: ctx.gate || undefined,
    explorationJobs,
    deltaMatchCount: ctx.deltaMatchCount || 0,
    rolePoolSize: ctx.rolePoolSize || 0,
    language: ctx.language === 'en' ? 'en' : 'de',
    triggerSource: ctx.triggerSource || 'identity:puzzle_updated',
    errorMessage: ctx.errorMessage || null,
    // Completed deliveries stay unread until the user finishes Discover ranking.
    // Skipped/failed runs are marked seen so they never toast.
    seenAt: isNotifiable ? null : new Date(),
  });

  await linkSessionOnProfile(ctx.userId, session, isNotifiable);

  if (isNotifiable) {
    try {
      const { logUserActivity, ACTIVITY_TYPES } = require('../../../userHistory/logUserActivity');
      const roles = explorationJobs.map((job) => ({
        title: job.title,
        escoId: job.escoId || null,
        domain: job.domain || null,
        source: job.source || null,
      }));
      logUserActivity(ctx.userId, {
        type: ACTIVITY_TYPES.ROLES_UNLOCKED,
        meta: {
          sessionId: String(session._id),
          roles,
          roleCount: roles.length,
          changeScore: ctx.changeScore || 0,
        },
      });
    } catch (historyErr) {
      logger.warn('identity.pipeline.step.store_exploration_session.history_log_failed', {
        error: historyErr?.message || String(historyErr),
      });
    }
  }

  logger.info('identity.pipeline.step.store_exploration_session', {
    pipelineId: ctx.pipelineId,
    userId: String(ctx.userId),
    sessionId: String(session._id),
    status: ctx.status,
    jobCount: explorationJobs.length,
  });

  return typeof session.toObject === 'function' ? session.toObject() : session;
}

module.exports = {
  storeExplorationSessionStep,
  serializeExplorationJobForStorage,
};
