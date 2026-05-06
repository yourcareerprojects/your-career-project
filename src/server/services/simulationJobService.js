const SimulationJob = require('../models/SimulationJob');

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

module.exports = {
  createSimulationJob,
  ensureDocumentEnrichmentRefreshJobQueued,
};
