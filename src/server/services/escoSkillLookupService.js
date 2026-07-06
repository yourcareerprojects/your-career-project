const axios = require('axios');
const { LRUCache } = require('lru-cache');
const EscoSkill = require('../models/EscoSkill');
const EscoOccupationSkillRelation = require('../models/EscoOccupationSkillRelation');
const { TIMEOUT_MS_EXTERNAL_DEFAULT } = require('../utils/httpTimeouts');

const ESCO_RESOURCE_BASE = 'https://ec.europa.eu/esco/api/resource';

const titleCache = new LRUCache({ max: 5000, ttl: 1000 * 60 * 30 });

/**
 * @param {string} uri
 * @returns {string}
 */
function canonicalEscoUri(uri) {
  return String(uri || '').trim().replace(/\/+$/, '');
}

/**
 * @param {string} uri
 * @returns {boolean}
 */
function isEscoHttpUri(uri) {
  return typeof uri === 'string' && uri.trim().toLowerCase().startsWith('http');
}

/**
 * @param {string} uri
 * @param {Record<string, string>} uriMap
 * @returns {string|null}
 */
function findTitleForEscoUri(uri, uriMap) {
  if (!isEscoHttpUri(uri)) return null;
  const canonical = canonicalEscoUri(uri);
  if (uriMap[canonical]) return uriMap[canonical];
  if (uriMap[uri.trim()]) return uriMap[uri.trim()];
  return null;
}

/**
 * @param {string[]} uris
 * @returns {string[]}
 */
function collectCanonicalUris(uris) {
  const out = new Set();
  for (const uri of uris || []) {
    if (!isEscoHttpUri(uri)) continue;
    out.add(canonicalEscoUri(uri));
  }
  return [...out];
}

/**
 * @param {string} uri
 * @returns {Promise<string|null>}
 */
async function fetchEscoSkillTitleFromApi(uri) {
  const canonical = canonicalEscoUri(uri);
  if (!canonical) return null;

  try {
    const url = `${ESCO_RESOURCE_BASE}/skill?uri=${encodeURIComponent(canonical)}`;
    const response = await axios.get(url, { timeout: TIMEOUT_MS_EXTERNAL_DEFAULT });
    const data = response.data || {};
    const title = String(
      data.title
      || data.preferredLabel?.en
      || (typeof data.preferredLabel === 'string' ? data.preferredLabel : '')
      || '',
    ).trim();
    return title || null;
  } catch (_err) {
    return null;
  }
}

/**
 * Resolve ESCO skill URIs to English titles from MongoDB (optional API backfill).
 *
 * @param {string[]} uris
 * @param {{ fetchMissing?: boolean, persistFetched?: boolean }} [options]
 * @returns {Promise<Record<string, string>>}
 */
async function resolveEscoSkillTitles(uris, options = {}) {
  const { fetchMissing = false, persistFetched = true } = options;
  const canonicalUris = collectCanonicalUris(uris);
  if (!canonicalUris.length) return {};

  const map = {};
  const pending = [];

  for (const uri of canonicalUris) {
    const cached = titleCache.get(uri);
    if (cached) {
      map[uri] = cached;
    } else {
      pending.push(uri);
    }
  }

  if (pending.length) {
    const docs = await EscoSkill.find({ uri: { $in: pending } })
      .select('uri label.en')
      .lean();

    const found = new Set();
    for (const doc of docs) {
      const title = String(doc?.label?.en || '').trim();
      if (!title) continue;
      const uri = canonicalEscoUri(doc.uri);
      map[uri] = title;
      titleCache.set(uri, title);
      found.add(uri);
    }

    if (fetchMissing) {
      for (const uri of pending) {
        if (found.has(uri)) continue;
        const title = await fetchEscoSkillTitleFromApi(uri);
        if (!title) continue;
        map[uri] = title;
        titleCache.set(uri, title);
        if (persistFetched) {
          await EscoSkill.updateOne(
            { uri },
            { $set: { uri, label: { en: title, de: null } } },
            { upsert: true },
          );
        }
      }
    }
  }

  return map;
}

/**
 * Backward-compatible helper: resolves titles for the given URIs only (not the full ESCO catalog).
 *
 * @param {string[]} [uris]
 * @returns {Promise<Record<string, string>>}
 */
async function getEscoUriToTitleMap(uris = []) {
  if (!Array.isArray(uris) || uris.length === 0) return {};
  return resolveEscoSkillTitles(uris);
}

/**
 * @param {string} occupationUri
 * @returns {Promise<{ essential: Array<{ uri: string, title: string, skillType: string }>, optional: Array<{ uri: string, title: string, skillType: string }> }>}
 */
async function getOccupationSkillEntries(occupationUri) {
  const canonical = canonicalEscoUri(occupationUri);
  if (!canonical) {
    return { essential: [], optional: [] };
  }

  const relations = await EscoOccupationSkillRelation.find({ occupationUri: canonical }).lean();
  if (!relations.length) {
    return { essential: [], optional: [] };
  }

  const skillUris = [...new Set(relations.map((row) => canonicalEscoUri(row.skillUri)).filter(Boolean))];
  const titleMap = await resolveEscoSkillTitles(skillUris, { fetchMissing: false });

  const essential = [];
  const optional = [];

  for (const rel of relations) {
    const skillUri = canonicalEscoUri(rel.skillUri);
    const entry = {
      uri: skillUri,
      title: titleMap[skillUri] || '',
      skillType: String(rel.skillType || '').toLowerCase(),
    };
    if (rel.relationType === 'essential') essential.push(entry);
    else if (rel.relationType === 'optional') optional.push(entry);
  }

  return { essential, optional };
}

module.exports = {
  canonicalEscoUri,
  isEscoHttpUri,
  findTitleForEscoUri,
  resolveEscoSkillTitles,
  getEscoUriToTitleMap,
  getOccupationSkillEntries,
  fetchEscoSkillTitleFromApi,
};
