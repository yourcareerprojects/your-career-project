/**
 * Job Analysis Controller
 *
 * Handles HTTP requests for job description analysis endpoints.
 */

const logger = require('../utils/logger');
const { extractKeyResponsibilities } = require('../services/jobAnalysis/responsibilityExtractor');

/**
 * POST /api/job-analysis/extract-responsibilities
 *
 * Body:
 *   - title            (string, required)
 *   - description       (string, required)
 *   - required_skills   (string, optional)
 *   - optional_skills   (string, optional)
 *
 * Returns:
 *   { success: true, key_responsibilities: string[], extraction_confidence: number }
 */
async function extractResponsibilities(req, res) {
  try {
    const { title, description, required_skills, optional_skills } = req.body || {};

    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ success: false, error: '"title" is required and must be a non-empty string' });
    }
    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ success: false, error: '"description" is required and must be a non-empty string' });
    }

    const result = await extractKeyResponsibilities({
      title: title.trim(),
      description: description.trim(),
      required_skills: typeof required_skills === 'string' ? required_skills.trim() : undefined,
      optional_skills: typeof optional_skills === 'string' ? optional_skills.trim() : undefined,
    });

    return res.json({
      success: true,
      ...result,
    });
  } catch (err) {
    logger.error(
      'Job analysis responsibility extraction failed',
      err instanceof Error ? err : { message: String(err) }
    );
    const status = err.message.includes('OPENAI_API_KEY') ? 503 : 500;
    return res.status(status).json({ success: false, error: err.message });
  }
}

module.exports = {
  extractResponsibilities,
};
