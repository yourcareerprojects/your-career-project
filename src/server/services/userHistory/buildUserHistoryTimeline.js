/**
 * Build the chronological History timeline for a user.
 *
 * Milestones (oldest-first) + intervening activities that led to each milestone.
 * Combines durable flags, exploration sessions, logged UserActivityEvents,
 * and best-effort reconstruction from existing User fields.
 */

const User = require('../../models/User');
const UserActivityEvent = require('../../models/UserActivityEvent');
const SimulationJob = require('../../models/SimulationJob');
const IdentityExplorationSession = require('../../models/IdentityExplorationSession');
const {
  ACTIVITY_TYPES,
  MILESTONE_TYPES,
  MILESTONE_ACTIVITY_TYPES,
} = require('../../../constants/userHistoryActivity');
const { PROFILE_FILLED_THRESHOLD } = require('./logUserActivity');

/**
 * Lazy require — avoids circular import with profileController.
 * @returns {{ computeProfileCompletion: Function, MIN_SIMULATION_PROFILE_COMPLETION_PCT: number }}
 */
function getProfileCompletionDeps() {
  return require('../../controllers/profileController').__careerSimulationDepsForEngine;
}

/**
 * @param {unknown} title
 * @param {string} language
 * @returns {string}
 */
function localizeTitle(title, language = 'en') {
  if (title == null || title === '') return '';
  if (typeof title === 'string' || typeof title === 'number') return String(title);
  if (typeof title === 'object' && !Array.isArray(title)) {
    const code = (language && String(language).toLowerCase().split('-')[0]) || 'en';
    const pick = (v) => {
      if (v == null) return '';
      const s = String(v).trim();
      return s;
    };
    if (pick(title[code])) return pick(title[code]);
    if (pick(title.en)) return pick(title.en);
    if (pick(title.de)) return pick(title.de);
    for (const v of Object.values(title)) {
      const t = pick(v);
      if (t) return t;
    }
  }
  return String(title);
}

/**
 * @param {Date|string|number|null|undefined} value
 * @returns {Date|null}
 */
