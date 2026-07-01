const MAX_LIST_ITEMS = 8;
const MAX_TEXT_LEN = 500;
const MAX_ITEM_LEN = 140;

const COACHING_KEYS = new Set([
  'workEnjoy',
  'topics',
  'strengths',
  'workEnvironment',
  'workingLifeAchievement',
]);

const IDENTITY_HINT_KEYS = [
  'workEnjoyMost',
  'topicsIndustriesInterest',
  'naturallyGoodAt',
  'workEnvironmentFit',
  'workingLifeAchievement',
];

function trimText(value, maxLen = MAX_TEXT_LEN) {
  return String(value || '').trim().slice(0, maxLen);
}

function normalizeStringList(items, maxItems = MAX_LIST_ITEMS) {
  if (!Array.isArray(items)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of items) {
    const value = trimText(typeof raw === 'string' ? raw : raw?.name, MAX_ITEM_LEN);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeIdentityHints(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const key of IDENTITY_HINT_KEYS) {
    out[key] = trimText(raw[key]);
  }
  return out;
}

function normalizeSeniority(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const yearsRaw = raw.yearsOfExperience;
  let yearsOfExperience = null;
  if (yearsRaw !== null && yearsRaw !== undefined && yearsRaw !== '') {
    const parsed = Number(yearsRaw);
    yearsOfExperience = Number.isFinite(parsed) ? parsed : null;
  }
  return {
    currentStatus: trimText(raw.currentStatus, 80),
    yearsOfExperience,
    highestDegree: trimText(raw.highestDegree, 80),
    mostSeniorWorkExperience: trimText(raw.mostSeniorWorkExperience, 80),
  };
}

function normalizeStructuredUserInfo(raw) {
  if (!raw || typeof raw !== 'object') return {};
  return {
    skillDomains: normalizeStringList(raw.skillDomains),
    skills: normalizeStringList(raw.skills),
    domains: normalizeStringList(raw.domains),
    keyResponsibilities: normalizeStringList(raw.keyResponsibilities, MAX_LIST_ITEMS),
    skillsInDevelopment: normalizeStringList(raw.skillsInDevelopment),
  };
}

/**
 * @param {object|null|undefined} input
 */
function normalizeCoachingCvContext(input) {
  if (!input || typeof input !== 'object') return null;
  const normalized = {
    documentId: trimText(input.documentId, 80) || undefined,
    seniority: normalizeSeniority(input.seniority),
    structuredUserInfo: normalizeStructuredUserInfo(input.structuredUserInfo),
    identityHints: normalizeIdentityHints(input.identityHints),
  };
  if (!hasCoachingCvContext(normalized)) return null;
  return normalized;
}

/**
 * @param {object|null|undefined} cvContext
 */
function hasCoachingCvContext(cvContext) {
  if (!cvContext || typeof cvContext !== 'object') return false;
  const hints = cvContext.identityHints || {};
  if (IDENTITY_HINT_KEYS.some((key) => trimText(hints[key]))) return true;
  const structured = cvContext.structuredUserInfo || {};
  if (Object.values(structured).some((list) => Array.isArray(list) && list.length > 0)) return true;
  const seniority = cvContext.seniority || {};
  return Boolean(
    trimText(seniority.currentStatus)
    || trimText(seniority.highestDegree)
    || trimText(seniority.mostSeniorWorkExperience)
    || (seniority.yearsOfExperience !== null && seniority.yearsOfExperience !== undefined)
  );
}

function listBlock(label, items, lang) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  if (!Array.isArray(items) || items.length === 0) return '';
  const lines = items.map((item) => `- ${item}`).join('\n');
  return isDe ? `${label}:\n${lines}` : `${label}:\n${lines}`;
}

function hintBlock(label, text, lang) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const value = trimText(text);
  if (!value) return '';
  return isDe
    ? `${label} (aus dem Lebenslauf abgeleitet — Hypothese, nicht bestätigt):\n${value}`
    : `${label} (inferred from CV — hypothesis, not confirmed):\n${value}`;
}

