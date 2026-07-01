const Skill = require('../models/Skill');
const CareerPath = require('../models/CareerPath');
const CareerPathSkill = require('../models/CareerPathSkill');
const { getEscoUriToTitleMap, findTitleForEscoUri } = require('../utils/escoUriToTitleMap');
const { normalizeLanguage } = require('../utils/languageResolution');
const {
  getLocalizedField,
  getLocalizedFieldLenient,
  getEnglishDomainName,
  assertIsLocalizedField,
} = require('../utils/i18nFields');
const {
  normalizeSkillDomainDedupeKey,
  dedupeSkillDomainCatalogEntries,
} = require('../utils/skillDomainHarmonization');
const {
  coerceSkillLabelToI18n,
  dedupeSkillCatalogEntries,
} = require('../utils/skillHarmonization');

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

function sortSkillsByLabel(skills = []) {
  return [...skills].sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), undefined, { sensitivity: 'base' }));
}

async function resolveSkillLabelsForKeys(skillKeys = [], lang = FALLBACK_LANGUAGE) {
  const normalizedLang = normalizeLanguage(lang, FALLBACK_LANGUAGE);
  const keys = Array.from(new Set((skillKeys || []).filter(Boolean)));
  if (keys.length === 0) return [];

  const labelMap = await buildSkillLabelMapByKeys(keys, normalizedLang);
  return keys.map((key) => ({
    key,
    label: labelMap.get(key) || toDisplayLabel(key.replace(/_/g, ' ')),
  }));
}

function buildHarmonizedSkillsFromDocs(skillDocs = [], skillKeys = [], keyCounts = new Map(), lang = FALLBACK_LANGUAGE) {
  const normalizedLang = normalizeLanguage(lang, FALLBACK_LANGUAGE);
  const keys = Array.from(new Set((skillKeys || []).filter(Boolean)));
  if (keys.length === 0) return [];

  const skillByKey = new Map(
    (Array.isArray(skillDocs) ? skillDocs : [])
      .filter((skill) => skill?.key)
      .map((skill) => [skill.key, skill]),
  );
  const entries = keys
    .map((key) => skillByKey.get(key))
    .filter(Boolean)
    .map((skill) => {
      const labelI18n = coerceSkillLabelToI18n(skill.label);
      return {
        key: skill.key,
        labelI18n,
        label: getLocalizedFieldLenient(skill.label, normalizedLang) || skill.key,
      };
    })
    .filter((entry) => entry.labelI18n?.en);

  return sortSkillsByLabel(
    dedupeSkillCatalogEntries(entries, keyCounts).map((entry) => ({
      key: entry.key,
      label: getLocalizedFieldLenient(entry.labelI18n, normalizedLang) || entry.label,
    })),
  );
}

async function buildHarmonizedSkillsForSelection(skillKeys = [], keyCounts = new Map(), lang = FALLBACK_LANGUAGE) {
  const keys = Array.from(new Set((skillKeys || []).filter(Boolean)));
  if (keys.length === 0) return [];

  const skills = await Skill.find({ key: { $in: keys } }, { key: 1, label: 1 }).lean();
  return buildHarmonizedSkillsFromDocs(skills, keys, keyCounts, lang);
}

/**
 * Distinct required and optional skills used across career paths (for profile skill picker).
 * Optional list excludes keys that also appear as required.
 */
