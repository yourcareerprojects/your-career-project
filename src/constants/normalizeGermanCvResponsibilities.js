/**
 * Normalize CV responsibility bullets for German profile display.
 * Rewrites common Präteritum/Perfekt/English calques into nominal or Präsens-style phrases.
 */

const EN_STARTER_TO_DE_NOMINAL = [
  ['Leading', 'Leitung von'],
  ['Managing', 'Management von'],
  ['Developing', 'Entwicklung von'],
  ['Coordinating', 'Koordination von'],
  ['Driving', 'Steuerung von'],
  ['Building', 'Aufbau von'],
  ['Planning', 'Planung von'],
  ['Supporting', 'Unterstützung von'],
  ['Analyzing', 'Analyse von'],
  ['Analysing', 'Analyse von'],
  ['Implementing', 'Implementierung von'],
  ['Conducting', 'Durchführung von'],
  ['Overseeing', 'Überwachung von'],
  ['Designing', 'Gestaltung von'],
  ['Optimizing', 'Optimierung von'],
  ['Optimising', 'Optimierung von'],
  ['Led', 'Leitung von'],
  ['Managed', 'Management von'],
  ['Developed', 'Entwicklung von'],
  ['Coordinated', 'Koordination von'],
  ['Built', 'Aufbau von'],
  ['Planned', 'Planung von'],
  ['Supported', 'Unterstützung von'],
  ['Analyzed', 'Analyse von'],
  ['Analysed', 'Analyse von'],
  ['Implemented', 'Implementierung von'],
];

const PRATERITUM_STARTERS = [
  [/^leitete\s+/i, 'Leitung von '],
  [/^entwickelte\s+/i, 'Entwicklung von '],
  [/^koordinierte\s+/i, 'Koordination von '],
  [/^betreute\s+/i, 'Betreuung von '],
  [/^optimierte\s+/i, 'Optimierung von '],
  [/^implementierte\s+/i, 'Implementierung von '],
  [/^analysierte\s+/i, 'Analyse von '],
  [/^unterstützte\s+/i, 'Unterstützung von '],
  [/^verantwortete\s+/i, 'Verantwortung für '],
  [/^plant(e)?\s+/i, 'Planung von '],
  [/^organisierte\s+/i, 'Organisation von '],
  [/^durchführte\s+/i, 'Durchführung von '],
  [/^führte\s+/i, 'Führung von '],
];

const PHRASE_REPLACEMENTS = [
  [/\bwar verantwortlich für\b/gi, 'Verantwortung für'],
  [/\bwar zuständig für\b/gi, 'Zuständigkeit für'],
  [/\bwar tätig in\b/gi, 'Tätigkeit in'],
  [/\bwar tätig als\b/gi, 'Tätigkeit als'],
  [/^ich\s+/i, ''],
  [/^wir\s+/i, ''],
];

const PERFECT_ENDINGS = [
  [/^habe\s+(.+?)\s+geleitet$/i, 'Leitung von $1'],
  [/^hat\s+(.+?)\s+geleitet$/i, 'Leitung von $1'],
  [/^habe\s+(.+?)\s+entwickelt$/i, 'Entwicklung von $1'],
  [/^hat\s+(.+?)\s+entwickelt$/i, 'Entwicklung von $1'],
  [/^(.+?)\s+geleitet$/i, 'Leitung von $1'],
  [/^(.+?)\s+entwickelt$/i, 'Entwicklung von $1'],
  [/^(.+?)\s+koordiniert$/i, 'Koordination von $1'],
  [/^(.+?)\s+implementiert$/i, 'Implementierung von $1'],
];

function capitalizeFirst(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function applyEnglishStarterMap(text) {
  for (const [en, de] of EN_STARTER_TO_DE_NOMINAL) {
    if (text.startsWith(`${en} `)) {
      return `${de} ${text.slice(en.length + 1)}`;
    }
  }
  return text;
}

function applyPrateritumStarters(text) {
  for (const [pattern, replacement] of PRATERITUM_STARTERS) {
    if (pattern.test(text)) {
      return text.replace(pattern, replacement);
    }
  }
  return text;
}

function applyPerfectEndings(text) {
  for (const [pattern, replacement] of PERFECT_ENDINGS) {
    const match = text.match(pattern);
    if (match) {
      return replacement.replace('$1', match[1].trim());
    }
  }
  return text;
}

/**
 * @param {string} text
 * @returns {string}
 */
function normalizeGermanCvResponsibilityBullet(text) {
  let s = String(text || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';

  for (const [pattern, replacement] of PHRASE_REPLACEMENTS) {
    s = s.replace(pattern, replacement).replace(/\s+/g, ' ').trim();
  }

  s = applyPerfectEndings(s);
  s = applyEnglishStarterMap(s);
  s = applyPrateritumStarters(s);

  return capitalizeFirst(s).slice(0, 220);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function looksGerman(text) {
  return /[äöüßÄÖÜ]|\b(und|der|die|das|für|mit|von|im|am|bei|zur|zum|eine|einen|einem)\b/i.test(
    String(text || '')
  );
}

/**
 * @param {string[]} items
 * @param {{ force?: boolean }} [options]
 * @returns {string[]}
 */
function normalizeGermanCvResponsibilityList(items, options = {}) {
  const force = Boolean(options.force);
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const raw = String(item || '').trim();
      if (!raw) return '';
      if (!force && !looksGerman(raw)) return raw;
      const normalized = normalizeGermanCvResponsibilityBullet(raw);
      return normalized || raw;
    })
    .filter(Boolean);
}

module.exports = {
  normalizeGermanCvResponsibilityBullet,
  normalizeGermanCvResponsibilityList,
  looksGerman,
};
