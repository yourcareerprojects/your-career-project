/**
 * Occupation text-search match classification + ranking helpers.
 * Prefer title hits over alt-title hits, and token/word matches over mid-token substrings
 * (e.g. "Tier" in "Tiere" / "Tierpfleger" over "Montierer" / "Chocolatier").
 */

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Lower score = stronger match. null = no match.
 * 0 exact, 1 strong token (starts-with or word/token-boundary), 2 mid-token substring.
 * @param {string} text
 * @param {string} query
 * @returns {number|null}
 */
function matchQuality(text, query) {
  if (typeof text !== 'string' || !text || !query) return null;
  const t = text.toLowerCase();
  const q = String(query).toLowerCase();
  const idx = t.indexOf(q);
  if (idx < 0) return null;
  if (t === q) return 0;
  if (idx === 0) return 1;
  const prev = t[idx - 1];
  // Token boundary: space, punctuation, gender star, slash, etc.
  // Same strength as starts-with so "… Tiere" ranks with "Tierpfleger", not below all prefixes.
  if (!/[\p{L}\p{N}]/u.test(prev)) return 1;
  return 2;
}

/**
 * @param {unknown[]} values
 * @param {string} query
 * @returns {{ value: string, quality: number }|null}
 */
function bestMatchInList(values, query) {
  let best = null;
  for (const value of values || []) {
    if (typeof value !== 'string' || !value) continue;
    const quality = matchQuality(value, query);
    if (quality == null) continue;
    if (
      !best ||
      quality < best.quality ||
      (quality === best.quality && value.length < best.value.length)
    ) {
      best = { value, quality };
    }
  }
  return best;
}

function asStringList(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : [];
}

/**
 * Classify how a career-path doc matched `query`, using localized display fields first,
 * then other-language title/alt fields so cross-lang synonym hits are not mislabeled as title.
 *
 * @param {object} rawDoc — lean CareerPath before localization
 * @param {object} localized — display payload (localized title / altTitles)
 * @param {string} query
 * @param {{ includeHidden?: boolean }} [options]
 * @returns {{ matchedBy: string, matchedValue: string, matchQuality: number }}
 */
function classifyOccupationSearchMatch(rawDoc, localized, query, { includeHidden = false } = {}) {
  const titleLocalized = typeof localized?.title === 'string' ? localized.title : '';
  const altLocalized = asStringList(localized?.altTitles);
  const hiddenLocalized = asStringList(localized?.hiddenTitles);

  const titleEn = typeof rawDoc?.title?.en === 'string' ? rawDoc.title.en : '';
  const titleDe = typeof rawDoc?.title?.de === 'string' ? rawDoc.title.de : '';
  const altsEn = asStringList(rawDoc?.altTitles);
  const altsDe = asStringList(rawDoc?.altTitlesDe);
  const hiddenEn = asStringList(rawDoc?.hiddenTitles);
  const hiddenDe = asStringList(rawDoc?.hiddenTitlesDe);

  const localizedTitleHit = bestMatchInList([titleLocalized], query);
  if (localizedTitleHit) {
    return {
      matchedBy: 'title',
      matchedValue: titleLocalized,
      matchQuality: localizedTitleHit.quality,
    };
  }

  const localizedAltHit = bestMatchInList(altLocalized, query);
  if (localizedAltHit) {
    return {
      matchedBy: 'altTitles',
      matchedValue: localizedAltHit.value,
      matchQuality: localizedAltHit.quality,
    };
  }

  const otherTitles = [titleEn, titleDe].filter((t) => t && t !== titleLocalized);
  const otherTitleHit = bestMatchInList(otherTitles, query);
  if (otherTitleHit) {
    return {
      matchedBy: 'title',
      matchedValue: otherTitleHit.value,
      matchQuality: otherTitleHit.quality,
    };
  }

  const otherAltHit = bestMatchInList([...altsEn, ...altsDe], query);
  if (otherAltHit) {
    return {
      matchedBy: 'altTitles',
      matchedValue: otherAltHit.value,
      matchQuality: otherAltHit.quality,
    };
  }

  if (includeHidden) {
    const localizedHiddenHit = bestMatchInList(hiddenLocalized, query);
    if (localizedHiddenHit) {
      return {
        matchedBy: 'hiddenTitles',
        matchedValue: localizedHiddenHit.value,
        matchQuality: localizedHiddenHit.quality,
      };
    }
    const otherHiddenHit = bestMatchInList([...hiddenEn, ...hiddenDe], query);
    if (otherHiddenHit) {
      return {
        matchedBy: 'hiddenTitles',
        matchedValue: otherHiddenHit.value,
        matchQuality: otherHiddenHit.quality,
      };
    }
  }

  return {
    matchedBy: 'title',
    matchedValue: titleLocalized,
    matchQuality: 99,
  };
}

function fieldMatchRank(matchedBy) {
  if (matchedBy === 'title') return 0;
  if (matchedBy === 'altTitles') return 1;
  return 2;
}

/**
 * Sort: title → alt → hidden; within each, stronger match quality first; then A–Z by title.
 * @param {{ matchedBy?: string, matchQuality?: number, title?: string }} a
 * @param {{ matchedBy?: string, matchQuality?: number, title?: string }} b
 * @param {string} lang
 * @param {{ hasQuery?: boolean }} [options]
 */
function compareOccupationSearchResults(a, b, lang, { hasQuery = true } = {}) {
  if (hasQuery) {
    const fieldDiff = fieldMatchRank(a.matchedBy) - fieldMatchRank(b.matchedBy);
    if (fieldDiff !== 0) return fieldDiff;
    const qualityDiff = (a.matchQuality ?? 99) - (b.matchQuality ?? 99);
    if (qualityDiff !== 0) return qualityDiff;
  }
  return String(a?.title || '').localeCompare(String(b?.title || ''), lang);
}

module.exports = {
  escapeRegExp,
  matchQuality,
  bestMatchInList,
  classifyOccupationSearchMatch,
  compareOccupationSearchResults,
  fieldMatchRank,
};