async function listDistinctRoleSkillsForSelection(lang = FALLBACK_LANGUAGE) {
  const normalizedLang = normalizeLanguage(lang, FALLBACK_LANGUAGE);
  const links = await CareerPathSkill.find({}, { skillId: 1, type: 1 }).lean();

  if (links.length > 0) {
    const skillIds = Array.from(new Set(links.map((link) => String(link.skillId))));
    const skills = await Skill.find({ _id: { $in: skillIds } }, { key: 1, label: 1 }).lean();
    const skillById = new Map(skills.map((skill) => [String(skill._id), skill]));

    const requiredKeys = new Set();
    const optionalKeys = new Set();
    const keyCounts = new Map();
    for (const link of links) {
      const skillDoc = skillById.get(String(link.skillId));
      if (!skillDoc?.key) continue;
      keyCounts.set(skillDoc.key, (keyCounts.get(skillDoc.key) || 0) + 1);
      if (link.type === TYPE_OPTIONAL) optionalKeys.add(skillDoc.key);
      else requiredKeys.add(skillDoc.key);
    }

    const requiredSkills = buildHarmonizedSkillsFromDocs(
      skills,
      [...requiredKeys],
      keyCounts,
      normalizedLang,
    );
    const optionalOnlyKeys = [...optionalKeys].filter((key) => !requiredKeys.has(key));
    const optionalSkills = buildHarmonizedSkillsFromDocs(
      skills,
      optionalOnlyKeys,
      keyCounts,
      normalizedLang,
    );

    return { requiredSkills, optionalSkills };
  }

  const careerPaths = await CareerPath.find(
    {},
    { requiredSkills: 1, 'skillModel.optional_skills': 1 }
  ).lean();

  const requiredKeys = new Set();
  const optionalKeys = new Set();
  for (const careerPath of careerPaths) {
    for (const label of careerPath.requiredSkills || []) {
      const key = normalizeSkillKey(label);
      if (key) requiredKeys.add(key);
    }
    for (const label of careerPath.skillModel?.optional_skills || []) {
      const key = normalizeSkillKey(label);
      if (key) optionalKeys.add(key);
    }
  }

  const requiredSkills = sortSkillsByLabel(
    await resolveSkillLabelsForKeys([...requiredKeys], normalizedLang)
  );
  const optionalOnlyKeys = [...optionalKeys].filter((key) => !requiredKeys.has(key));
  const optionalSkills = sortSkillsByLabel(
    await resolveSkillLabelsForKeys(optionalOnlyKeys, normalizedLang)
  );

  return { requiredSkills, optionalSkills };
}

function buildSkillDomainCatalogIndex(catalog = []) {
  const byLabel = new Map();
  const byKey = new Map();
  for (const item of catalog) {
    const key = String(item?.key || '').trim();
    const label = String(item?.label || '').trim();
    if (key) byKey.set(key.toLowerCase(), item);
    if (label) byLabel.set(label.toLowerCase(), item);
  }
  return { byLabel, byKey };
}

const SKILL_DOMAIN_COACHING_SHORTLIST_LIMIT = 60;
const SKILL_DOMAIN_PICKER_RECOMMENDATION_LIMIT = 24;
const SKILL_DOMAIN_SEARCH_RESULT_LIMIT = 40;
const SKILL_DOMAIN_SEARCH_MIN_QUERY_LENGTH = 2;
const ROLE_SKILL_DOMAIN_CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
const SKILL_PICKER_RECOMMENDATION_LIMIT = 24;
const SKILL_SEARCH_RESULT_LIMIT = 40;
const SKILL_SEARCH_MIN_QUERY_LENGTH = 2;
const SKILL_DOMAIN_FUZZY_MATCH_MIN_SCORE = 0.34;

const roleSkillDomainCatalogCache = new Map();
const roleSkillCatalogCache = new Map();
const roleSkillCatalogInflight = new Map();

