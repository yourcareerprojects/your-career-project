const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const occupationController = require('../controllers/occupationController');
const CareerPath = require('../models/CareerPath');
const escoService = require('../services/escoService');
const { applyLocalizedFieldsToCareerPathList, applyLocalizedFieldsToCareerPathPayload } = require('../utils/localizedResponse');
const {
  attachSkillsToCareerPath,
  buildLocalizedSkillsResponse,
  validateSkillPayload,
} = require('../services/careerPathSkillService');

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
    let titles = await CareerPath.find({}, 'title').lean();
    titles = applyLocalizedFieldsToCareerPathList(titles, lang);
    res.json({ success: true, titles: titles.map(t => t.title).filter(Boolean) });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/occupations/search?q=<text>&limit=<n>[&includeHidden=1]
// Search canonical titles + ESCO altLabels synonyms.
router.get('/search', async (req, res) => {
  try {
    const lang = req.language;
    const qRaw = (req.query?.q ?? '').toString().trim();
    const limit = Math.min(Math.max(Number.parseInt(String(req.query?.limit ?? '20'), 10) || 20, 1), 50);
    const includeHidden = String(req.query?.includeHidden ?? '0') === '1';

    if (!qRaw) {
      return res.json({ success: true, results: [] });
    }

    // Basic throttle against overly-broad queries
    if (qRaw.length < 2) {
      return res.json({ success: true, results: [] });
    }

    const rx = new RegExp(escapeRegExp(qRaw), 'i');

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

    let docs = await CareerPath.find(
      { $or: or },
      { escoId: 1, title: 1, altTitles: 1, hiddenTitles: 1, altTitlesDe: 1, hiddenTitlesDe: 1 }
    ).limit(limit).lean();
    docs = applyLocalizedFieldsToCareerPathList(docs, lang);

    const results = docs.map((doc) => {
      const title = doc?.title || '';
      const altTitles = Array.isArray(doc?.altTitles) ? doc.altTitles.filter(Boolean) : [];
      const hiddenTitles = Array.isArray(doc?.hiddenTitles) ? doc.hiddenTitles.filter(Boolean) : [];

      let matchedBy = 'title';
      let matchedValue = title;

      if (title && rx.test(title)) {
        matchedBy = 'title';
        matchedValue = title;
      } else {
        const altMatch = altTitles.find((t) => typeof t === 'string' && rx.test(t));
        if (altMatch) {
          matchedBy = 'altTitles';
          matchedValue = altMatch;
        } else if (includeHidden) {
          const hiddenMatch = hiddenTitles.find((t) => typeof t === 'string' && rx.test(t));
          if (hiddenMatch) {
            matchedBy = 'hiddenTitles';
            matchedValue = hiddenMatch;
          }
        }
      }

      const synonymsPreview = altTitles
        .filter((t) => typeof t === 'string' && t && t.toLowerCase() !== String(title).toLowerCase())
        .slice(0, 2);

      return {
        escoId: doc.escoId,
        title,
        matchedBy,
        matchedValue,
        synonymsPreview,
      };
    });

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
      doc = await CareerPath.findById(String(careerPathId)).lean();
    }
    if (!doc && escoId) {
      doc = await CareerPath.findOne({ escoId: String(escoId) }).lean();
    }

    // Fallback: try title match (case-insensitive exact match)
    if (!doc && title) {
      const tRx = new RegExp(`^${String(title).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      doc = await CareerPath.findOne({
        $or: [
          { 'title.en': tRx },
          { 'title.de': tRx },
        ],
      }).lean();
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