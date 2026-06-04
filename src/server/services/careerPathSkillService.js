const Skill = require('../models/Skill');
const CareerPathSkill = require('../models/CareerPathSkill');
const { getEscoUriToTitleMap, findTitleForEscoUri } = require('../utils/escoUriToTitleMap');
const { normalizeLanguage } = require('../utils/languageResolution');
const {
  getLocalizedField,
  getLocalizedFieldLenient,
  getEnglishDomainName,
  assertIsLocalizedField,
} = require('../utils/i18nFields');

const TYPE_REQUIRED = 'required';
const TYPE_OPTIONAL = 'optional';
const FALLBACK_LANGUAGE = 'en';
const skillLabelCache = {
  en: new Map(),
  de: new Map(),
};

let skillModelDeprecationWarned = false;

/**
 * Persisted steps / CareerPath may still use plain string domain labels or partial i18n.
 * Normalizes to strict { en, de? } for embedding and getEnglishDomainName.
 * @param {unknown} domainValue — string | { en?, de? } | other
 * @returns {{ en: string, de: string | null } | null}
 */
function coerceSkillDomainLabelToI18n(domainValue) {
  if (domainValue == null) return null;
  if (typeof domainValue === 'string') {
    const s = domainValue.trim();
    return s ? { en: s, de: null } : null;
  }
  if (typeof domainValue === 'object' && !Array.isArray(domainValue)) {
    if (typeof domainValue.en === 'string' && domainValue.en.trim() !== '') {
      return {
        en: domainValue.en.trim(),
        de: domainValue.de == null || domainValue.de === '' ? null : String(domainValue.de).trim(),
      };
    }
    if (domainValue.de != null && typeof domainValue.de === 'string' && domainValue.de.trim() !== '') {
      const d = domainValue.de.trim();
      return { en: d, de: d };
    }
    for (const k of Object.keys(domainValue)) {
      const v = domainValue[k];
      if (v != null && typeof v === 'string' && String(v).trim()) {
        return { en: String(v).trim(), de: null };
      }
    }
  }
  return null;
}

function normalizeSkillKey(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+/g, '_');
}

