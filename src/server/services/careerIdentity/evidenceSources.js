/**
 * Evidence source collectors — extract plain text and metadata from user data.
 * Trait discovery is handled uniformly by evidenceAggregation.js.
 */

const {
  stableId,
  localized,
  textBlob,
  localizedTitles,
  pickLocalizedString,
  narrativeItems,
  splitEvidenceChunks,
  extractCvEvidenceTexts,
  isJunkEvidenceText,
  normalizeEvidenceText,
  isTextCoveredByExisting,
} = require('./evidenceTextUtils');
const {
  weightReflection,
  weightWhoAreYou,
  weightStructuredProfile,
  weightCv,
  weightSimulation,
} = require('./evidenceWeighting');
const {
  explainReflectionEvidence,
  explainWhoAreYouEvidence,
  explainStructuredProfileEvidence,
  explainCvEvidence,
  explainSimulationEvidence,
} = require('./evidenceExplanations');
const {
  getEvaluationFlow,
  listEvaluationFlowRoles,
} = require('../../utils/evaluationFlowRoles');

function evidenceRecord(fields, matchStrength) {
  return {
    ...fields,
    matchStrength: Math.max(0, Math.min(1, Number(matchStrength) || 0)),
  };
}

/**
 * @typedef {Object} TextEvidenceItem
 * @property {string} text - Plain text passed to semantic matching
 * @property {string} sourceType - reflection | profile | cv | career | simulation
 * @property {(traitId: string, strength: number) => object} toEvidence
 */

/**
 * Labels match profile page titles (onboarding identityQuestions + profilePage.structuredInfo).
 * CV and saved-role labels are intentionally separate.
 */
const REFLECTION_FIELDS = [
  {
    key: 'workEnjoyMost',
    en: 'What kind of work do you enjoy doing most?',
    de: 'Welche Arbeitstätigkeiten führst du am liebsten aus?',
  },
  {
    key: 'topicsIndustriesInterest',
    en: 'What topics are you most interested in?',
    de: 'Welche Themen interessieren dich am meisten?',
  },
  {
    key: 'naturallyGoodAt',
    en: 'What are you naturally good at or confident doing?',
    de: 'Worin bist du von Natur aus gut oder fühlst dich besonders sicher?',
  },
  {
    key: 'workEnvironmentFit',
    en: 'What kind of work environment or way of working suits you best?',
    de: 'Welche Art Arbeitsumfeld oder Arbeitsweise passt am besten zu dir?',
  },
  {
    key: 'workingLifeAchievement',
    en: 'What would you like to achieve in your working life?',
    de: 'Was möchtest du in deinem Berufsleben erreichen?',
  },
];

const PROFILE_SECTION_WHO_ARE_YOU = localized('Who are you?', 'Wer bist du?');

const STRUCTURED_PROFILE_SECTIONS = [
  {
    key: 'skillDomains',
    en: 'Your strengths',
    de: 'Deine Stärken',
  },
  {
    key: 'domains',
    en: 'Industry sectors',
    de: 'Deine Branchen',
  },
  {
    key: 'keyResponsibilities',
    en: 'Tasks & responsibilities',
    de: 'Deine Aufgaben & Verantwortungen',
  },
  {
    key: 'skills',
    en: 'Your skills',
    de: 'Deine Fähigkeiten',
  },
  {
    key: 'skillsInDevelopment',
    en: 'Your learning goals',
    de: 'Deine Lernziele',
  },
];

function parseWhoAreYouNarrativeList(summaryText, lang) {
  const raw = pickLocalizedString(summaryText, lang);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length !== REFLECTION_FIELDS.length) return null;
    return parsed.map((item) => String(item || '').trim());
  } catch {
    return null;
  }
}
/**
 * @param {object} user
 * @returns {TextEvidenceItem[]}
 */
