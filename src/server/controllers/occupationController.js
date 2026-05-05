const escoService = require('../services/escoService');

/**
 * Triggers ESCO data fetch and caching.
 * Returns the number of cached occupations.
 */
async function updateESCOOccupations(req, res) {
  try {
    // NOTE: This can be a long-running operation if you request large limits.
    // Prefer running the CLI script for full syncs; keep the API for smaller batches.
    const {
      limit,
      offset,
      pageSize,
      enrich,
      enrichSkills,
      throttleMs,
      normalizeExisting
    } = req.body || {};

    const results = await escoService.cacheESCOOccupations({
      limit: typeof limit === 'number' ? limit : 50,
      offset: typeof offset === 'number' ? offset : 0,
      pageSize: typeof pageSize === 'number' ? pageSize : 100,
      enrich: Boolean(enrich),
      enrichSkills: enrichSkills === undefined ? true : Boolean(enrichSkills),
      throttleMs: typeof throttleMs === 'number' ? throttleMs : 0,
    });

    let normalization = null;
    if (normalizeExisting) {
      normalization = await escoService.normalizeCareerPathRequiredSkills();
    }

    res.json({
      success: true,
      count: results.length,
      normalization
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  updateESCOOccupations,
}; 