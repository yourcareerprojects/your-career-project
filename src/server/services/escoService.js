const axios = require('axios');
const { TIMEOUT_MS_EXTERNAL_DEFAULT } = require('../utils/httpTimeouts');
const CareerPath = require('../models/CareerPath');
const { attachSkillsToCareerPaths } = require('./careerPathSkillService');
const { resolveEscoSkillTitles, canonicalEscoUri } = require('./escoSkillLookupService');
const { mergeSimulationPoolFilter } = require('./simulation/simulationCareerPathPoolFilter');
const { UNASSIGNED_ROLE_DOMAIN } = require('../../constants/industries');

const ESCO_API_BASE = 'https://ec.europa.eu/esco/api/v1';
const ESCO_RESOURCE_BASE = 'https://ec.europa.eu/esco/api/resource';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeSkillKey(value) {
  if (!value) return '';
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

async function withRetry(fn, { retries = 3, minDelayMs = 250, factor = 2 } = {}) {
  let delay = minDelayMs;
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(delay);
      delay *= factor;
    }
  }
}


/**
 * Fetches occupations from the ESCO API.
 * @param {Object} options - Optional query params (e.g., language, limit, offset)
 * @returns {Promise<Array>} Array of ESCO occupation objects
 */
async function fetchESCOOccupations(options = {}) {
  const { occupations } = await fetchESCOOccupationsPage(options);
  return occupations;
}

/**
 * Fetch a single page of occupations, including page metadata.
 * @param {Object} options
 * @returns {Promise<{occupations: Array, page: Object|null}>}
 */
async function fetchESCOOccupationsPage(options = {}) {
  // Add a default query for all occupations
  const params = { language: 'en', q: '*', ...options };
  const url = `${ESCO_API_BASE}/occupations`;
  try {
    const response = await withRetry(
      () => axios.get(url, { params, timeout: TIMEOUT_MS_EXTERNAL_DEFAULT }),
      { retries: 3 }
    );
    return {
      occupations: response.data?._embedded?.occupation || [],
      page: response.data?.page || null
    };
  } catch (err) {
    console.error('Error fetching ESCO occupations:', err.response ? err.response.data : err.message);
    if (err.response && err.response.status === 404) {
      throw new Error('ESCO API returned 404 Not Found. The endpoint or parameters may be incorrect.');
    } else {
      throw new Error('Failed to fetch ESCO occupations: ' + (err.response ? err.response.statusText : err.message));
    }
  }
}

/**
 * Maps an ESCO occupation object to the CareerPath model structure.
 * Does not set `domain` here — inserts use UNASSIGNED via $setOnInsert so
 * later classification is never overwritten by ESCO sync.
 * @param {Object} escoOccupation
 * @returns {Object} CareerPath-compatible object
 */
function mapOccupationToCareerPath(escoOccupation) {
  return {
    escoId: escoOccupation.uri || escoOccupation.id,
    title: { en: escoOccupation.title, de: null },
    description: { en: escoOccupation.description || '', de: null },
    requiredSkills: [], // To be filled by additional ESCO API calls if needed
    requiredSkillUris: [],
  };
}

/**
 * Fetches ESCO occupation resource payload.
 * @param {string} occupationUri
 * @returns {Promise<Object|null>}
 */
async function fetchOccupationResource(occupationUri) {
  try {
    const url = `${ESCO_RESOURCE_BASE}/occupation?uri=${encodeURIComponent(occupationUri)}`;
    const response = await withRetry(
      () => axios.get(url, { timeout: TIMEOUT_MS_EXTERNAL_DEFAULT }),
      { retries: 3 }
    );
    return response.data || null;
  } catch (err) {
    return null;
  }
}

/**
 * Extract essential skill URIs/titles from an ESCO occupation resource payload.
 * @param {Object|null} resource
 * @returns {{ skillUris: string[], skillTitles: string[] }}
 */
