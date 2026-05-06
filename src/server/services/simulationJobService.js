const SimulationJob = require('../models/SimulationJob');

/** Jobs left in `running` (crash, deploy, OOM, hang) never return to the queue; reclaim them after this age. */
const DEFAULT_STALE_RUNNING_MS = 60 * 60 * 1000;

function getStaleRunningCutoffMs() {
  const raw = process.env.SIMULATION_JOB_STALE_RUNNING_MS;
  if (raw == null || raw === '') return DEFAULT_STALE_RUNNING_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALE_RUNNING_MS;
}

/**
 * Re-queue simulation jobs stuck in `running` so workers can claim them again.
 * Call once per worker tick before claiming a new job.
 */
async function reclaimStaleRunningSimulationJobs() {
  const staleMs = getStaleRunningCutoffMs();
  const cutoff = new Date(Date.now() - staleMs);
  const res = await SimulationJob.updateMany(
    {
      status: 'running',
      $or: [
        { startedAt: { $lt: cutoff } },
        // Legacy / bad rows: running but never got startedAt
        { startedAt: null, updatedAt: { $lt: cutoff } },
      ],
    },
    {
      $set: {
        status: 'queued',
        progress: 0,
        startedAt: null,
        error: 'Automatically requeued: previous worker run did not finish (timeout, crash, or deploy).',
      },
    }
  );
  return res.modifiedCount ?? res.nModified ?? 0;
}

async function createSimulationJob(data = {}) {
  const {
    userId,
    language = 'en',
    payload = {},
  } = data;

  return SimulationJob.create({
    userId,
    language,
    status: 'queued',
    payload,
  });
}

async function ensureDocumentEnrichmentRefreshJobQueued({ userId, language = 'en' }) {
  const existing = await SimulationJob.findOne({
    userId,
    status: { $in: ['queued', 'running'] },
    'payload.jobType': 'document_enrichment_refresh',
  })
    .select({ _id: 1 })
    .lean();

  if (existing?._id) {
    return { jobId: String(existing._id), created: false };
  }

  const job = await createSimulationJob({
    userId,
    language,
    payload: { jobType: 'document_enrichment_refresh' },
  });
  return { jobId: String(job._id), created: true };
}

/** Read-only projection for the simulation child process (no lifecycle updates). */
async function getSimulationJobReadOnly(jobId) {
  return SimulationJob.findById(jobId).select({ userId: 1, language: 1, payload: 1 }).lean();
}

module.exports = {
  createSimulationJob,
  ensureDocumentEnrichmentRefreshJobQueued,
  getSimulationJobReadOnly,
  reclaimStaleRunningSimulationJobs,
};