function sharedCvRules(lang, { forQuestions = false } = {}) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  if (forQuestions) {
    if (isDe) {
      return `Regeln für die Nutzung des Lebenslauf-Kontexts in Fragen:
- Behandle CV-Inhalte als Hypothesen — formuliere sie als offene Frage, nicht als Fakt.
- Beziehe dich in mindestens der ersten Frage konkret auf ein CV-Detail (Rolle, Aufgabe, Branche oder Skill).
- Wiederhole CV-Stichworte nicht wörtlich; paraphrasiere und kontrastiere (z. B. energiegebend vs. anstrengend).
- Die Zusammenfassung am Ende darf nur aus Chat-Antworten abgeleitet werden.`;
    }
    return `Rules for using CV context in questions:
- Treat CV content as hypotheses — phrase as open questions, not facts.
- In at least the first question, reference a concrete CV detail (role, task, sector, or skill).
- Do not repeat CV keywords verbatim; paraphrase and contrast (e.g. energizing vs draining).
- The final summary must come from chat answers only.`;
  }
  if (isDe) {
    return `Regeln für die Nutzung des Lebenslauf-Kontexts:
- Behandle alle CV-Inhalte als Hypothesen, nicht als bestätigte Fakten.
- Formuliere Fragen, die der Nutzerin/dem Nutzer Raum geben, Präferenzen von bloßer Historie zu trennen.
- Beziehe dich konkret auf CV-Details in Fragen, ohne Stichworte wörtlich zu wiederholen.
- Die Zusammenfassung am Ende darf nur aus Chat-Antworten abgeleitet werden, nicht aus CV-Bullets kopiert werden.`;
  }
  return `Rules for using CV context:
- Treat all CV content as hypotheses, not confirmed facts.
- Ask questions that help the user separate preferences from history.
- Reference concrete CV details in questions without repeating keywords verbatim.
- The final summary must come from chat answers only, not copied CV bullets.`;
}

function formatSeniorityCvBlock(cvContext, lang) {
  const seniority = cvContext?.seniority || {};
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const lines = [];
  if (trimText(seniority.currentStatus)) {
    lines.push(isDe
      ? `- Berufsstatus (CV): ${seniority.currentStatus}`
      : `- Employment status (CV): ${seniority.currentStatus}`);
  }
  if (seniority.yearsOfExperience !== null && seniority.yearsOfExperience !== undefined) {
    lines.push(isDe
      ? `- Berufserfahrung (CV): ${seniority.yearsOfExperience} Jahre`
      : `- Years of experience (CV): ${seniority.yearsOfExperience}`);
  }
  if (trimText(seniority.highestDegree)) {
    lines.push(isDe
      ? `- Höchster Abschluss (CV): ${seniority.highestDegree}`
      : `- Highest degree (CV): ${seniority.highestDegree}`);
  }
  if (trimText(seniority.mostSeniorWorkExperience)) {
    lines.push(isDe
      ? `- Höchste Rollebene (CV): ${seniority.mostSeniorWorkExperience}`
      : `- Most senior role level (CV): ${seniority.mostSeniorWorkExperience}`);
  }
  if (lines.length === 0) return '';
  const intro = isDe
    ? 'Lebenslauf — Karrierestufe (Hypothese):'
    : 'CV career stage (hypothesis):';
  return `${intro}\n${lines.join('\n')}`;
}

function joinCvBlockParts(parts, lang, guidance, forQuestions = false) {
  const filtered = parts.filter(Boolean);
  if (filtered.length === 0) return '';
  return `${filtered.join('\n\n')}\n\n${guidance}\n\n${sharedCvRules(lang, { forQuestions })}`;
}

function formatWorkEnjoyBlock(cvContext, lang) {
  const structured = cvContext.structuredUserInfo || {};
  const hints = cvContext.identityHints || {};
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const guidance = isDe
    ? 'Frage, welche CV-Tätigkeiten energiegebend vs. anstrengend waren, und erkunde Präferenzen außerhalb des CV.'
    : 'Ask which CV activities were energizing vs draining, and explore preferences beyond the CV.';
  return joinCvBlockParts([
    isDe
      ? 'Lebenslauf-Kontext für Fragen zu Tätigkeiten, die Freude bereiten:'
      : 'CV context for questions about enjoyable activities:',
    formatSeniorityCvBlock(cvContext, lang),
    hintBlock('Inferred enjoyment signals', hints.workEnjoyMost, lang),
    listBlock('Responsibilities from CV', structured.keyResponsibilities, lang),
    listBlock('Skills from CV', structured.skills, lang),
    listBlock('Skill domains from CV', structured.skillDomains, lang),
  ], lang, guidance, true);
}

function formatTopicsBlock(cvContext, lang) {
  const structured = cvContext.structuredUserInfo || {};
  const hints = cvContext.identityHints || {};
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const guidance = isDe
    ? 'Unterscheide Branchenerfahrung von echter Neugier; frage nach Motivation, nicht nur nach bereits genannten Sektoren.'
    : 'Distinguish industry exposure from genuine curiosity; ask about motivation, not just listed sectors.';
  return joinCvBlockParts([
    isDe
      ? 'Lebenslauf-Kontext für Themen- und Branchenfragen:'
      : 'CV context for topics and industries questions:',
    formatSeniorityCvBlock(cvContext, lang),
    listBlock('Industry exposure from CV', structured.domains, lang),
    listBlock('Skills from CV', structured.skills, lang),
    hintBlock('Inferred interest topics', hints.topicsIndustriesInterest, lang),
  ], lang, guidance, true);
}