function extractEssentialSkills(resource) {
  const skillUris = [];
  const skillTitles = [];
  if (!resource) return { skillUris, skillTitles };

  const links = resource._links || {};
  if (Array.isArray(links.hasEssentialSkill)) {
    for (const skill of links.hasEssentialSkill) {
      if (skill?.href) skillUris.push(skill.href);
      if (skill?.title) skillTitles.push(skill.title);
    }
  }

  if (resource._embedded && Array.isArray(resource._embedded.hasEssentialSkill)) {
    for (const skill of resource._embedded.hasEssentialSkill) {
      if (skill?.uri) skillUris.push(skill.uri);
      if (skill?.title) skillTitles.push(skill.title);
    }
  }

  // Dedupe, preserve order
  const dedupe = (arr) => Array.from(new Set(arr.filter(Boolean)));
  return { skillUris: dedupe(skillUris), skillTitles: dedupe(skillTitles) };
}

/**
 * Normalize required skills shape for storage.
 * Ensures:
 * - requiredSkills: string[] of skill TITLES
 * - requiredSkillUris: string[] of URIs (if known)
 */
async function normalizeRequiredSkills({ requiredSkills, requiredSkillUris } = {}) {
  const titles = [];
  const uris = [];

  // Collect from possibly-mixed shapes
  const input = Array.isArray(requiredSkills) ? requiredSkills : [];
  for (const item of input) {
    if (!item) continue;
    if (typeof item === 'string') {
      // Could be a title OR a URI
      if (item.startsWith('http')) uris.push(item);
      else titles.push(item);
    } else if (typeof item === 'object') {
      if (typeof item.title === 'string') titles.push(item.title);
      if (typeof item.uri === 'string') uris.push(item.uri);
      if (typeof item.href === 'string') uris.push(item.href);
    }
  }

  if (Array.isArray(requiredSkillUris)) {
    for (const u of requiredSkillUris) {
      if (typeof u === 'string' && u) uris.push(u);
    }
  }

  const uniqueUris = Array.from(new Set(uris.filter(Boolean)));
  const skillMap = await resolveEscoSkillTitles(uniqueUris, { fetchMissing: true });
  for (const uri of uniqueUris) {
    const title = skillMap[canonicalEscoUri(uri)];
    if (title) titles.push(title);
  }

  const dedupe = (arr) => Array.from(
    new Set(arr.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean))
  );
  const dedupeKeys = (arr) => Array.from(new Set(arr.map(normalizeSkillKey).filter(Boolean)));

  const dedupedTitles = dedupe(titles);
  return {
    requiredSkills: dedupedTitles,
    requiredSkillUris: dedupe(uris),
    requiredSkillKeys: dedupeKeys(dedupedTitles),
  };
}

/**
 * Normalize required skills for returning to clients (no DB writes).
 * @param {Object} payload
 * @param {Array} payload.requiredSkills
 * @param {Array} payload.requiredSkillUris
 */
async function normalizeRequiredSkillsForDisplay(payload = {}) {
  return normalizeRequiredSkills(payload);
}

/**
 * Fetches ESCO occupations, maps them, and caches them in the CareerPath collection.
 * Updates existing entries and inserts new ones.
 * @param {Object} options - Optional query params for ESCO API
 * @returns {Promise<Array>} Array of cached CareerPath documents
 */