function collectReflectionEvidence(user) {
  const items = [];
  const answers = user?.profile?.userIdentityAnswers || {};
  const timestamp = user.updatedAt || new Date();
  const reflectionTexts = [];

  for (const field of REFLECTION_FIELDS) {
    const value = String(answers[field.key] || '').trim();
    if (!value) continue;

    for (const chunk of splitEvidenceChunks(value)) {
      if (isJunkEvidenceText(chunk)) continue;
      reflectionTexts.push(chunk);
      items.push({
        text: normalizeEvidenceText(chunk),
        sourceType: 'reflection',
        toEvidence(traitId, strength) {
          return evidenceRecord(
            {
              evidenceId: stableId('reflection', field.key, traitId, chunk.slice(0, 80)),
              sourceType: 'reflection',
              sourceId: `identity:${field.key}`,
              contentKey: chunk,
              weight: weightReflection(strength),
              timestamp,
              explanation: explainReflectionEvidence(traitId, field, chunk),
              label: localized(field.en, field.de),
            },
            strength
          );
        },
      });
    }
  }

  const who = user?.profile?.who_are_you;
  // Prefer per-question AI summaries so labels match the profile identity questions.
  const narrativeEn = parseWhoAreYouNarrativeList(who?.summary_text, 'en') || [];
  const narrativeDe = parseWhoAreYouNarrativeList(who?.summary_text, 'de') || [];
  const hasPerQuestionNarratives = narrativeEn.length > 0 || narrativeDe.length > 0;

  if (hasPerQuestionNarratives) {
    for (let index = 0; index < REFLECTION_FIELDS.length; index += 1) {
      const field = REFLECTION_FIELDS[index];
      const texts = [narrativeEn[index], narrativeDe[index]].filter(Boolean);
      for (const value of texts) {
        for (const chunk of splitEvidenceChunks(value)) {
          if (isJunkEvidenceText(chunk)) continue;
          if (isTextCoveredByExisting(chunk, reflectionTexts)) continue;
          reflectionTexts.push(chunk);
          items.push({
            text: normalizeEvidenceText(chunk),
            sourceType: 'reflection',
            toEvidence(traitId, strength) {
              return evidenceRecord(
                {
                  evidenceId: stableId('who_are_you', field.key, traitId, chunk.slice(0, 120)),
                  sourceType: 'reflection',
                  sourceId: `identity:who_are_you:${field.key}`,
                  contentKey: chunk,
                  weight: weightWhoAreYou(strength),
                  timestamp,
                  explanation: explainWhoAreYouEvidence(traitId, chunk),
                  label: localized(field.en, field.de),
                },
                strength
              );
            },
          });
        }
      }
    }
  } else {
    const whoText = [textBlob(who?.summary_text), who?.identity_embedding_text]
      .filter(Boolean)
      .join(' ')
      .trim();

    for (const chunk of splitEvidenceChunks(whoText)) {
      if (isJunkEvidenceText(chunk)) continue;
      if (isTextCoveredByExisting(chunk, reflectionTexts)) continue;
      items.push({
        text: normalizeEvidenceText(chunk),
        sourceType: 'reflection',
        toEvidence(traitId, strength) {
          return evidenceRecord(
            {
              evidenceId: stableId('who_are_you', traitId, chunk.slice(0, 120)),
              sourceType: 'reflection',
              sourceId: 'identity:who_are_you',
              contentKey: chunk,
              weight: weightWhoAreYou(strength),
              timestamp,
              explanation: explainWhoAreYouEvidence(traitId, chunk),
              label: PROFILE_SECTION_WHO_ARE_YOU,
            },
            strength
          );
        },
      });
    }
  }

  return items;
}

/**
 * @param {object} user
 * @returns {TextEvidenceItem[]}
 */
function collectStructuredProfileEvidence(user) {
  const items = [];
  const structured =
    user?.profile?.structuredUserInfo ||
    user?.profile?.careerSimulationInputs?.structuredUserInfo ||
    {};
  const timestamp = user.updatedAt || new Date();

  const sections = STRUCTURED_PROFILE_SECTIONS.map((section) => ({
    ...section,
    items: narrativeItems(structured[section.key]),
  }));
  for (const section of sections) {
    for (const itemText of section.items) {
      for (const chunk of splitEvidenceChunks(itemText)) {
        if (isJunkEvidenceText(chunk)) continue;
        items.push({
          text: normalizeEvidenceText(chunk),
          sourceType: 'profile',
          toEvidence(traitId, strength) {
            return evidenceRecord(
              {
                evidenceId: stableId('structured', section.key, traitId, chunk.slice(0, 80)),
                sourceType: 'profile',
                sourceId: `structured:${section.key}`,
                contentKey: chunk,
                weight: weightStructuredProfile(strength),
                timestamp,
                explanation: explainStructuredProfileEvidence(traitId, section, chunk),
                label: localized(section.en, section.de),
              },
              strength
            );
          },
        });
      }
    }
  }

  return items;
}

/**
 * @param {object} user
 * @returns {TextEvidenceItem[]}
 */
function collectCvEvidence(user) {
  const items = [];
  const documents = Array.isArray(user?.profile?.documents) ? user.profile.documents : [];

  for (const doc of documents) {
    if (!doc) continue;
    const docId = String(doc._id || doc.path || doc.name || 'cv');
    const chunks = extractCvEvidenceTexts(doc);
    if (chunks.length === 0) continue;

    const timestamp = doc.uploadDate || user.updatedAt || new Date();
    const docName = doc.name;

    for (const chunk of chunks) {
      items.push({
        text: normalizeEvidenceText(chunk),
        sourceType: 'cv',
        toEvidence(traitId, strength) {
          return evidenceRecord(
            {
              evidenceId: stableId('cv', docId, traitId, chunk.slice(0, 80)),
              sourceType: 'cv',
              sourceId: `document:${docId}`,
              contentKey: chunk,
              weight: weightCv(strength),
              timestamp,
              explanation: explainCvEvidence(traitId, docName, chunk),
              label: localized(
                docName ? `CV: ${docName}` : 'Uploaded CV',
                docName ? `Lebenslauf: ${docName}` : 'Hochgeladener Lebenslauf'
              ),
            },
            strength
          );
        },
      });
    }
  }

  return items;
}

