// Read normalized localized skills from backend payloads.
// Preferred shape: [{ key, label }]
// Temporary compatibility with legacy string arrays is preserved.
// Simulation step payloads also store skills on skillModel.core_skills / optional_skills (see prioritizedListGenerator).

/**
 * @param {unknown} item
 * @param {string} [lang] – UI language (e.g. en, de)
 */
function pickSkillEntryLabel(item, lang = 'en') {
  if (item == null) return '';
  if (typeof item === 'string') return item.trim();
  if (typeof item === 'object') {
    const raw = item.label ?? item.title ?? item.name ?? item.preferredLabel;
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const code = (lang && String(lang).toLowerCase().split('-')[0]) || 'en';
      if (raw[code] != null && typeof raw[code] === 'string') return String(raw[code]).trim();
      if (raw.en != null && typeof raw.en === 'string') return String(raw.en).trim();
      for (const k of Object.keys(raw)) {
        if (raw[k] != null && typeof raw[k] === 'string') return String(raw[k]).trim();
      }
    }
    if (typeof item.key === 'string' && item.key.trim()) return item.key.trim();
  }
  return '';
}

function collectUniqueSkillLabels(sources, lang) {
  /** Dedupe by canonical skill key / URI when present so merged payloads do not show duplicates */
  const byCanon = new Map();
  for (const item of sources) {
    const label = pickSkillEntryLabel(item, lang);
    if (!label) continue;
    let canon =
      typeof item === 'object' && item != null
        ? String(item.key || item.uri || '').trim()
        : '';
    if (!canon) canon = label.toLowerCase();
    byCanon.set(canon, label);
  }
  return [...byCanon.values()];
}

export function hasHumanReadableRequiredSkills(details) {
  const fromSkills = [
    ...(Array.isArray(details?.requiredSkills) ? details.requiredSkills : []),
    ...(Array.isArray(details?.skillModel?.core_skills) ? details.skillModel.core_skills : []),
  ];

  for (const item of fromSkills) {
    if (!item) continue;
    if (typeof item === 'object') {
      const title = item.label || item.title || item.name || item.preferredLabel;
      if (typeof title === 'string' && title.trim()) return true;
      if (title && typeof title === 'object' && (title.en != null || title.de != null)) return true;
      continue;
    }
    if (typeof item === 'string') {
      const s = item.trim();
      if (s) return true;
    }
  }

  return false;
}

/**
 * @param {object} [details] – career step / result payload
 * @param {string} [lang]
 */
export function getRequiredSkillLabels(details, lang = 'en') {
  const reqArr = Array.isArray(details?.requiredSkills) ? details.requiredSkills : [];
  const coreLegacy = Array.isArray(details?.skillModel?.core_skills)
    ? details.skillModel.core_skills
    : [];
  // Prefer structured requiredSkills from occupation lookup / localized API so we do not merge
  // legacy German core_skills strings alongside English requiredSkills (duplicate chips).
  const sources = reqArr.length > 0 ? reqArr : coreLegacy;
  return collectUniqueSkillLabels(sources, lang);
}

/**
 * Optional skills: top-level optionalSkills and/or skillModel.optional_skills (simulation/saved steps).
 * @param {object} [details]
 * @param {string} [lang]
 */
export function getOptionalSkillLabels(details, lang = 'en') {
  const optArr = Array.isArray(details?.optionalSkills) ? details.optionalSkills : [];
  const optLegacy = Array.isArray(details?.skillModel?.optional_skills)
    ? details.skillModel.optional_skills
    : [];
  const sources = optArr.length > 0 ? optArr : optLegacy;
  return collectUniqueSkillLabels(sources, lang);
}