function tokenizeForDomainRelevance(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function scoreSkillDomainAgainstText(domain, text, precomputed = {}) {
  const label = String(domain?.label || '').trim();
  if (!label) return 0;
  const labelLower = domain?._labelLower || label.toLowerCase();
  const textLower = precomputed.textLower ?? String(text || '').toLowerCase();
  if (!textLower) return 0;
  if (textLower.includes(labelLower)) return 1;
  const labelTokens = domain?._labelTokens || tokenizeForDomainRelevance(label);
  if (labelTokens.length === 0) return 0;
  const textTokens = precomputed.textTokens || tokenizeForDomainRelevance(textLower);
  let overlap = 0;
  for (const labelToken of labelTokens) {
    if (textTokens.includes(labelToken)) {
      overlap += 1;
      continue;
    }
    const prefixHit = textTokens.some((answerToken) => (
      (labelToken.length >= 4 && answerToken.length >= 3)
      && (labelToken.startsWith(answerToken) || answerToken.startsWith(labelToken))
    ));
    if (prefixHit) overlap += 0.5;
  }
  return overlap / labelTokens.length;
}

function findBestSkillDomainMatch(text, catalog = []) {
  const trimmed = String(text || '').trim();
  if (!trimmed || !Array.isArray(catalog) || catalog.length === 0) return null;
  const { byLabel, byKey } = buildSkillDomainCatalogIndex(catalog);
  const lower = trimmed.toLowerCase();
  const exact = byLabel.get(lower) || byKey.get(normalizeSkillKey(trimmed)) || byKey.get(lower);
  if (exact) return exact;

  let best = null;
  let bestScore = 0;
  for (const item of catalog) {
    const score = scoreSkillDomainAgainstText(item, trimmed);
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= SKILL_DOMAIN_FUZZY_MATCH_MIN_SCORE ? best : null;
}

/**
 * Pick a bounded shortlist of catalog domains relevant to coaching answers (for LLM prompts).
 * @param {Array<{ key?: string, label?: string }>} catalog
 * @param {string[]} answerTexts
 * @param {{ limit?: number }} [options]
 */
function collectCatalogCandidatesByTokens(catalog = [], tokenIndex = null, textTokens = []) {
  if (!tokenIndex || textTokens.length === 0 || catalog.length <= 150) return catalog;
  const seen = new Set();
  const candidates = [];
  for (const token of textTokens) {
    const bucket = tokenIndex.get(token);
    if (!bucket) continue;
    for (const item of bucket) {
      const dedupeKey = String(item?.key || item?.label || '').trim().toLowerCase();
      if (!dedupeKey || seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      candidates.push(item);
    }
  }
  return candidates.length > 0 ? candidates : catalog;
}

function shortlistSkillDomainsForCoaching(
  catalog = [],
  answerTexts = [],
  { limit = SKILL_DOMAIN_COACHING_SHORTLIST_LIMIT, tokenIndex = null } = {},
) {
  const combinedAnswers = (Array.isArray(answerTexts) ? answerTexts : [])
    .map((text) => String(text || '').trim())
    .filter(Boolean)
    .join('\n');
  const safeLimit = Math.max(3, Number(limit) || SKILL_DOMAIN_COACHING_SHORTLIST_LIMIT);
  const textLower = combinedAnswers.toLowerCase();
  const textTokens = tokenizeForDomainRelevance(textLower);
  const textTokenSet = new Set(textTokens);
  const scoringContext = { textLower, textTokens, textTokenSet };
  const scanCatalog = collectCatalogCandidatesByTokens(catalog, tokenIndex, textTokens);

  const scored = [];
  for (const domain of scanCatalog) {
    const labelLower = domain?._labelLower || String(domain?.label || '').trim().toLowerCase();
    if (!labelLower) continue;
    if (textLower.includes(labelLower)) {
      scored.push({ domain, score: 1 });
      continue;
    }
    const labelTokens = domain?._labelTokens;
    if (textTokens.length > 0 && Array.isArray(labelTokens) && labelTokens.length > 0) {
      let hasTokenOverlap = false;
      for (const labelToken of labelTokens) {
        if (textTokenSet.has(labelToken)) {
          hasTokenOverlap = true;
          break;
        }
        const prefixHit = textTokens.some((answerToken) => (
          (labelToken.length >= 4 && answerToken.length >= 3)
          && (labelToken.startsWith(answerToken) || answerToken.startsWith(labelToken))
        ));
        if (prefixHit) {
          hasTokenOverlap = true;
          break;
        }
      }
      if (!hasTokenOverlap) continue;
    }
    const score = scoreSkillDomainAgainstText(domain, combinedAnswers, scoringContext);
    if (score > 0) scored.push({ domain, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.domain?.label || '').localeCompare(String(b.domain?.label || ''), undefined, { sensitivity: 'base' });
  });

  const maxScore = scored[0]?.score || 0;
  const seenDedupeKeys = new Set();
  const pickUnique = (domains) => {
    const out = [];
    for (const domain of domains) {
      const dedupeKey = domain?.dedupeKey
        || normalizeSkillDomainDedupeKey(domain?.domainI18n || { en: domain?.label });
      if (!dedupeKey || seenDedupeKeys.has(dedupeKey)) continue;
      seenDedupeKeys.add(dedupeKey);
      out.push(domain);
      if (out.length >= safeLimit) break;
    }
    return out;
  };

  if (maxScore <= 0) {
    const stride = Math.max(1, Math.floor(catalog.length / safeLimit));
    const fallback = [];
    for (let i = 0; i < catalog.length; i += stride) {
      fallback.push(catalog[i]);
    }
    return pickUnique(fallback);
  }

  return pickUnique(scored.map((row) => row.domain));
}

/**
 * Match user/LLM labels to canonical skill domain catalog entries (localized label strings).
 * @param {string[]} labels
 * @param {Array<{ key?: string, label?: string }>} catalog
 * @param {{ maxItems?: number }} [options]
 * @returns {string[]}
 */
function normalizeSkillDomainSelection(labels = [], catalog = [], { maxItems } = {}) {
  const seen = new Set();
  const out = [];
  for (const raw of labels) {
    const match = findBestSkillDomainMatch(raw, catalog);
    if (!match) continue;
    const canonicalLabel = String(match.label || '').trim();
    const dedupeKey = match.dedupeKey
      || normalizeSkillDomainDedupeKey(match.domainI18n || { en: canonicalLabel });
    if (!canonicalLabel || !dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(canonicalLabel);
    if (maxItems && out.length >= maxItems) break;
  }
  return out;
}

function formatSkillDomainCatalogForPrompt(catalog = []) {
  const seen = new Set();
  const labels = [];
  for (const item of catalog) {
    const dedupeKey = item?.dedupeKey
      || normalizeSkillDomainDedupeKey(item?.domainI18n || { en: item?.label });
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const label = String(item?.label || '').trim();
    if (label) labels.push(label);
  }
  return labels.join(', ');
}

async function getCachedRoleSkillDomainCatalog(lang = FALLBACK_LANGUAGE) {
  const normalizedLang = normalizeLanguage(lang, FALLBACK_LANGUAGE);
  const cached = roleSkillDomainCatalogCache.get(normalizedLang);
  if (cached && Date.now() - cached.at < ROLE_SKILL_DOMAIN_CATALOG_CACHE_TTL_MS) {
    return cached.skillDomains;
  }
  const { skillDomains } = await listDistinctRoleSkillDomainsForSelection(normalizedLang);
  roleSkillDomainCatalogCache.set(normalizedLang, { at: Date.now(), skillDomains });
  return skillDomains;
}

function mergeSkillDomainCatalogResults(primary = [], extra = [], limit = SKILL_DOMAIN_SEARCH_RESULT_LIMIT) {
  const seen = new Set();
  const out = [];
  const safeLimit = Math.max(1, Number(limit) || SKILL_DOMAIN_SEARCH_RESULT_LIMIT);
  for (const item of [...primary, ...extra]) {
    const dedupeKey = item?.dedupeKey
      || normalizeSkillDomainDedupeKey(item?.domainI18n || { en: item?.label });
    const fallbackKey = String(item?.label || '').trim().toLowerCase();
    const key = dedupeKey || fallbackKey;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= safeLimit) break;
  }
  return out;
}

function searchSkillDomainCatalog(catalog = [], query = '', { limit = SKILL_DOMAIN_SEARCH_RESULT_LIMIT } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < SKILL_DOMAIN_SEARCH_MIN_QUERY_LENGTH) return [];
  const normalizedQuery = q.replace(/\s+/g, ' ');
  const keyQuery = normalizedQuery.replace(/\s+/g, '_');
  const matches = catalog.filter((item) => {
    const label = String(item?.label || '').toLowerCase();
    const key = String(item?.key || '').toLowerCase();
    return label.includes(normalizedQuery) || key.includes(keyQuery);
  });
  matches.sort((a, b) => {
    const aLabel = String(a?.label || '').toLowerCase();
    const bLabel = String(b?.label || '').toLowerCase();
    const aPrefix = aLabel.startsWith(normalizedQuery) ? 0 : 1;
    const bPrefix = bLabel.startsWith(normalizedQuery) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    if (aLabel.length !== bLabel.length) return aLabel.length - bLabel.length;
    return aLabel.localeCompare(bLabel, undefined, { sensitivity: 'base' });
  });
  return mergeSkillDomainCatalogResults(matches, [], limit);
}

function resolveSelectedSkillDomainCatalogEntries(catalog = [], selectedLabels = []) {
  const labels = (Array.isArray(selectedLabels) ? selectedLabels : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (labels.length === 0) return [];
  const { byLabel } = buildSkillDomainCatalogIndex(catalog);
  const out = [];
  const seen = new Set();
  for (const label of labels) {
    const match = byLabel.get(label.toLowerCase()) || findBestSkillDomainMatch(label, catalog);
    if (!match) continue;
    const dedupeKey = match.dedupeKey
      || normalizeSkillDomainDedupeKey(match.domainI18n || { en: match.label });
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(match);
  }
  return out;
}

/**
 * Bounded search / recommendations for the manual profile skill-domain picker.
 * @param {string} lang
 * @param {{ query?: string, contextTexts?: string[], selectedLabels?: string[], limit?: number }} [options]
 */
async function searchRoleSkillDomainsForSelection(lang = FALLBACK_LANGUAGE, options = {}) {
  const catalog = await getCachedRoleSkillDomainCatalog(lang);
  const selectedEntries = resolveSelectedSkillDomainCatalogEntries(catalog, options.selectedLabels);
  const safeLimit = Math.min(
    60,
    Math.max(selectedEntries.length, Number(options.limit) || SKILL_DOMAIN_SEARCH_RESULT_LIMIT),
  );
  const query = String(options.query || '').trim();
  const contextTexts = (Array.isArray(options.contextTexts) ? options.contextTexts : [])
    .map((text) => String(text || '').trim())
    .filter(Boolean);

  if (query.length >= SKILL_DOMAIN_SEARCH_MIN_QUERY_LENGTH) {
    const matches = searchSkillDomainCatalog(catalog, query, { limit: safeLimit });
    return {
      mode: 'search',
      skillDomains: mergeSkillDomainCatalogResults(selectedEntries, matches, safeLimit),
    };
  }

  const recommendations = shortlistSkillDomainsForCoaching(catalog, contextTexts, {
    limit: SKILL_DOMAIN_PICKER_RECOMMENDATION_LIMIT,
  });
  return {
    mode: 'recommendations',
    skillDomains: mergeSkillDomainCatalogResults(selectedEntries, recommendations, safeLimit),
  };
}

function buildSkillCatalogIndex(catalog = []) {
  const byLabel = new Map();
  const byKey = new Map();
  for (const item of catalog) {
    const key = String(item?.key || '').trim();
    const label = String(item?.label || '').trim();
    if (key) byKey.set(key.toLowerCase(), item);
    if (label) byLabel.set(label.toLowerCase(), item);
  }
  return { byLabel, byKey };
}

function flattenRoleSkillCatalog(catalog = {}) {
  const requiredSkills = Array.isArray(catalog.requiredSkills) ? catalog.requiredSkills : [];
  const optionalSkills = Array.isArray(catalog.optionalSkills) ? catalog.optionalSkills : [];
  return [
    ...requiredSkills.map((skill) => ({ ...skill, skillType: TYPE_REQUIRED })),
    ...optionalSkills.map((skill) => ({ ...skill, skillType: TYPE_OPTIONAL })),
  ];
}

function splitSkillsByType(skills = []) {
  const requiredSkills = [];
  const optionalSkills = [];
  for (const skill of skills) {
    const entry = { key: skill.key, label: skill.label };
    if (skill.skillType === TYPE_OPTIONAL) optionalSkills.push(entry);
    else requiredSkills.push(entry);
  }
  return { requiredSkills, optionalSkills };
}

function mergeSkillCatalogResults(primary = [], extra = [], limit = SKILL_SEARCH_RESULT_LIMIT) {
  const seen = new Set();
  const out = [];
  const safeLimit = Math.max(1, Number(limit) || SKILL_SEARCH_RESULT_LIMIT);
  for (const item of [...primary, ...extra]) {
    const key = String(item?.key || normalizeSkillKey(item?.label) || '').trim().toLowerCase();
    const fallbackKey = String(item?.label || '').trim().toLowerCase();
    const dedupeKey = key || fallbackKey;
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(item);
    if (out.length >= safeLimit) break;
  }
  return out;
}

function searchSkillCatalog(catalog = [], query = '', { limit = SKILL_SEARCH_RESULT_LIMIT } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (q.length < SKILL_SEARCH_MIN_QUERY_LENGTH) return [];
  const normalizedQuery = q.replace(/\s+/g, ' ');
  const keyQuery = normalizedQuery.replace(/\s+/g, '_');
  const matches = catalog.filter((item) => {
    const label = String(item?.label || '').toLowerCase();
    const key = String(item?.key || '').toLowerCase();
    return label.includes(normalizedQuery) || key.includes(keyQuery);
  });
  matches.sort((a, b) => {
    const aLabel = String(a?.label || '').toLowerCase();
    const bLabel = String(b?.label || '').toLowerCase();
    const aPrefix = aLabel.startsWith(normalizedQuery) ? 0 : 1;
    const bPrefix = bLabel.startsWith(normalizedQuery) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    if (aLabel.length !== bLabel.length) return aLabel.length - bLabel.length;
    return aLabel.localeCompare(bLabel, undefined, { sensitivity: 'base' });
  });
  return mergeSkillCatalogResults(matches, [], limit);
}

function resolveSelectedSkillCatalogEntries(catalog = [], selectedLabels = []) {
  const labels = (Array.isArray(selectedLabels) ? selectedLabels : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  if (labels.length === 0) return [];
  const { byLabel } = buildSkillCatalogIndex(catalog);
  const out = [];
  const seen = new Set();
  for (const label of labels) {
    const match = byLabel.get(label.toLowerCase()) || findBestSkillDomainMatch(label, catalog);
    if (!match) continue;
    const dedupeKey = String(match.key || normalizeSkillKey(match.label) || match.label || '')
      .trim()
      .toLowerCase();
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(match);
  }
  return out;
}

function attachScoringMetadataToFlatCatalog(flatCatalog = []) {
  return flatCatalog.map((item) => {
    const label = String(item?.label || '').trim();
    return {
      ...item,
      _labelLower: label.toLowerCase(),
      _labelTokens: tokenizeForDomainRelevance(label),
    };
  });
}

function buildTokenInvertedIndex(flatCatalog = []) {
  const index = new Map();
  for (const item of flatCatalog) {
    const tokens = item?._labelTokens;
    if (!Array.isArray(tokens)) continue;
    for (const token of tokens) {
      let bucket = index.get(token);
      if (!bucket) {
        bucket = [];
        index.set(token, bucket);
      }
      bucket.push(item);
    }
  }
  return index;
}

function buildRoleSkillSearchBundle(catalog = {}) {
  const flatCatalog = attachScoringMetadataToFlatCatalog(flattenRoleSkillCatalog(catalog));
  return {
    catalog,
    flatCatalog,
    catalogIndex: buildSkillCatalogIndex(flatCatalog),
    tokenIndex: buildTokenInvertedIndex(flatCatalog),
  };
}

async function getCachedRoleSkillCatalog(lang = FALLBACK_LANGUAGE) {
  const bundle = await getCachedRoleSkillSearchBundle(lang);
  return bundle.catalog;
}

async function getCachedRoleSkillSearchBundle(lang = FALLBACK_LANGUAGE) {
  const normalizedLang = normalizeLanguage(lang, FALLBACK_LANGUAGE);
  const cached = roleSkillCatalogCache.get(normalizedLang);
  if (cached && Date.now() - cached.at < ROLE_SKILL_DOMAIN_CATALOG_CACHE_TTL_MS) {
    return cached.bundle;
  }
  const inflight = roleSkillCatalogInflight.get(normalizedLang);
  if (inflight) return inflight;

  const loadPromise = (async () => {
    const catalog = await listDistinctRoleSkillsForSelection(normalizedLang);
    const bundle = buildRoleSkillSearchBundle(catalog);
    roleSkillCatalogCache.set(normalizedLang, { at: Date.now(), catalog, bundle });
    return bundle;
  })().finally(() => {
    roleSkillCatalogInflight.delete(normalizedLang);
  });

  roleSkillCatalogInflight.set(normalizedLang, loadPromise);
  return loadPromise;
}

/**
 * Bounded search / recommendations for the manual profile skill picker.
 * @param {string} lang
 * @param {{ query?: string, contextTexts?: string[], selectedLabels?: string[], limit?: number }} [options]
 */
/**
 * Map free-text labels (e.g. from CV extraction) to canonical role-skill catalog entries.
 * @param {string} lang
 * @param {{ labels?: string[] }} [options]
 */
async function resolveRoleSkillsForSelection(lang = FALLBACK_LANGUAGE, options = {}) {
  const { flatCatalog } = await getCachedRoleSkillSearchBundle(lang);
  const labels = (Array.isArray(options.labels) ? options.labels : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean);
  const matched = resolveSelectedSkillCatalogEntries(flatCatalog, labels);
  return {
    skills: matched.map((item) => ({
      key: item.key,
      label: item.label,
    })),
  };
}

async function searchRoleSkillsForSelection(lang = FALLBACK_LANGUAGE, options = {}) {
  const bundle = await getCachedRoleSkillSearchBundle(lang);
  const { flatCatalog, tokenIndex } = bundle;
  const selectedEntries = resolveSelectedSkillCatalogEntries(flatCatalog, options.selectedLabels);
  const safeLimit = Math.min(
    60,
    Math.max(selectedEntries.length, Number(options.limit) || SKILL_SEARCH_RESULT_LIMIT),
  );
  const query = String(options.query || '').trim();
  const contextTexts = (Array.isArray(options.contextTexts) ? options.contextTexts : [])
    .map((text) => String(text || '').trim())
    .filter(Boolean);

  if (query.length >= SKILL_SEARCH_MIN_QUERY_LENGTH) {
    const matches = searchSkillCatalog(flatCatalog, query, { limit: safeLimit });
    const merged = mergeSkillCatalogResults(selectedEntries, matches, safeLimit);
    return {
      mode: 'search',
      ...splitSkillsByType(merged),
    };
  }

  const recommendations = shortlistSkillDomainsForCoaching(flatCatalog, contextTexts, {
    limit: SKILL_PICKER_RECOMMENDATION_LIMIT,
    tokenIndex,
  });
  const merged = mergeSkillCatalogResults(selectedEntries, recommendations, safeLimit);
  return {
    mode: 'recommendations',
    ...splitSkillsByType(merged),
  };
}

/**
 * Distinct skill domains used across career paths (for profile strength picker).
 */
async function listDistinctRoleSkillDomainsForSelection(lang = FALLBACK_LANGUAGE) {
  const normalizedLang = normalizeLanguage(lang, FALLBACK_LANGUAGE);
  const careerPaths = await CareerPath.find({}, { skillDomains: 1 }).lean();
  const domainMap = new Map();
  const keyCounts = new Map();

  for (const careerPath of careerPaths) {
    let domains = [];
    try {
      domains = toSkillDomainObjects(careerPath);
    } catch (err) {
      if (console?.warn) {
        console.warn('[careerPathSkillService] skipping skillDomains on career path', careerPath?._id, err?.message);
      }
      continue;
    }
    for (const domain of domains) {
      const key = String(domain.key || normalizeSkillKey(domain.label || '')).trim();
      if (!key) continue;
      keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
      if (domainMap.has(key)) continue;
      const label = getLocalizedFieldLenient(domain.domainI18n, normalizedLang) || domain.label;
      if (!String(label || '').trim()) continue;
      domainMap.set(key, {
        key,
        label: String(label).trim(),
        domainI18n: {
          en: domain.domainI18n.en,
          de: domain.domainI18n.de ?? null,
        },
      });
    }
  }

  const harmonized = dedupeSkillDomainCatalogEntries([...domainMap.values()], keyCounts).map((entry) => ({
    key: entry.key,
    label: getLocalizedFieldLenient(entry.domainI18n, normalizedLang) || entry.label,
    domainI18n: entry.domainI18n,
    dedupeKey: entry.dedupeKey,
  }));

  return {
    skillDomains: sortSkillsByLabel(harmonized),
  };
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
  listDistinctRoleSkillsForSelection,
  listDistinctRoleSkillDomainsForSelection,
  getCachedRoleSkillCatalog,
  getCachedRoleSkillSearchBundle,
  buildRoleSkillSearchBundle,
  buildTokenInvertedIndex,
  collectCatalogCandidatesByTokens,
  getCachedRoleSkillDomainCatalog,
  searchRoleSkillsForSelection,
  resolveRoleSkillsForSelection,
  resolveSelectedSkillCatalogEntries,
  searchRoleSkillDomainsForSelection,
  searchSkillCatalog,
  mergeSkillCatalogResults,
  flattenRoleSkillCatalog,
  splitSkillsByType,
  searchSkillDomainCatalog,
  mergeSkillDomainCatalogResults,
  normalizeSkillDomainSelection,
  formatSkillDomainCatalogForPrompt,
  shortlistSkillDomainsForCoaching,
  scoreSkillDomainAgainstText,
  findBestSkillDomainMatch,
  SKILL_DOMAIN_COACHING_SHORTLIST_LIMIT,
  SKILL_DOMAIN_PICKER_RECOMMENDATION_LIMIT,
  SKILL_DOMAIN_SEARCH_RESULT_LIMIT,
  SKILL_DOMAIN_SEARCH_MIN_QUERY_LENGTH,
};
