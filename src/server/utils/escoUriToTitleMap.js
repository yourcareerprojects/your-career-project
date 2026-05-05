/**
 * Map ESCO skill concept URIs → English preferred label (from bundled CSV).
 * Used to resolve requiredSkills entries stored as http(s):// URIs to canonical Skill.key lookups.
 */
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');

const SKILLS_CSV_PATH = path.join(
  __dirname,
  '../../../ESCO dataset - v1.2.0 - classification - en - csv/skills_en.csv',
);

let _map = null;
let _loadPromise = null;

async function getEscoUriToTitleMap() {
  if (_map) return _map;
  if (_loadPromise) return _loadPromise;

  _loadPromise = new Promise((resolve) => {
    const map = {};
    if (!fs.existsSync(SKILLS_CSV_PATH)) {
      _map = map;
      return resolve(map);
    }
    fs.createReadStream(SKILLS_CSV_PATH)
      .pipe(csv())
      .on('data', (row) => {
        const uri = row['conceptUri'];
        const title = row['preferredLabel'];
        if (uri && title) map[String(uri).trim()] = String(title).trim();
      })
      .on('end', () => {
        _map = map;
        resolve(map);
      })
      .on('error', () => {
        _map = map;
        resolve(map);
      });
  });

  return _loadPromise;
}

/**
 * @param {string} uri
 * @param {Record<string, string>} uriMap
 * @returns {string|null}
 */
function findTitleForEscoUri(uri, uriMap) {
  if (!uri || typeof uri !== 'string') return null;
  const t = uri.trim();
  if (!t.toLowerCase().startsWith('http')) return null;
  if (uriMap[t]) return uriMap[t];
  const noSlash = t.replace(/\/+$/, '');
  for (const k of Object.keys(uriMap)) {
    if (k.replace(/\/+$/, '') === noSlash) return uriMap[k];
  }
  return null;
}

module.exports = {
  getEscoUriToTitleMap,
  findTitleForEscoUri,
};
