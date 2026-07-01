const { getEnglishDomainName } = require('./i18nFields');
const {
  normalizeSkillDomainDedupeKey,
  chooseCanonicalSkillDomainVariant,
  dedupeSkillDomainCatalogEntries,
  uniqStrings,
} = require('./skillDomainHarmonization');

function coerceSkillLabelToI18n(labelValue) {
  if (labelValue == null) return null;
  if (typeof labelValue === 'string') {
    const s = labelValue.trim();
    return s ? { en: s, de: null } : null;
  }
  if (typeof labelValue === 'object' && !Array.isArray(labelValue)) {
    if (typeof labelValue.en === 'string' && labelValue.en.trim() !== '') {
      return {
        en: labelValue.en.trim(),
        de: labelValue.de == null || labelValue.de === '' ? null : String(labelValue.de).trim(),
      };
    }
    if (labelValue.de != null && typeof labelValue.de === 'string' && labelValue.de.trim() !== '') {
      const d = labelValue.de.trim();
      return { en: d, de: d };
    }
  }
  return null;
}

/**
 * @param {Array<{ key: string, label: object }>} skills
 * @param {Map<string, number>} [keyCounts]
 */
function buildSkillHarmonizationPlan(skills = [], keyCounts = new Map()) {
  const variantsByDedupeKey = new Map();

  for (const skill of skills) {
    const labelI18n = coerceSkillLabelToI18n(skill?.label);
    if (!labelI18n?.en || !skill?.key) continue;
    const key = skill.key;
    const dedupeKey = normalizeSkillDomainDedupeKey(labelI18n);
    if (!dedupeKey) continue;
    let variants = variantsByDedupeKey.get(dedupeKey);
    if (!variants) {
      variants = new Map();
      variantsByDedupeKey.set(dedupeKey, variants);
    }
    if (!variants.has(key)) {
      variants.set(key, { key, domainI18n: labelI18n });
    }
  }

  const canonicalByDedupeKey = new Map();
  const keyAliasMap = new Map();
  for (const [dedupeKey, variants] of variantsByDedupeKey.entries()) {
    const canonical = chooseCanonicalSkillDomainVariant([...variants.values()], keyCounts);
    canonicalByDedupeKey.set(dedupeKey, canonical);
    for (const variantKey of variants.keys()) {
      keyAliasMap.set(variantKey, canonical.key);
    }
  }

  return { canonicalByDedupeKey, keyAliasMap, keyCounts };
}

/**
 * @param {Array<{ key: string, label: string, labelI18n: { en: string, de?: string | null } }>} entries
 * @param {Map<string, number>} [keyCounts]
 */
function dedupeSkillCatalogEntries(entries = [], keyCounts = new Map()) {
  return dedupeSkillDomainCatalogEntries(
    entries.map((entry) => ({
      key: entry.key,
      label: entry.label,
      domainI18n: entry.labelI18n,
    })),
    keyCounts,
  ).map((entry) => ({
    key: entry.key,
    label: entry.label,
    labelI18n: entry.domainI18n,
    dedupeKey: entry.dedupeKey,
  }));
}

/**
 * Map variant display labels (EN/DE) to canonical labels for profile harmonization.
 * @param {Array<{ key: string, label: object }>} skills
 * @param {Map<string, string>} keyAliasMap
 * @returns {{ en: Map<string, string>, de: Map<string, string> }}
 */
function buildSkillLabelAliasMaps(skills = [], keyAliasMap = new Map()) {
  const skillByKey = new Map(skills.map((skill) => [skill.key, skill]));
  const en = new Map();
  const de = new Map();
  const dedupeKeyByLabel = new Map();

  for (const skill of skills) {
    const canonicalKey = keyAliasMap.get(skill.key) || skill.key;
    const canonicalSkill = skillByKey.get(canonicalKey);
    if (!canonicalSkill) continue;
    const canonicalI18n = coerceSkillLabelToI18n(canonicalSkill.label);
    const variantI18n = coerceSkillLabelToI18n(skill.label);
    if (!canonicalI18n) continue;
    const dedupeKey = normalizeSkillDomainDedupeKey(canonicalI18n);
    if (variantI18n?.en) {
      en.set(variantI18n.en.toLowerCase(), canonicalI18n.en);
      dedupeKeyByLabel.set(variantI18n.en.toLowerCase(), dedupeKey);
    }
    if (variantI18n?.de) {
      const canonicalDe = canonicalI18n.de || canonicalI18n.en;
      de.set(variantI18n.de.toLowerCase(), canonicalDe);
      dedupeKeyByLabel.set(variantI18n.de.toLowerCase(), dedupeKey);
    }
    if (canonicalI18n.en) {
      en.set(canonicalI18n.en.toLowerCase(), canonicalI18n.en);
      dedupeKeyByLabel.set(canonicalI18n.en.toLowerCase(), dedupeKey);
    }
    if (canonicalI18n.de) {
      de.set(canonicalI18n.de.toLowerCase(), canonicalI18n.de);
      dedupeKeyByLabel.set(canonicalI18n.de.toLowerCase(), dedupeKey);
    }
  }

  return { en, de, dedupeKeyByLabel };
}

function harmonizeSkillNameList(names = [], labelAliasMaps = { en: new Map(), de: new Map(), dedupeKeyByLabel: new Map() }) {
  const seen = new Set();
  const out = [];
  for (const raw of names) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    const canonical = labelAliasMaps.de.get(lower)
      || labelAliasMaps.en.get(lower)
      || trimmed;
    const dedupeKey = labelAliasMaps.dedupeKeyByLabel.get(lower)
      || normalizeSkillDomainDedupeKey({ en: canonical, de: canonical });
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(canonical);
  }
  return out;
}

function mergeCanonicalSkillLabel(canonicalLabel, aliasLabels = []) {
  const base = coerceSkillLabelToI18n(canonicalLabel) || { en: '', de: null };
  let de = base.de;
  for (const aliasLabel of aliasLabels) {
    const alias = coerceSkillLabelToI18n(aliasLabel);
    if (!de && alias?.de) de = alias.de;
  }
  return { en: base.en, de: de ?? null };
}

module.exports = {
  coerceSkillLabelToI18n,
  buildSkillHarmonizationPlan,
  dedupeSkillCatalogEntries,
  buildSkillLabelAliasMaps,
  harmonizeSkillNameList,
  mergeCanonicalSkillLabel,
  normalizeSkillDedupeKey: normalizeSkillDomainDedupeKey,
  uniqStrings,
};