function normalizeRole(value) {
  if (typeof value === 'string') return { id: value, title: value, titles: localizedTitles(value) };
  if (!value || typeof value !== 'object') {
    const title = String(value);
    return { id: title, title, titles: localizedTitles(title) };
  }
  const titles = localizedTitles(value.title);
  return {
    id: value.id || value.stepId || titles.en || titles.de,
    title: titles.en || titles.de,
    titles,
    description: textBlob(value.description),
  };
}

/**
 * @param {object} user
 * @returns {TextEvidenceItem[]}
 */
function collectSimulationEvidence(user) {
  const items = [];
  const results = [];
  if (user?.lastSimulationResult) results.push(user.lastSimulationResult);
  if (Array.isArray(user?.simulationResults)) {
    for (const r of user.simulationResults) results.push(r);
  }

  const seen = new Set();

  for (const result of results) {
    if (!result) continue;
    const flow = getEvaluationFlow(result);
    if (!flow || typeof flow !== 'object') continue;

    const modernRoles = listEvaluationFlowRoles(flow).filter(
      (role) => role && role.userEvaluation != null
    );

    let entries = [];
    if (modernRoles.length) {
      entries = modernRoles.map((role) => ({
        id: role.id || role.stepId || role.escoId || role.careerPathId,
        evaluation: role.userEvaluation,
        title: role.title,
        description: role.description,
      }));
    } else {
      const ratings =
        flow.ratings ||
        flow.roleRatings ||
        flow.evaluations ||
        (Array.isArray(flow) ? flow : null);

      if (Array.isArray(ratings)) {
        entries = ratings;
      } else if (ratings && typeof ratings === 'object') {
        entries = Object.entries(ratings).map(([id, value]) => ({
          id,
          evaluation: typeof value === 'string' ? value : value?.evaluation || value?.rating,
          title: value?.title || id,
        }));
      } else {
        for (const [key, value] of Object.entries(flow)) {
          if (['kept', 'keep', 'cool'].includes(key) && Array.isArray(value)) {
            entries.push(...value.map((v) => ({ ...normalizeRole(v), evaluation: 'keep' })));
          } else if (['disliked', 'dislike', 'uncool'].includes(key) && Array.isArray(value)) {
            entries.push(...value.map((v) => ({ ...normalizeRole(v), evaluation: 'dislike' })));
          } else if (['skipped', 'skip', 'dontKnow'].includes(key) && Array.isArray(value)) {
            entries.push(...value.map((v) => ({ ...normalizeRole(v), evaluation: 'skip' })));
          } else if (value && typeof value === 'object' && (value.evaluation || value.rating)) {
            entries.push({
              id: key,
              evaluation: value.evaluation || value.rating,
              title: textBlob(value.title) || key,
              description: textBlob(value.description),
            });
          }
        }
      }
    }

    for (const entry of entries) {
      const titles = entry.titles || localizedTitles(entry.title);
      const description = textBlob(entry.description);
      const normalized = {
        id: entry.id || entry.stepId || titles.en || titles.de,
        evaluation: String(entry.evaluation || entry.rating || '').toLowerCase(),
        titles,
        description,
      };
      if (!normalized.id) continue;

      const dedupeKey = `${result._id || result.id || 'sim'}:${normalized.id}:${normalized.evaluation}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      if (!['keep', 'cool', 'dislike', 'uncool', 'skip'].includes(normalized.evaluation)) {
        continue;
      }
      if (!['keep', 'cool'].includes(normalized.evaluation)) continue;

      const text = `${titles.en} ${titles.de} ${description}`.trim();
      if (!text) continue;

      const resultId = String(result._id || 'last');
      const timestamp =
        result.updatedAt || result.createdAt || result.completedAt || user.updatedAt || new Date();

      items.push({
        text: normalizeEvidenceText(text),
        sourceType: 'simulation',
        toEvidence(traitId, strength) {
          return evidenceRecord(
            {
              evidenceId: stableId('sim', resultId, normalized.id, traitId),
              sourceType: 'simulation',
              sourceId: `simulation:${resultId}:${normalized.id}`,
              contentKey: text,
              weight: weightSimulation(strength),
              timestamp,
              explanation: explainSimulationEvidence(traitId, titles.de || titles.en, description),
              label: localized(
                `Simulation: ${titles.en}`,
                `Simulation: ${titles.de}`
              ),
            },
            strength
          );
        },
      });
    }
  }

  return items;
}

/**
 * @param {object} user
 * @returns {TextEvidenceItem[]}
 */
function collectAllTextEvidence(user) {
  return [
    ...collectReflectionEvidence(user),
    ...collectStructuredProfileEvidence(user),
    ...collectCvEvidence(user),
    ...collectSimulationEvidence(user),
  ];
}

module.exports = {
  collectReflectionEvidence,
  collectStructuredProfileEvidence,
  collectCvEvidence,
  collectSimulationEvidence,
  collectAllTextEvidence,
  REFLECTION_FIELDS,
  STRUCTURED_PROFILE_SECTIONS,
};
