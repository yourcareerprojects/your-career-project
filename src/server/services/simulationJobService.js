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

module.exports = {
  createSimulationJob,
};