function toDisplayLabel(input) {
  const cleaned = String(input || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(' ');
}

/**
 * @param {{ key: string, label: object }} skill — `label` must be embedded i18n
 */
function getSkillLabel(skill, lang = FALLBACK_LANGUAGE) {
  const language = normalizeLanguage(lang, FALLBACK_LANGUAGE);
  assertIsLocalizedField(skill?.label, `Skill(${skill?.key || 'unknown'}).label`);
  return getLocalizedField(skill.label, language);
}

function mapLegacySkillsToLocalized(skills = []) {
  return (Array.isArray(skills) ? skills : [])
    .filter(Boolean)
    .map((label) => {
      const key = normalizeSkillKey(label);
      return { key: key || normalizeSkillKey(toDisplayLabel(label)), label: toDisplayLabel(label) };
    });
}

function parseSkillEntry(entry) {
  if (typeof entry === 'string') {
    const raw = entry.trim();
    if (!raw) return null;
    const key = normalizeSkillKey(raw);
    return { key, label: raw };
  }
  if (entry && typeof entry === 'object') {
    const rawKey = typeof entry.key === 'string' ? entry.key.trim() : '';
    const rawLabel =
      typeof entry.label === 'string' ? entry.label.trim()
        : typeof entry.title === 'string' ? entry.title.trim()
          : typeof entry.name === 'string' ? entry.name.trim()
            : typeof entry.preferredLabel === 'string' ? entry.preferredLabel.trim()
              : '';
    const key = rawKey ? normalizeSkillKey(rawKey) : normalizeSkillKey(rawLabel);
    if (!key && !rawLabel) return null;
    return { key, label: rawLabel };
  }
  return null;
}

function normalizeSkillArray(input, contextLabel, logger = console) {
  const arr = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();
  for (const entry of arr) {
    const parsed = parseSkillEntry(entry);
    if (!parsed) {
      if (logger?.error) logger.error(`[SkillNormalization] Invalid skill in ${contextLabel}: ${JSON.stringify(entry)}`);
      continue;
    }
    if (!parsed.key || typeof parsed.key !== 'string' || !parsed.key.trim()) {
      if (logger?.error) logger.error(`[SkillNormalization] Invalid skill key in ${contextLabel}: ${JSON.stringify(parsed)}`);
      continue;
    }
    if (seen.has(parsed.key)) continue;
    seen.add(parsed.key);
    out.push({ key: parsed.key, label: parsed.label || '' });
  }
  return out;
}

async function buildSkillLabelMapByKeys(skillKeys = [], lang = FALLBACK_LANGUAGE) {
  const normalizedLang = normalizeLanguage(lang, FALLBACK_LANGUAGE);
  if (!skillLabelCache[normalizedLang]) {
    skillLabelCache[normalizedLang] = new Map();
  }
  const cacheForLang = skillLabelCache[normalizedLang];
  const keys = Array.from(new Set((skillKeys || []).filter(Boolean)));
  if (keys.length === 0) return new Map();
  const missingKeys = keys.filter((key) => !cacheForLang.has(key));

  if (missingKeys.length > 0) {
    const skills = await Skill.find({ key: { $in: missingKeys } }, { _id: 1, key: 1, label: 1 }).lean();
    const skillByKey = new Map(skills.map((s) => [s.key, s]));

    for (const key of missingKeys) {
      const skill = skillByKey.get(key);
      if (!skill) {
        cacheForLang.set(key, null);
        continue;
      }
      const label = getSkillLabel({ key, label: skill.label }, normalizedLang);
      cacheForLang.set(key, label || null);
    }
  }

  const out = new Map();
  for (const key of keys) {
    out.set(key, cacheForLang.get(key) || null);
  }
  return out;
}

/**
 * When requiredSkills / mapped_items store raw ESCO http(s) URIs, `normalizeSkillKey` produces a
 * non-canonical key that does not match `Skill.key`. Map URI → title via ESCO CSV, then resolve
 * the canonical `Skill` row by normalized title key.
 * @param {Map<string, string|null>} labelMap
 * @param {Array<{ key: string, label: string }>} flatSkills
 * @param {string} lang
 * @param {Record<string, string>|null} [preloadedUriMap] — from `getEscoUriToTitleMap()` (avoid double read)
 */
async function augmentLabelMapForEscoUris(labelMap, flatSkills, lang, preloadedUriMap = null) {
  if (!labelMap || !Array.isArray(flatSkills) || flatSkills.length === 0) return;
  const uriMap = preloadedUriMap || (await getEscoUriToTitleMap());
  const normalizedLang = normalizeLanguage(lang, FALLBACK_LANGUAGE);
  const pairs = [];
  for (const s of flatSkills) {
    const current = labelMap.get(s.key);
    if (current != null && current !== '') continue;
    if (typeof s.label !== 'string' || !s.label.trim().toLowerCase().startsWith('http')) continue;
    const title = findTitleForEscoUri(s.label, uriMap);
    if (!title) continue;
    const altKey = normalizeSkillKey(title);
    if (!altKey) continue;
    if (altKey === s.key) continue;
    pairs.push({ originalKey: s.key, altKey });
  }
  if (pairs.length === 0) return;
  const altKeys = [...new Set(pairs.map((p) => p.altKey))];
  const skills = await Skill.find({ key: { $in: altKeys } }, { key: 1, label: 1 }).lean();
  const byKey = new Map(skills.map((sk) => [sk.key, sk]));
  for (const { originalKey, altKey } of pairs) {
    if (labelMap.get(originalKey) != null && labelMap.get(originalKey) !== '') continue;
    const sk = byKey.get(altKey);
    if (sk && sk.label) {
      try {
        const L = getSkillLabel({ key: sk.key, label: sk.label }, normalizedLang);
        if (L) labelMap.set(originalKey, L);
      } catch (_e) {
        // bad embedded label on document
      }
    }
  }
}

/**
 * CareerPath rows use `domain`; localized API rows use top-level `label` (string or i18n).
 * @param {unknown} row
 * @returns {{ en: string, de: string | null } | null}
 */
function coerceSkillDomainRowToI18n(row) {
  if (!row || typeof row !== 'object') return null;
  return (
    coerceSkillDomainLabelToI18n(row.domain)
    ?? coerceSkillDomainLabelToI18n(row.label)
  );
}

function toSkillDomainObjects(payload = {}) {
  const modern = Array.isArray(payload.skillDomains) ? payload.skillDomains : null;
  if (modern) {
    return modern.map((domain) => {
      const domainI18n = coerceSkillDomainRowToI18n(domain);
      if (!domainI18n) {
        throw new Error('[careerPathSkillService] skillDomains[].domain could not be coerced to embedded i18n');
      }
      const labelEn = getEnglishDomainName(domainI18n);
      const key = normalizeSkillKey(domain?.key || labelEn || '');
      const itemSource = domain?.items ?? domain?.mapped_items;
      return {
        key: key || '',
        label: labelEn,
        domainI18n,
        items: normalizeSkillArray(itemSource, 'skillDomains.items'),
      };
    }).filter((d) => d.label || d.key || d.items.length > 0);
  }

  const legacy = Array.isArray(payload?.skillDomains?.skill_domains) ? payload.skillDomains.skill_domains : [];
  return legacy.map((domain) => {
    const rawD = domain?.domain;
    const domainI18n = coerceSkillDomainLabelToI18n(rawD);
    if (!domainI18n) {
      throw new Error('[careerPathSkillService] skill_domains[].domain is missing or not coercible to i18n');
    }
    const domainLabel = getEnglishDomainName(domainI18n);
    return {
      key: normalizeSkillKey(domain?.key || domainLabel || ''),
      label: domainLabel,
      domainI18n,
      items: normalizeSkillArray(domain?.mapped_items, 'skillDomains.skill_domains[].mapped_items'),
    };
  }).filter((d) => d.label || d.key || d.items.length > 0);
}

/**
 * Produces requiredSkills / optionalSkills / skillDomains with per-language string labels
 * from embedded `Skill` and domain i18n only.
 * @param {object} [options] — `{ allowMissingKeys?: boolean }` for persisted steps where a key may be absent from `Skill`
 */
async function buildLocalizedSkillsResponse(
  payload = {},
  lang = FALLBACK_LANGUAGE,
  logger = console,
  options = {}
) {
  const { allowMissingKeys = false } = options;
  const normalizedLang = normalizeLanguage(lang, FALLBACK_LANGUAGE);
  if (payload?.skillModel?.core_skills || payload?.skillModel?.optional_skills) {
    if (!skillModelDeprecationWarned && logger?.debug) {
      skillModelDeprecationWarned = true;
      logger.debug(
        '[careerPathSkillService] skillModel.core_skills/optional_skills used; prefer normalized requiredSkills/optionalSkills on new writes',
      );
    }
  }
  const requiredRaw = normalizeSkillArray(
    payload.requiredSkills ?? payload?.skillModel?.core_skills ?? [],
    'requiredSkills',
    logger
  );
  const optionalRaw = normalizeSkillArray(
    payload.optionalSkills ?? payload?.skillModel?.optional_skills ?? [],
    'optionalSkills',
    logger
  );
  const domainsRaw = toSkillDomainObjects(payload);

  for (const d of domainsRaw) {
    if (!d.key && logger?.warn) {
      logger.warn(`[careerPathSkillService] skill domain missing domain key for label "${d.label}"`);
    }
  }

  const allKeys = [...new Set([
    ...requiredRaw.map((s) => s.key),
    ...optionalRaw.map((s) => s.key),
    ...domainsRaw.flatMap((d) => d.items.map((i) => i.key)),
  ])];
  const labelMap = await buildSkillLabelMapByKeys(allKeys, normalizedLang);
  const flatForUri = [
    ...requiredRaw,
    ...optionalRaw,
    ...domainsRaw.flatMap((d) => d.items),
  ];
  const escoUriMap = await getEscoUriToTitleMap();
  await augmentLabelMapForEscoUris(labelMap, flatForUri, normalizedLang, escoUriMap);

  let unmappedSkillCount = 0;
  const toLocalized = (skill, context) => {
    const localizedLabel = labelMap.get(skill.key);
    if (localizedLabel != null && localizedLabel !== '') {
      return { key: skill.key, label: localizedLabel };
    }
    if (allowMissingKeys) {
      unmappedSkillCount += 1;
      const raw = String(skill.label || '').trim();
      if (raw && !raw.toLowerCase().startsWith('http')) {
        return { key: skill.key, label: raw };
      }
      const fromCsv = raw ? findTitleForEscoUri(raw, escoUriMap) : '';
      const fallback =
        fromCsv
        || toDisplayLabel(
          String(skill.key || '')
            .replace(/^http_data_europa_eu_esco_skill_/i, '')
            .replace(/_/g, ' ')
            .trim(),
        )
        || String(skill.key || '');
      return { key: skill.key, label: fallback };
    }
    const err = new Error(`[careerPathSkillService] missing embedded label for skill key "${skill.key}" in ${context}`);
    if (logger?.error) logger.error(err.message);
    throw err;
  };

  const localized = {
    requiredSkills: requiredRaw.map((s) => toLocalized(s, 'requiredSkills')),
    optionalSkills: optionalRaw.map((s) => toLocalized(s, 'optionalSkills')),
    skillDomains: domainsRaw.map((domain) => ({
      key: domain.key || undefined,
      label: getLocalizedFieldLenient(domain.domainI18n, normalizedLang),
      items: domain.items.map((item) => toLocalized(item, `skillDomains:${domain.key || domain.label || 'unknown'}`)),
    })),
  };

  const logSkillFallbackDebug = process.env.LOG_SKILL_FALLBACK_DEBUG === 'true';
  if (logSkillFallbackDebug && allowMissingKeys && unmappedSkillCount > 0 && typeof logger?.debug === 'function') {
    logger.debug(
      `[careerPathSkillService] ${unmappedSkillCount} skill row(s) used text fallback (no Skill doc after URI→title alias)`,
    );
  }

  for (const domain of localized.skillDomains) {
    if (!domain.label && logger?.warn) logger.warn('[careerPathSkillService] skill domain has empty label');
    if (!Array.isArray(domain.items) || domain.items.length === 0) {
      if (logger?.warn) logger.warn(`[careerPathSkillService] skill domain "${domain.key || domain.label || 'unknown'}" has no items`);
    }
  }
  return localized;
}

/**
 * Localize title/description (strings) and skill/domain labels for one career-path-shaped step
 * (simulation result row or saved step). Preserves all other step fields.
 */
async function mergeLocalizedCareerPathStep(step, lang = FALLBACK_LANGUAGE, logger = console) {
  if (!step || typeof step !== 'object') return step;
  let skillsPayload;
  try {
    skillsPayload = await buildLocalizedSkillsResponse(step, lang, logger, { allowMissingKeys: true });
  } catch (err) {
    if (logger?.warn) logger.warn(`[mergeLocalizedCareerPathStep] ${err.message}`);
    return step;
  }
  return {
    ...step,
    requiredSkills: skillsPayload.requiredSkills,
    optionalSkills: skillsPayload.optionalSkills,
    skillDomains: skillsPayload.skillDomains,
    skillModel: step.skillModel && typeof step.skillModel === 'object' ? {
      ...step.skillModel,
      core_skills: skillsPayload.requiredSkills.map((s) => s.label),
      optional_skills: skillsPayload.optionalSkills.map((s) => s.label),
    } : step.skillModel,
  };
}

function validateSkillPayload(payload) {
  const fail = (msg) => ({ valid: false, error: msg });
  if (!payload || typeof payload !== 'object') return fail('payload must be object');
  const fields = ['requiredSkills', 'optionalSkills', 'skillDomains'];
  for (const field of fields) {
    if (!Array.isArray(payload[field])) return fail(`${field} must be an array`);
  }
  const validSkillArray = (arr, label) => {
    for (const item of arr) {
      if (!item || typeof item !== 'object') return fail(`${label} contains non-object`);
      if (typeof item.key !== 'string' || !item.key.trim()) return fail(`${label} contains invalid key`);
      if (typeof item.label !== 'string') return fail(`${label} contains invalid label`);
    }
    return { valid: true };
  };
  const reqCheck = validSkillArray(payload.requiredSkills, 'requiredSkills');
  if (!reqCheck.valid) return reqCheck;
  const optCheck = validSkillArray(payload.optionalSkills, 'optionalSkills');
  if (!optCheck.valid) return optCheck;
  for (const domain of payload.skillDomains) {
    if (!domain || typeof domain !== 'object') return fail('skillDomains contains non-object');
    if (typeof domain.label !== 'string') return fail('skillDomains contains invalid label');
    if (!Array.isArray(domain.items)) return fail('skillDomains contains invalid items');
    const itemCheck = validSkillArray(domain.items, 'skillDomains.items');
    if (!itemCheck.valid) return itemCheck;
  }
  return { valid: true };
}

async function buildSkillLabelMapByKey(lang = FALLBACK_LANGUAGE) {
  const normalizedLang = normalizeLanguage(lang, FALLBACK_LANGUAGE);
  const skills = await Skill.find({}, { _id: 1, key: 1, label: 1 }).lean();
  const bySkillKey = new Map();
  for (const skill of skills) {
    if (!skill?.key) continue;
    bySkillKey.set(skill.key, getSkillLabel({ key: skill.key, label: skill.label }, normalizedLang));
  }
  return bySkillKey;
}

function localizeSkillTextArray(items = [], labelMapByKey = new Map()) {
  const arr = Array.isArray(items) ? items : [];
  return arr.map((item) => {
    const text = String(item || '').trim();
    if (!text) return text;
    const key = normalizeSkillKey(text);
    const resolved = labelMapByKey.get(key);
    if (resolved == null) {
      throw new Error(`[careerPathSkillService] no embedded Skill label for key derived from "${text}"`);
    }
    return resolved;
  });
}

async function localizeCareerPathSkillFields(careerPath, lang = FALLBACK_LANGUAGE) {
  if (!careerPath || typeof careerPath !== 'object') return careerPath;
  const labelMapByKey = await buildSkillLabelMapByKey(lang);
  const resolvedLang = normalizeLanguage(lang, FALLBACK_LANGUAGE);

  const localized = { ...careerPath };
  if (localized.skillModel && typeof localized.skillModel === 'object') {
    localized.skillModel = {
      ...localized.skillModel,
      core_skills: localizeSkillTextArray(localized.skillModel.core_skills, labelMapByKey),
      optional_skills: localizeSkillTextArray(localized.skillModel.optional_skills, labelMapByKey),
    };
  }
  if (localized.skillDomains && Array.isArray(localized.skillDomains.skill_domains)) {
    localized.skillDomains = {
      ...localized.skillDomains,
      skill_domains: localized.skillDomains.skill_domains.map((domain) => ({
        ...domain,
        domain: getLocalizedField(domain.domain, resolvedLang),
        mapped_items: localizeSkillTextArray(domain?.mapped_items, labelMapByKey),
      })),
    };
  }

  return localized;
}

async function getCareerPathSkillsMap(careerPathIds = [], lang = FALLBACK_LANGUAGE) {
  const normalizedLang = normalizeLanguage(lang, FALLBACK_LANGUAGE);
  const ids = Array.from(new Set((careerPathIds || []).filter(Boolean).map(String)));
  if (ids.length === 0) return new Map();

  const links = await CareerPathSkill.find(
    { careerPathId: { $in: ids } },
    { careerPathId: 1, skillId: 1, type: 1, order_index: 1 }
  )
    .sort({ order_index: 1, created_at: 1 })
    .lean();
  if (links.length === 0) return new Map();

  const skillIds = Array.from(new Set(links.map((l) => String(l.skillId))));
  const skills = await Skill.find({ _id: { $in: skillIds } }, { _id: 1, key: 1, label: 1 }).lean();
  const skillById = new Map();
  for (const s of skills) skillById.set(String(s._id), s);

  const map = new Map();
  for (const link of links) {
    const cpId = String(link.careerPathId);
    const skillId = String(link.skillId);
    const skillDoc = skillById.get(skillId);
    if (!skillDoc) continue;

    const skill = {
      key: skillDoc.key,
      label: getSkillLabel({ key: skillDoc.key, label: skillDoc.label }, normalizedLang),
    };

    if (!map.has(cpId)) {
      map.set(cpId, { requiredSkills: [], optionalSkills: [] });
    }
    if (link.type === TYPE_OPTIONAL) map.get(cpId).optionalSkills.push(skill);
    else map.get(cpId).requiredSkills.push(skill);
  }

  return map;
}

async function attachSkillsToCareerPath(careerPath, lang = FALLBACK_LANGUAGE, preloadedMap = null) {
  if (!careerPath || !careerPath._id) {
    return {
      ...careerPath,
      requiredSkills: mapLegacySkillsToLocalized(careerPath?.requiredSkills || []),
      optionalSkills: mapLegacySkillsToLocalized(careerPath?.skillModel?.optional_skills || []),
    };
  }

  const map = preloadedMap || (await getCareerPathSkillsMap([careerPath._id], lang));
  const linked = map.get(String(careerPath._id));
  if (linked) {
    return {
      ...careerPath,
      requiredSkills: linked.requiredSkills,
      optionalSkills: linked.optionalSkills,
    };
  }

  return {
    ...careerPath,
    requiredSkills: mapLegacySkillsToLocalized(careerPath.requiredSkills || []),
    optionalSkills: mapLegacySkillsToLocalized(careerPath?.skillModel?.optional_skills || []),
  };
}

async function attachSkillsToCareerPaths(careerPaths = [], lang = FALLBACK_LANGUAGE) {
  if (!Array.isArray(careerPaths) || careerPaths.length === 0) return careerPaths;
  const map = await getCareerPathSkillsMap(careerPaths.map((cp) => cp && cp._id).filter(Boolean), lang);
  return Promise.all(careerPaths.map((cp) => attachSkillsToCareerPath(cp, lang, map)));
}

module.exports = {
  normalizeSkillKey,
  coerceSkillDomainRowToI18n,
  toSkillDomainObjects,
  getSkillLabel,
  buildLocalizedSkillsResponse,
  mergeLocalizedCareerPathStep,
  validateSkillPayload,
  attachSkillsToCareerPath,
  attachSkillsToCareerPaths,
  localizeCareerPathSkillFields,
  toDisplayLabel,
  TYPE_REQUIRED,
  TYPE_OPTIONAL,
};