async function cacheESCOOccupations(options = {}) {
  const {
    limit = 50,
    offset = 0,
    pageSize = 100,
    enrich = false,
    enrichSkills = true,
    throttleMs = 0,
  } = options;

  const results = [];
  let fetchedTotal = 0;
  let currentOffset = offset;

  while (fetchedTotal < limit) {
    const remaining = limit - fetchedTotal;
    const pageLimit = Math.min(pageSize, remaining);

    const { occupations } = await fetchESCOOccupationsPage({ ...options, limit: pageLimit, offset: currentOffset });
    if (!occupations.length) break;

    for (const occ of occupations) {
      const mapped = mapOccupationToCareerPath(occ);

      // Optional enrichment: use the resource endpoint to improve description + essential skills
      if (enrich || enrichSkills) {
        const resource = await fetchOccupationResource(occ.uri || occ.id);

        if (resource && enrich) {
          const betterDescription =
            resource.description ||
            resource.definition ||
            occ.description ||
            '';

          if (betterDescription) {
            const prev = mapped.description;
            const de = prev && typeof prev === 'object' && Object.prototype.hasOwnProperty.call(prev, 'de') ? prev.de : null;
            mapped.description = { en: betterDescription, de: de == null ? null : de };
          }
        }

        if (resource && enrichSkills) {
          const { skillUris, skillTitles } = extractEssentialSkills(resource);
          mapped.requiredSkills = skillTitles; // titles for UI
          mapped.requiredSkillUris = skillUris; // uris for traceability
        }
      }

      // Normalize shapes no matter what
      const normalized = await normalizeRequiredSkills({
        requiredSkills: mapped.requiredSkills,
        requiredSkillUris: mapped.requiredSkillUris,
      });
      mapped.requiredSkills = normalized.requiredSkills;
      mapped.requiredSkillUris = normalized.requiredSkillUris;
      mapped.requiredSkillKeys = normalized.requiredSkillKeys;

      const doc = await CareerPath.findOneAndUpdate(
        { escoId: mapped.escoId },
        {
          $set: { ...mapped, lastUpdated: new Date() },
          // New occupations only — never reset a classified domain on sync
          $setOnInsert: { domain: UNASSIGNED_ROLE_DOMAIN },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      results.push(doc);

      if (throttleMs) await sleep(throttleMs);
    }

    fetchedTotal += occupations.length;
    currentOffset += occupations.length;
  }

  return results;
}

/**
 * Backfill/normalize required skills for existing CareerPaths in Mongo.
 * Converts object/URI arrays into consistent titles + URIs.
 */
async function normalizeCareerPathRequiredSkills({ batchSize = 250 } = {}) {
  let updated = 0;
  let scanned = 0;
  let docs;

  do {
    // Only fetch ids + requiredSkills fields to keep memory down
    docs = await CareerPath.find(
      {},
      { escoId: 1, requiredSkills: 1, requiredSkillUris: 1 },
      { limit: batchSize, skip: scanned }
    ).lean();

    if (!docs.length) break;

    for (const doc of docs) {
      const normalized = await normalizeRequiredSkills({
        requiredSkills: doc.requiredSkills,
        requiredSkillUris: doc.requiredSkillUris,
      });

      const sameTitles =
        Array.isArray(doc.requiredSkills) &&
        doc.requiredSkills.length === normalized.requiredSkills.length &&
        doc.requiredSkills.every((v, i) => v === normalized.requiredSkills[i]);

      const sameUris =
        Array.isArray(doc.requiredSkillUris) &&
        doc.requiredSkillUris.length === normalized.requiredSkillUris.length &&
        doc.requiredSkillUris.every((v, i) => v === normalized.requiredSkillUris[i]);

      const sameKeys =
        Array.isArray(doc.requiredSkillKeys) &&
        doc.requiredSkillKeys.length === normalized.requiredSkillKeys.length &&
        doc.requiredSkillKeys.every((v, i) => v === normalized.requiredSkillKeys[i]);

      if (!sameTitles || !sameUris || !sameKeys) {
        await CareerPath.updateOne(
          { escoId: doc.escoId },
          {
            $set: {
              requiredSkills: normalized.requiredSkills,
              requiredSkillUris: normalized.requiredSkillUris,
              requiredSkillKeys: normalized.requiredSkillKeys,
            },
          }
        );
        updated += 1;
      }
    }

    scanned += docs.length;
  } while (docs.length > 0);

  return { scanned, updated };
}

/**
 * Retrieves cached career paths from the database.
 * @param {Object} filter - MongoDB filter
 * @param {Object} options - Query options (limit, skip, etc.)
 * @returns {Promise<Array>} Array of CareerPath documents
 */
async function getCachedCareerPaths(filter = {}, options = {}) {
  const {
    includeLocalizedSkills = false,
    language = 'en',
    projection = null,
    forSimulationPool = false,
    ...queryOptions
  } = options || {};
  const queryFilter = forSimulationPool ? mergeSimulationPoolFilter(filter) : filter;
  const docs = await CareerPath.find(queryFilter, projection, queryOptions).lean();
  if (!includeLocalizedSkills) return docs;
  return attachSkillsToCareerPaths(docs, language);
}

module.exports = {
  fetchESCOOccupations,
  mapOccupationToCareerPath,
  cacheESCOOccupations,
  getCachedCareerPaths,
  fetchOccupationResource,
  fetchESCOOccupationsPage,
  normalizeCareerPathRequiredSkills,
  normalizeRequiredSkillsForDisplay,
  normalizeSkillKey,
}; 