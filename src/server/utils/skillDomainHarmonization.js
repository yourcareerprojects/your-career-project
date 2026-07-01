const { getEnglishDomainName } = require('./i18nFields');

const IMPORTANCE_RANK = {
  core: 3,
  important: 2,
  supporting: 1,
};

function normalizeSkillDomainKey(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\s+/g, '_');
}

/**
 * Dedupe bucket for skill domains: prefer German label, fall back to English.
 * @param {{ en?: string, de?: string | null } | null | undefined} domainI18n
 * @returns {string}
 */
function normalizeSkillDomainDedupeKey(domainI18n) {
  const de = domainI18n?.de != null ? String(domainI18n.de).trim() : '';
  if (de) return de.toLowerCase().replace(/\s+/g, ' ');
  const en = getEnglishDomainName(domainI18n);
  return en.toLowerCase().replace(/\s+/g, ' ');
}

function rankImportance(importance) {
  return IMPORTANCE_RANK[importance] || 0;
}

function pickHigherImportance(a, b) {
  return rankImportance(a) >= rankImportance(b) ? a : b;
}

function uniqStrings(items = []) {
  const seen = new Set();
  const out = [];
  for (const raw of items) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

/**
 * @param {Array<{ key?: string, domainI18n?: { en?: string, de?: string | null }, count?: number }>} variants
 * @param {Map<string, number>} [keyCounts]
 * @returns {{ key: string, domainI18n: { en: string, de: string | null } }}
 */
function chooseCanonicalSkillDomainVariant(variants = [], keyCounts = new Map()) {
  const ranked = [...variants].sort((a, b) => {
    const countA = keyCounts.get(a.key) || a.count || 0;
    const countB = keyCounts.get(b.key) || b.count || 0;
    if (countB !== countA) return countB - countA;
    return String(a.key).localeCompare(String(b.key));
  });
  const winner = ranked[0];
  return {
    key: winner.key,
    domainI18n: {
      en: winner.domainI18n.en,
      de: winner.domainI18n.de == null || winner.domainI18n.de === ''
        ? null
        : String(winner.domainI18n.de).trim(),
    },
  };
}

/**
 * Build canonical mapping from observed domain rows across career paths.
 * @param {Array<{ key: string, domainI18n: { en: string, de?: string | null } }>} rows
 * @returns {{
 *   canonicalByDedupeKey: Map<string, { key: string, domainI18n: { en: string, de: string | null } }>,
 *   keyAliasMap: Map<string, string>,
 *   keyCounts: Map<string, number>,
 * }}
 */
function buildSkillDomainHarmonizationPlan(rows = []) {
  const keyCounts = new Map();
  const variantsByDedupeKey = new Map();

  for (const row of rows) {
    if (!row?.domainI18n?.en) continue;
    const key = normalizeSkillDomainKey(row.key || row.domainI18n.en);
    if (!key) continue;
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    const dedupeKey = normalizeSkillDomainDedupeKey(row.domainI18n);
    if (!dedupeKey) continue;
    let variants = variantsByDedupeKey.get(dedupeKey);
    if (!variants) {
      variants = new Map();
      variantsByDedupeKey.set(dedupeKey, variants);
    }
    if (!variants.has(key)) {
      variants.set(key, {
        key,
        domainI18n: {
          en: row.domainI18n.en,
          de: row.domainI18n.de == null || row.domainI18n.de === ''
            ? null
            : String(row.domainI18n.de).trim(),
        },
      });
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
 * Merge skill domain rows on a single career path using German-label dedupe buckets.
 * @param {Array<{ key?: string, domain?: object, importance?: string, mapped_items?: string[] }>} rows
 * @param {Map<string, { key: string, domainI18n: { en: string, de: string | null } }>} canonicalByDedupeKey
 * @returns {Array<{ key: string, domain: { en: string, de: string | null }, importance: string, mapped_items: string[] }>}
 */
function harmonizeSkillDomainRows(rows = [], canonicalByDedupeKey = new Map()) {
  const buckets = new Map();

  for (const row of rows) {
    const domainI18n = coerceDomainFieldToI18n(row?.domain);
    if (!domainI18n?.en) continue;
    const dedupeKey = normalizeSkillDomainDedupeKey(domainI18n);
    const canonical = canonicalByDedupeKey.get(dedupeKey);
    if (!canonical) continue;

    let bucket = buckets.get(dedupeKey);
    if (!bucket) {
      bucket = {
        key: canonical.key,
        domain: {
          en: canonical.domainI18n.en,
          de: canonical.domainI18n.de,
        },
        importance: row.importance || 'supporting',
        mapped_items: [],
      };
      buckets.set(dedupeKey, bucket);
    } else {
      bucket.importance = pickHigherImportance(bucket.importance, row.importance || 'supporting');
    }
    bucket.mapped_items.push(...(Array.isArray(row.mapped_items) ? row.mapped_items : []));
  }

  return [...buckets.values()].map((row) => ({
    ...row,
    mapped_items: uniqStrings(row.mapped_items),
  }));
}

/**
 * Deduplicate catalog entries for API / coaching using German-label buckets.
 * @param {Array<{ key: string, label: string, domainI18n: { en: string, de?: string | null } }>} entries
 * @param {Map<string, number>} [keyCounts]
 * @returns {Array<{ key: string, label: string, domainI18n: { en: string, de: string | null }, dedupeKey: string }>}
 */
function dedupeSkillDomainCatalogEntries(entries = [], keyCounts = new Map()) {
  const grouped = new Map();
  for (const entry of entries) {
    if (!entry?.domainI18n?.en) continue;
    const key = normalizeSkillDomainKey(entry.key || entry.domainI18n.en);
    const dedupeKey = normalizeSkillDomainDedupeKey(entry.domainI18n);
    if (!dedupeKey) continue;
    let group = grouped.get(dedupeKey);
    if (!group) {
      group = [];
      grouped.set(dedupeKey, group);
    }
    group.push({
      key,
      domainI18n: {
        en: entry.domainI18n.en,
        de: entry.domainI18n.de == null || entry.domainI18n.de === ''
          ? null
          : String(entry.domainI18n.de).trim(),
      },
      label: entry.label,
    });
  }

  const out = [];
  for (const [dedupeKey, variants] of grouped.entries()) {
    const canonical = chooseCanonicalSkillDomainVariant(variants, keyCounts);
    const label = variants.find((v) => v.key === canonical.key)?.label
      || variants[0]?.label
      || canonical.domainI18n.en;
    out.push({
      key: canonical.key,
      label: String(label || canonical.domainI18n.en).trim(),
      domainI18n: canonical.domainI18n,
      dedupeKey,
    });
  }
  return out;
}

function coerceDomainFieldToI18n(domainValue) {
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
  }
  return null;
}

module.exports = {
  normalizeSkillDomainKey,
  normalizeSkillDomainDedupeKey,
  chooseCanonicalSkillDomainVariant,
  buildSkillDomainHarmonizationPlan,
  harmonizeSkillDomainRows,
  dedupeSkillDomainCatalogEntries,
  coerceDomainFieldToI18n,
  uniqStrings,
  pickHigherImportance,
};
