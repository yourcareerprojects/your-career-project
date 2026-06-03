const { NARRATIVE_CACHE_QUALITY_VERSION } = require('../../../constants/narrativeCacheQuality');
const { EMPTY_PLACEHOLDER } = require('../../services/jobAnalysis/dimensionSummaryGenerator');

const POLISHED_WHO_LINE =
  'You clarify problems early, then ship small experiments that reduce delivery risk for the team. '
  + 'You keep stakeholders aligned with concrete demos instead of abstract status updates.';

const POLISHED_SUMMARIES = {
  skillDomains:
    'You bring engineering strengths that help teams move from ambiguity to shipped outcomes with confidence. '
    + 'You translate that strength into practical decisions when priorities compete.',
  skills:
    'You apply JavaScript and related tools to build reliable interfaces across the stack. '
    + 'You keep codebases maintainable as products evolve and requirements shift.',
  skillsInDevelopment: EMPTY_PLACEHOLDER,
  keyResponsibilities:
    'You own feature delivery end to end, from scoping through release, and keep stakeholders aligned with demos. '
    + 'You break work into milestones that reduce risk while preserving momentum.',
  domains:
    'You work in software environments where iterative delivery and clear trade-offs matter every week. '
    + 'You adapt quickly when domain context changes without losing sight of outcomes.',
};

function narrativeSummaryField(text) {
  return {
    original_language: 'en',
    original: text,
    translations: { en: text },
  };
}

function narrativeDimension(rawItems, summaryEn) {
  return {
    raw_items: rawItems,
    summary_text: narrativeSummaryField(summaryEn),
  };
}

function buildPolishedWhoAreYou(rawAnswers = []) {
  const answers = Array.isArray(rawAnswers) ? rawAnswers : [];
  const lines = [0, 1, 2, 3, 4].map((i) => (
    String(answers[i] || '').trim() ? POLISHED_WHO_LINE : 'No personal profile information available yet.'
  ));
  const json = JSON.stringify(lines);
  return {
    raw_answers: answers,
    summary_text: narrativeSummaryField(json),
  };
}

function buildPolishedStructuredUserInfo(lists = {}) {
  const keys = ['skillDomains', 'skills', 'skillsInDevelopment', 'keyResponsibilities', 'domains'];
  const out = {};
  for (const key of keys) {
    const rawItems = Array.isArray(lists[key]) ? lists[key] : [];
    const summary = rawItems.length === 0
      ? EMPTY_PLACEHOLDER
      : (POLISHED_SUMMARIES[key] || POLISHED_SUMMARIES.skills);
    out[key] = narrativeDimension(rawItems, summary);
  }
  return out;
}

function stampQualityEnrichment(enrichment = {}) {
  return {
    qualityVersion: NARRATIVE_CACHE_QUALITY_VERSION,
    ...enrichment,
  };
}

module.exports = {
  NARRATIVE_CACHE_QUALITY_VERSION,
  POLISHED_WHO_LINE,
  POLISHED_SUMMARIES,
  narrativeSummaryField,
  narrativeDimension,
  buildPolishedWhoAreYou,
  buildPolishedStructuredUserInfo,
  stampQualityEnrichment,
};