function formatStrengthsBlock(cvContext, lang) {
  const structured = cvContext.structuredUserInfo || {};
  const hints = cvContext.identityHints || {};
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const guidance = isDe
    ? 'Kontrastiere nachgewiesene CV-Fähigkeiten mit subjektiv natürlichen Stärken; frage situationsbezogen, nicht nach generischen Labels.'
    : 'Contrast demonstrated CV skills with subjectively natural strengths; ask situation-based questions, not generic labels.';
  return joinCvBlockParts([
    isDe ? 'Lebenslauf-Kontext für Stärkenfragen:' : 'CV context for strengths questions:',
    formatSeniorityCvBlock(cvContext, lang),
    listBlock('Skill domains from CV', structured.skillDomains, lang),
    listBlock('Skills from CV', structured.skills, lang),
    listBlock('Responsibilities from CV', structured.keyResponsibilities, lang),
    hintBlock('Inferred strengths', hints.naturallyGoodAt, lang),
  ], lang, guidance, true);
}

function formatWorkEnvironmentBlock(cvContext, lang) {
  const hints = cvContext.identityHints || {};
  const structured = cvContext.structuredUserInfo || {};
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const guidance = isDe
    ? 'Leite Organisationskontext ab, frage aber nach Präferenzen, die der CV nicht zeigt (Tempo, Autonomie, Teamgröße).'
    : 'Infer organizational context, but ask about preferences the CV cannot show (pace, autonomy, team size).';
  return joinCvBlockParts([
    isDe ? 'Lebenslauf-Kontext für Arbeitsumfeld-Fragen:' : 'CV context for work environment questions:',
    formatSeniorityCvBlock(cvContext, lang),
    hintBlock('Inferred work style signals', hints.workEnvironmentFit, lang),
    listBlock('Responsibilities / context from CV', structured.keyResponsibilities, lang),
    listBlock('Industry context from CV', structured.domains, lang),
  ], lang, guidance, true);
}

function formatWorkingLifeAchievementBlock(cvContext, lang) {
  const hints = cvContext.identityHints || {};
  const seniority = cvContext.seniority || {};
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const guidance = isDe
    ? 'Verankere dich in der bisherigen Laufbahn, frage aber nach zukünftigen Prioritäten und Zielen jenseits des CV.'
    : 'Anchor on past trajectory, but ask about future priorities and goals beyond the CV.';
  return joinCvBlockParts([
    isDe ? 'Lebenslauf-Kontext für Karriereziel-Fragen:' : 'CV context for career goal questions:',
    formatSeniorityCvBlock(cvContext, lang),
    hintBlock('Inferred career goal signals', hints.workingLifeAchievement, lang),
    seniority.mostSeniorWorkExperience
      ? hintBlock('Most senior role from CV', seniority.mostSeniorWorkExperience, lang)
      : '',
  ], lang, guidance, true);
}

/**
 * Extra user-turn hint for the first coaching question when CV context is present.
 */
function buildCvAwareFirstQuestionTurnHint(lang, cvContext) {
  if (!hasCoachingCvContext(cvContext)) return '';
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  return isDe
    ? '\n\nBeziehe dich in dieser ersten Frage konkret auf mindestens ein CV-Detail aus dem System-Prompt (Rolle, Aufgabe, Branche oder Skill) — als offene Hypothese.'
    : '\n\nIn this first question, reference at least one concrete CV detail from the system prompt (role, task, sector, or skill) — as an open hypothesis.';
}

/**
 * @param {string} coachingKey
 * @param {object|null|undefined} cvContext
 * @param {string} [lang]
 */
function formatCoachingCvContextBlock(coachingKey, cvContext, lang = 'de') {
  const key = String(coachingKey || '').trim();
  if (!COACHING_KEYS.has(key) || !hasCoachingCvContext(cvContext)) return '';
  switch (key) {
    case 'workEnjoy':
      return formatWorkEnjoyBlock(cvContext, lang);
    case 'topics':
      return formatTopicsBlock(cvContext, lang);
    case 'strengths':
      return formatStrengthsBlock(cvContext, lang);
    case 'workEnvironment':
      return formatWorkEnvironmentBlock(cvContext, lang);
    case 'workingLifeAchievement':
      return formatWorkingLifeAchievementBlock(cvContext, lang);
    default:
      return '';
  }
}

module.exports = {
  normalizeCoachingCvContext,
  hasCoachingCvContext,
  formatCoachingCvContextBlock,
  buildCvAwareFirstQuestionTurnHint,
};