function asDate(value) {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * @param {Date} date
 * @returns {string}
 */
function toIso(date) {
  return date.toISOString();
}

/**
 * Earliest first-simulation timestamp from jobs / last run / saved sims / flag.
 * @param {object} user
 * @returns {Promise<Date|null>}
 */
async function resolveFirstSimulationAt(user) {
  const flagged = asDate(user?.profile?.historyMilestones?.firstSimulationAt);
  if (flagged) return flagged;

  const candidates = [];
  const lastDate = asDate(user?.lastSimulationResult?.date);
  if (lastDate) candidates.push(lastDate);

  for (const sim of user?.simulationResults || []) {
    if (sim?.status === 'deleted') continue;
    const ts = asDate(sim.timestamp);
    if (ts) candidates.push(ts);
  }

  const earliestJob = await SimulationJob.findOne({
    userId: user._id,
    status: 'completed',
  })
    .sort({ completedAt: 1, createdAt: 1 })
    .select({ completedAt: 1, createdAt: 1 })
    .lean();

  const jobDate = asDate(earliestJob?.completedAt) || asDate(earliestJob?.createdAt);
  if (jobDate) candidates.push(jobDate);

  if (candidates.length === 0) return null;
  return new Date(Math.min(...candidates.map((d) => d.getTime())));
}

/**
 * Estimate when profile first hit 85% if the durable flag is missing.
 * @param {object} user
 * @param {Date|null} firstSimulationAt
 * @returns {Date|null}
 */
function resolveProfileFilledAt(user, firstSimulationAt) {
  const flagged = asDate(user?.profile?.historyMilestones?.filledAt);
  if (flagged) return flagged;

  const { computeProfileCompletion, MIN_SIMULATION_PROFILE_COMPLETION_PCT } =
    getProfileCompletionDeps();
  const overall = Number(computeProfileCompletion(user.profile || {}).overall || 0);
  if (overall < (PROFILE_FILLED_THRESHOLD || MIN_SIMULATION_PROFILE_COMPLETION_PCT)) {
    return null;
  }

  // Prefer earliest evidence they could run simulations / had enough profile data.
  const candidates = [];
  if (firstSimulationAt) candidates.push(firstSimulationAt);

  for (const doc of user?.profile?.documents || []) {
    const d = asDate(doc.uploadDate);
    if (d) candidates.push(d);
  }

  const edits = user?.profile?.careerSimulationInputs?.editHistory || [];
  for (const edit of edits) {
    const d = asDate(edit.editedAt);
    if (d) candidates.push(d);
  }

  if (candidates.length > 0) {
    return new Date(Math.min(...candidates.map((d) => d.getTime())));
  }

  // Still filled but no evidence — use account creation as last resort (same month narrative).
  return asDate(user.createdAt);
}

/**
 * Reconstruct intervening activities from existing User fields (pre-logging era).
 * @param {object} user
 * @returns {Array<object>}
 */
function reconstructActivitiesFromUser(user) {
  const out = [];

  for (const doc of user?.profile?.documents || []) {
    const occurredAt = asDate(doc.uploadDate);
    if (!occurredAt) continue;
    out.push({
      id: `recon-doc-${String(doc._id || doc.path || occurredAt.getTime())}`,
      type: ACTIVITY_TYPES.DOCUMENT_UPLOADED,
      summaryKey: ACTIVITY_TYPES.DOCUMENT_UPLOADED,
      occurredAt,
      meta: { documentName: doc.name || null, documentType: doc.type || null },
      source: 'reconstructed',
    });
  }

  const edits = user?.profile?.careerSimulationInputs?.editHistory || [];
  edits.forEach((edit, index) => {
    const occurredAt = asDate(edit.editedAt);
    if (!occurredAt) return;
    const changes = edit.changes && typeof edit.changes === 'object' ? edit.changes : {};
    const section =
      changes.section ||
      (changes.recalculatedFromProfile ? 'profile' : null) ||
      Object.keys(changes)[0] ||
      null;
    out.push({
      id: `recon-edit-${index}-${occurredAt.getTime()}`,
      type: ACTIVITY_TYPES.PROFILE_SECTION_UPDATED,
      summaryKey: ACTIVITY_TYPES.PROFILE_SECTION_UPDATED,
      occurredAt,
      meta: { section },
      source: 'reconstructed',
    });
  });

  for (const sim of user?.simulationResults || []) {
    if (sim?.status === 'deleted') continue;
    const occurredAt = asDate(sim.timestamp);
    if (!occurredAt) continue;
    out.push({
      id: `recon-sim-save-${sim.id || occurredAt.getTime()}`,
      type: ACTIVITY_TYPES.SIMULATION_SAVED,
      summaryKey: ACTIVITY_TYPES.SIMULATION_SAVED,
      occurredAt,
      meta: { simulationName: sim.name || null, simulationId: sim.id || null },
      source: 'reconstructed',
    });
  }

  return out;
}

/**
 * @param {object} event lean UserActivityEvent
 * @returns {object}
 */
function mapLoggedActivity(event) {
  return {
    id: String(event._id),
    type: event.type,
    summaryKey: event.summaryKey || event.type,
    occurredAt: asDate(event.occurredAt) || asDate(event.createdAt),
    meta: event.meta || undefined,
    source: 'logged',
  };
}

/**
 * Deduplicate near-identical activities (logged vs reconstructed) by type + day + coarse meta.
 * Prefer logged entries.
 * @param {Array<object>} activities
 * @returns {Array<object>}
 */
function dedupeActivities(activities) {
  const byKey = new Map();
  const sorted = [...activities].sort((a, b) => {
    const ta = a.occurredAt?.getTime() || 0;
    const tb = b.occurredAt?.getTime() || 0;
    if (ta !== tb) return ta - tb;
    // Prefer logged over reconstructed when equal
    if (a.source === 'logged' && b.source !== 'logged') return -1;
    if (b.source === 'logged' && a.source !== 'logged') return 1;
    return 0;
  });

  for (const activity of sorted) {
    if (!activity.occurredAt) continue;
    const day = activity.occurredAt.toISOString().slice(0, 10);
    const metaHint =
      activity.meta?.simulationId ||
      activity.meta?.stepId ||
      activity.meta?.documentName ||
      activity.meta?.section ||
      activity.meta?.traitId ||
      '';
    const key = `${activity.type}|${day}|${metaHint}`;
    if (byKey.has(key)) continue;
    byKey.set(key, activity);
  }

  return Array.from(byKey.values()).sort(
    (a, b) => (a.occurredAt?.getTime() || 0) - (b.occurredAt?.getTime() || 0)
  );
}

/**
 * Attach activities that fall after the previous milestone and on/before this milestone.
 * Leftover activities after the final milestone are returned as `recentActivities`.
 * @param {Array<object>} milestones
 * @param {Array<object>} activities
 * @returns {{ milestones: Array<object>, recentActivities: Array<object> }}
 */
function attachActivitiesToMilestones(milestones, activities) {
  const intervening = activities.filter(
    (a) => a.occurredAt && !MILESTONE_ACTIVITY_TYPES.has(a.type)
  );
  const claimed = new Set();

  const withActivities = milestones.map((milestone, index) => {
    const prevAt = index === 0 ? null : milestones[index - 1].occurredAt;
    const currAt = milestone.occurredAt;
    const ledTo = intervening.filter((a) => {
      const t = a.occurredAt.getTime();
      if (prevAt && t <= prevAt.getTime()) return false;
      return t <= currAt.getTime();
    });
    ledTo.forEach((a) => claimed.add(a.id));

    return {
      ...milestone,
      activities: ledTo.map((a) => ({
        id: a.id,
        type: a.type,
        summaryKey: a.summaryKey,
        occurredAt: toIso(a.occurredAt),
        meta: a.meta || undefined,
      })),
    };
  });

  const recentActivities = intervening
    .filter((a) => !claimed.has(a.id))
    .map((a) => ({
      id: a.id,
      type: a.type,
      summaryKey: a.summaryKey,
      occurredAt: toIso(a.occurredAt),
      meta: a.meta || undefined,
    }));

  return { milestones: withActivities, recentActivities };
}

/**
 * @param {string|import('mongoose').Types.ObjectId} userId
 * @param {{ language?: string }} [options]
 * @returns {Promise<{ milestones: object[] }>}
 */
async function buildUserHistoryTimeline(userId, options = {}) {
  const language = options.language === 'de' ? 'de' : 'en';

  const user = await User.findById(userId)
    .select({
      createdAt: 1,
      profile: 1,
      lastSimulationResult: 1,
      simulationResults: 1,
    })
    .lean();

  if (!user) {
    const err = new Error('User not found');
    err.status = 404;
    throw err;
  }

  const [loggedEvents, unlockSessions] = await Promise.all([
    UserActivityEvent.find({ userId }).sort({ occurredAt: 1 }).lean(),
    IdentityExplorationSession.find({
      userId,
      status: 'completed',
      'explorationJobs.0': { $exists: true },
    })
      .sort({ createdAt: 1 })
      .select({ createdAt: 1, explorationJobs: 1, changeScore: 1, triggerSource: 1 })
      .lean(),
  ]);

  const firstSimulationAt = await resolveFirstSimulationAt(user);
  const profileFilledAt = resolveProfileFilledAt(user, firstSimulationAt);
  const createdAt = asDate(user.createdAt) || new Date();

  /** @type {Array<object>} */
  const milestones = [
    {
      id: 'milestone-profile_created',
      type: MILESTONE_TYPES.PROFILE_CREATED,
      occurredAt: createdAt,
      meta: undefined,
    },
  ];

  if (profileFilledAt) {
    milestones.push({
      id: 'milestone-profile_filled',
      type: MILESTONE_TYPES.PROFILE_FILLED,
      occurredAt: profileFilledAt,
      meta: undefined,
    });
  }

  if (firstSimulationAt) {
    milestones.push({
      id: 'milestone-first_simulation',
      type: MILESTONE_TYPES.FIRST_SIMULATION,
      occurredAt: firstSimulationAt,
      meta: undefined,
    });
  }

  for (const session of unlockSessions) {
    const occurredAt = asDate(session.createdAt);
    if (!occurredAt) continue;
    const roles = (session.explorationJobs || []).map((job) => ({
      title: localizeTitle(job.title, language),
      escoId: job.escoId || null,
      domain: job.domain || null,
      source: job.source || null,
    }));
    milestones.push({
      id: `milestone-roles_unlocked-${String(session._id)}`,
      type: MILESTONE_TYPES.ROLES_UNLOCKED,
      occurredAt,
      meta: {
        sessionId: String(session._id),
        roles,
        roleCount: roles.length,
        changeScore: session.changeScore ?? null,
      },
    });
  }

  milestones.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());

  const loggedActivities = loggedEvents
    .map(mapLoggedActivity)
    .filter((a) => a.occurredAt);

  // Also surface completed simulation runs that only exist as lastSimulationResult
  // when no logged event exists yet (historical).
  const reconstructed = reconstructActivitiesFromUser(user);
  const lastSimDate = asDate(user?.lastSimulationResult?.date);
  if (lastSimDate) {
    reconstructed.push({
      id: `recon-sim-completed-${lastSimDate.getTime()}`,
      type: ACTIVITY_TYPES.SIMULATION_COMPLETED,
      summaryKey: ACTIVITY_TYPES.SIMULATION_COMPLETED,
      occurredAt: lastSimDate,
      meta: undefined,
      source: 'reconstructed',
    });
  }

  const activities = dedupeActivities([...loggedActivities, ...reconstructed]);
  const { milestones: withActivities, recentActivities } = attachActivitiesToMilestones(
    milestones,
    activities
  );

  return {
    milestones: withActivities.map((m) => ({
      id: m.id,
      type: m.type,
      occurredAt: toIso(m.occurredAt),
      meta: m.meta,
      activities: m.activities,
    })),
    recentActivities,
  };
}

module.exports = {
  buildUserHistoryTimeline,
  localizeTitle,
};
