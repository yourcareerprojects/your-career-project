/**
 * User-facing evidence explanations — cite concrete source text and trait names.
 */

const { getTraitDefinition } = require('../../../constants/identityTraitCatalog');
const { localized, normalizeEvidenceText, isJunkEvidenceText } = require('./evidenceTextUtils');

const DEFAULT_EXCERPT_MAX = 120;

function collapseWhitespace(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function formatEvidenceExcerpt(text, maxLen = DEFAULT_EXCERPT_MAX) {
  const collapsed = collapseWhitespace(text);
  if (!collapsed) return '';
  if (collapsed.length <= maxLen) return collapsed;
  const slice = collapsed.slice(0, maxLen);
  const lastSpace = slice.lastIndexOf(' ');
  const trimmed = lastSpace > maxLen * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${trimmed}…`;
}

function splitIntoSegments(text) {
  return collapseWhitespace(text)
    .split(/(?<=[.!?])\s+|[\n;•]+|(?<=(?:ieren|eln|ern|[^aeiouäöü]en|nd))\s+(?=[A-ZÄÖÜ])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function scoreSegmentForTrait(segment, traitId) {
  const def = getTraitDefinition(traitId);
  const keywords = def?.keywords || [];
  const lower = segment.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    const needle = String(keyword).toLowerCase().trim();
    if (needle.length >= 3 && lower.includes(needle)) score += 1;
  }
  for (const name of [def?.name?.en, def?.name?.de]) {
    const words = String(name || '')
      .toLowerCase()
      .split(/[^a-zäöüß0-9]+/i)
      .filter((word) => word.length >= 4);
    for (const word of words) {
      if (lower.includes(word)) score += 2;
    }
  }
  return score;
}

/**
 * Return a quote only when a trait-relevant segment exists.
 * Never fall back to an unrelated opening sentence or JSON/contact junk.
 *
 * @param {string} sourceText
 * @param {string} traitId
 * @param {number} [maxLen]
 * @returns {string}
 */
function pickRelevantExcerpt(sourceText, traitId, maxLen = DEFAULT_EXCERPT_MAX) {
  const normalized = normalizeEvidenceText(sourceText);
  if (!normalized || isJunkEvidenceText(normalized)) return '';

  const segments = splitIntoSegments(normalized);
  const candidates = segments.length > 0 ? segments : [normalized];

  let best = '';
  let bestScore = 0;
  for (const segment of candidates) {
    if (isJunkEvidenceText(segment)) continue;
    const score = scoreSegmentForTrait(segment, traitId);
    if (score > bestScore) {
      bestScore = score;
      best = segment;
    }
  }

  if (bestScore <= 0 || !best) return '';
  return formatEvidenceExcerpt(best, maxLen);
}

function traitLabels(traitId) {
  const def = getTraitDefinition(traitId);
  return {
    en: def?.name?.en || traitId,
    de: def?.name?.de || traitId,
  };
}

function shortQuotedEvidence(excerpt) {
  return localized(
    `There you wrote fittingly: "${excerpt}"`,
    `Dort schreibst du passend: „${excerpt}“`
  );
}

function shortSupportFallback() {
  return localized(
    'This supports this trait.',
    'Das stützt dieses Merkmal.'
  );
}

function explainReflectionEvidence(traitId, field, sourceText) {
  const excerpt = pickRelevantExcerpt(sourceText, traitId) || formatEvidenceExcerpt(sourceText);
  if (!excerpt || isJunkEvidenceText(excerpt)) return shortSupportFallback();
  return shortQuotedEvidence(excerpt);
}

function explainWhoAreYouEvidence(traitId, sourceText) {
  const excerpt = pickRelevantExcerpt(sourceText, traitId) || formatEvidenceExcerpt(sourceText);
  if (!excerpt || isJunkEvidenceText(excerpt)) return shortSupportFallback();
  return shortQuotedEvidence(excerpt);
}

function explainStructuredProfileEvidence(traitId, chunk, sourceText) {
  const excerpt = pickRelevantExcerpt(sourceText, traitId) || formatEvidenceExcerpt(sourceText);
  if (!excerpt || isJunkEvidenceText(excerpt)) return shortSupportFallback();
  return shortQuotedEvidence(excerpt);
}

function explainCvEvidence(traitId, docName, sourceText) {
  const excerpt = pickRelevantExcerpt(sourceText, traitId) || formatEvidenceExcerpt(sourceText);
  if (!excerpt || isJunkEvidenceText(excerpt)) {
    return localized(
      'This is supported by your uploaded CV.',
      'Das wird durch deinen hochgeladenen Lebenslauf gestützt.'
    );
  }

  return localized(
    `In your CV you write fittingly: "${excerpt}"`,
    `In deinem Lebenslauf schreibst du passend: „${excerpt}“`
  );
}

function explainSimulationEvidence(traitId, title, descriptionText) {
  const detailText = collapseWhitespace(descriptionText) || collapseWhitespace(title);
  const excerpt = pickRelevantExcerpt(detailText, traitId);
  const titleOnly = collapseWhitespace(title);

  if (!excerpt || excerpt === titleOnly) {
    return localized(
      'You rated this role positively in a simulation.',
      'Du hast diese Rolle in einer Simulation positiv bewertet.'
    );
  }

  return shortQuotedEvidence(excerpt);
}

module.exports = {
  formatEvidenceExcerpt,
  pickRelevantExcerpt,
  explainReflectionEvidence,
  explainWhoAreYouEvidence,
  explainStructuredProfileEvidence,
  explainCvEvidence,
  explainSimulationEvidence,
};
