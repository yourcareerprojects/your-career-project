const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const occupationController = require('../controllers/occupationController');
const CareerPath = require('../models/CareerPath');
const {
  applyLocalizedFieldsToCareerPathList,
  applyLocalizedFieldsToCareerPathPayload,
} = require('../utils/localizedResponse');
const {
  attachSkillsToCareerPath,
  buildLocalizedSkillsResponse,
  validateSkillPayload,
} = require('../services/careerPathSkillService');
const {
  resolveCanonicalIndustry,
  listOccupationDomainFilterValues,
} = require('../../constants/industries');
const { mergeSimulationPoolFilter } = require('../services/simulation/simulationCareerPathPoolFilter');
const {
  escapeRegExp,
  classifyOccupationSearchMatch,
  compareOccupationSearchResults,
} = require('../utils/occupationSearchMatch');

/**
 * Parse optional domain filter (English taxonomy label).
 * @param {unknown} raw
 * @returns {string|null}
 */
function parseDomainFilter(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  return resolveCanonicalIndustry(trimmed);
}

router.post('/update-esco', occupationController.updateESCOOccupations);

// Test route to confirm router is mounted
router.get('/test', (req, res) => {
  res.json({ success: true, message: 'Occupations router is mounted!' });
});

// GET /api/occupations/titles - return all occupation titles
router.get('/titles', async (req, res) => {
  try {
    const lang = req.language;
    let titles = await CareerPath.find(mergeSimulationPoolFilter({}), 'title').lean();
    titles = applyLocalizedFieldsToCareerPathList(titles, lang);
    res.json({ success: true, titles: titles.map(t => t.title).filter(Boolean) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/occupations/search?q=<text>&limit=<n>[&includeHidden=1][&domain=<English label>]
// Search canonical titles + ESCO altLabels synonyms. Optional domain filters by CareerPath.domain.
router.get('/search', async (req, res) => {
  try {
    const lang = req.language;
    const qRaw = (req.query?.q ?? '').toString().trim();
    const includeHidden = String(req.query?.includeHidden ?? '0') === '1';
    const domainFilter = parseDomainFilter(req.query?.domain);

    if (req.query?.domain != null && String(req.query.domain).trim() && !domainFilter) {
      return res.status(400).json({ success: false, error: 'Invalid domain filter' });
    }

    const hasQuery = qRaw.length >= 2;
    const hasLimitParam = req.query?.limit != null && String(req.query.limit).trim() !== '';
    const parsedLimit = hasLimitParam
      ? Number.parseInt(String(req.query.limit), 10)
      : null;
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 50)
      : null;
    if (!hasQuery && !domainFilter) {
      return res.json({ success: true, results: [] });
    }

    const filter = {};
    if (domainFilter) {
      filter.domain = { $in: listOccupationDomainFilterValues(domainFilter) };
    }

    let rx = null;
    if (hasQuery) {
      rx = new RegExp(escapeRegExp(qRaw), 'i');
      const or = [
        { 'title.en': rx },
        { 'title.de': rx },
        { altTitles: rx },
        { altTitlesDe: rx },
      ];
      if (includeHidden) {
        or.push({ hiddenTitles: rx });
        or.push({ hiddenTitlesDe: rx });
      }
      filter.$or = or;
    }

    // Rank in memory (title → alt, word-boundary before substring), then apply limit.
    const rawDocs = await CareerPath.find(
      mergeSimulationPoolFilter(filter),
      { escoId: 1, title: 1, domain: 1, altTitles: 1, hiddenTitles: 1, altTitlesDe: 1, hiddenTitlesDe: 1 }
    ).lean();

    let results = rawDocs.map((rawDoc) => {
      const localized = applyLocalizedFieldsToCareerPathPayload(rawDoc, lang);
      const title = localized?.title || '';
      const altTitles = Array.isArray(localized?.altTitles) ? localized.altTitles.filter(Boolean) : [];

      const match = hasQuery
        ? classifyOccupationSearchMatch(rawDoc, localized, qRaw, { includeHidden })
        : { matchedBy: 'title', matchedValue: title, matchQuality: 0 };

      const synonymsPreview = altTitles
        .filter((t) => typeof t === 'string' && t && t.toLowerCase() !== String(title).toLowerCase())
        .slice(0, 2);

      return {
        escoId: rawDoc.escoId,
        title,
        domain: localized.domain || rawDoc.domain || null,
        matchedBy: match.matchedBy,
        matchedValue: match.matchedValue,
        matchQuality: match.matchQuality,
        synonymsPreview,
      };
    });

    results.sort((a, b) => compareOccupationSearchResults(a, b, lang, { hasQuery }));

    if (limit) {
      results = results.slice(0, limit);
    }

    // Keep API payload stable for clients that ignore ranking metadata.
    results = results.map(({ matchQuality: _matchQuality, ...rest }) => rest);

    return res.json({ success: true, results });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/occupations/lookup?careerPathId=<id> | ?escoId=<uri> | ?title=<title>
// Returns the CareerPath doc with localized skill labels.
router.get('/lookup', async (req, res) => {
  try {
    const lang = req.language;
    const { careerPathId, escoId, title } = req.query || {};

    if (!careerPathId && !escoId && !title) {
      return res.status(400).json({ success: false, error: 'Provide careerPathId, escoId, or title' });
    }

    let doc = null;
    if (careerPathId && mongoose.isValidObjectId(String(careerPathId))) {
      doc = await CareerPath.findOne(
        mergeSimulationPoolFilter({ _id: String(careerPathId) })
      ).lean();
    }
    if (!doc && escoId) {
      doc = await CareerPath.findOne(
        mergeSimulationPoolFilter({ escoId: String(escoId) })
      ).lean();
    }

    // Fallback: try title match (case-insensitive exact match)
    if (!doc && title) {
      const tRx = new RegExp(`^${String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      doc = await CareerPath.findOne(
        mergeSimulationPoolFilter({
          $or: [
            { 'title.en': tRx },
            { 'title.de': tRx },
          ],
        })
      ).lean();
    }

    if (!doc) {
      return res.status(404).json({ success: false, error: 'Occupation not found' });
    }

    const withAttachedSkills = await attachSkillsToCareerPath(doc, lang);
    const localizedSkills = await buildLocalizedSkillsResponse(doc, lang, console, {
      allowMissingKeys: true,
    });
    const titleDescription = applyLocalizedFieldsToCareerPathPayload(doc, lang, { includeSkillDomains: false });
    const payloadValidation = validateSkillPayload(localizedSkills);
    if (!payloadValidation.valid) {
      console.error(`[occupations.lookup] invalid skill payload: ${payloadValidation.error}`);
      if (process.env.NODE_ENV !== 'production') {
        return res.status(500).json({ success: false, error: `Invalid skill payload: ${payloadValidation.error}` });
      }
    }

    return res.json({
      success: true,
      occupation: {
        ...withAttachedSkills,
        ...titleDescription,
        ...localizedSkills,
        skillDomainsLegacy: withAttachedSkills.skillDomains || null,
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router; 