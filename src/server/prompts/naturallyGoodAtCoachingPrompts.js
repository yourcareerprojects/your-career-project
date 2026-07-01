const {
  resolveWorkEnjoyCoachingAudience,
  formatSeniorityContext,
  AUDIENCE_HINTS,
  extractPriorCoveragePairs,
  formatPriorCoverageBlock,
} = require('./workEnjoyCoachingPrompts');

const COACHING_QUESTION_COUNT = 3;
const STRENGTH_COUNT = 5;
const MAX_STRENGTH_WORDS = 6;
const SKILL_DOMAIN_COUNT_MIN = 3;
const SKILL_DOMAIN_COUNT_MAX = 5;

const FORBIDDEN_GENERIC_LABELS = [
  'kreativ',
  'teamfähig',
  'teamfaehig',
  'intelligent',
  'motiviert',
  'flexibel',
  'organisiert',
  'kommunikativ',
  'creative',
  'team player',
  'team-oriented',
  'intelligent',
  'motivated',
  'flexible',
  'organized',
  'communicative',
];

/** Per-audience question angles — concrete situations, not school subjects or abstract traits. */
const QUESTION_FOCUS_BY_AUDIENCE = {
  de: {
    pupil: {
      1: {
        title: 'Leichtigkeit & Vergleich',
        instruction: `Frage nach konkreten Situationen, in denen dem Nutzer etwas leichter fällt als anderen in seinem/ihrem Alter.
Nicht nach Schulfächern, Noten oder allgemeinen Eigenschaften fragen.`,
        example: 'Was fällt dir leichter als anderen in deinem Alter?',
      },
      2: {
        title: 'Hilfe von anderen',
        instruction: `Frage nach Situationen, in denen andere den Nutzer um Hilfe bitten — in der Schule, in der Freizeit oder zu Hause.
Nicht erneut nach Leichtigkeit oder Selbstvertrauen fragen. Nicht nach Schulfächern fragen.`,
        example: 'Wobei bitten dich andere um Hilfe?',
      },
      3: {
        title: 'Natürliches Sicherheitsgefühl',
        instruction: `Frage nach Momenten, in denen der Nutzer das Gefühl hat: „Das kann ich einfach“ — mit einer kurzen Situation.
Nicht erneut nach Leichtigkeit oder Hilfe von anderen fragen.`,
        example: 'Wann hast du das Gefühl: „Das kann ich einfach“?',
      },
    },
    student: {
      1: {
        title: 'Leichtigkeit & Vergleich',
        instruction: `Frage nach konkreten Situationen in Studium, Ausbildung oder Praktika, in denen dem Nutzer etwas leichter fällt als anderen.
Nicht nach Fächern, Noten oder allgemeinen Eigenschaften fragen.`,
        example: 'Was fällt dir im Studium oder in der Ausbildung leichter als vielen anderen?',
      },
      2: {
        title: 'Hilfe von anderen',
        instruction: `Frage nach Situationen, in denen Kommiliton/innen, Kolleg/innen oder Freund/innen den Nutzer um Hilfe bitten.
Nicht erneut nach Leichtigkeit oder Selbstvertrauen fragen.`,
        example: 'Wobei bitten dich andere in Studium, Ausbildung oder im Team um Hilfe?',
      },
      3: {
        title: 'Natürliches Sicherheitsgefühl',
        instruction: `Frage nach Momenten, in denen der Nutzer sicher ist: „Das kann ich einfach“ — mit einer kurzen Situation.
Nicht erneut nach Leichtigkeit oder Hilfe von anderen fragen.`,
        example: 'Wann hast du das Gefühl: „Das kann ich einfach“?',
      },
    },
    early_career: {
      1: {
        title: 'Leichtigkeit & Vergleich',
        instruction: `Frage nach konkreten Situationen im Job, in Praktika oder Projekten, in denen dem Nutzer etwas leichter fällt als anderen.
Nicht nach Jobtiteln oder allgemeinen Eigenschaften fragen.`,
        example: 'Was fällt dir bei der Arbeit leichter als vielen anderen?',
      },
      2: {
        title: 'Hilfe von anderen',
        instruction: `Frage nach Situationen, in denen Kolleg/innen oder andere den Nutzer um Hilfe bitten.
Nicht erneut nach Leichtigkeit oder Selbstvertrauen fragen.`,
        example: 'Wobei bitten dich andere bei der Arbeit oder in Projekten um Hilfe?',
      },
      3: {
        title: 'Natürliches Sicherheitsgefühl',
        instruction: `Frage nach Momenten, in denen der Nutzer sicher ist: „Das kann ich einfach“ — mit einer kurzen Situation.
Nicht erneut nach Leichtigkeit oder Hilfe von anderen fragen.`,
        example: 'Wann hast du bei der Arbeit das Gefühl: „Das kann ich einfach“?',
      },
    },
    mid_career: {
      1: {
        title: 'Leichtigkeit & Vergleich',
        instruction: `Frage nach konkreten Situationen im Berufsalltag, in denen dem Nutzer etwas leichter fällt als anderen.
Nicht nach Jobtiteln oder allgemeinen Eigenschaften fragen.`,
        example: 'Was fällt dir im Berufsalltag leichter als vielen anderen?',
      },
      2: {
        title: 'Hilfe von anderen',
        instruction: `Frage nach Situationen, in denen Kolleg/innen, Teammitglieder oder andere den Nutzer um Hilfe bitten.
Nicht erneut nach Leichtigkeit oder Selbstvertrauen fragen.`,
        example: 'Wobei bitten dich andere im Berufsalltag um Hilfe?',
      },
      3: {
        title: 'Natürliches Sicherheitsgefühl',
        instruction: `Frage nach Momenten, in denen der Nutzer sicher ist: „Das kann ich einfach“ — mit einer kurzen Situation.
Nicht erneut nach Leichtigkeit oder Hilfe von anderen fragen.`,
        example: 'Wann hast du im Berufsalltag das Gefühl: „Das kann ich einfach“?',
      },
    },
    senior: {
      1: {
        title: 'Leichtigkeit & Vergleich',
        instruction: `Frage nach konkreten Situationen in Verantwortung oder Führung, in denen dem Nutzer etwas leichter fällt als anderen.
Nicht nach Jobtiteln oder allgemeinen Eigenschaften fragen.`,
        example: 'Was fällt dir in deiner Verantwortung leichter als vielen anderen?',
      },
      2: {
        title: 'Hilfe von anderen',
        instruction: `Frage nach Situationen, in denen andere den Nutzer um Rat, Unterstützung oder Hilfe bitten.
Nicht erneut nach Leichtigkeit oder Selbstvertrauen fragen.`,
        example: 'Wobei bitten dich andere in deiner Rolle um Hilfe oder Rat?',
      },
      3: {
        title: 'Natürliches Sicherheitsgefühl',
        instruction: `Frage nach Momenten, in denen der Nutzer sicher ist: „Das kann ich einfach“ — mit einer kurzen Situation.
Nicht erneut nach Leichtigkeit oder Hilfe von anderen fragen.`,
        example: 'Wann hast du in deiner Verantwortung das Gefühl: „Das kann ich einfach“?',
      },
    },
  },
  en: {
    pupil: {
      1: {
        title: 'Ease & comparison',
        instruction: `Ask about concrete situations where something comes easier to the user than to others their age.
Do not ask about school subjects, grades, or general traits.`,
        example: 'What comes easier to you than to others your age?',
      },
      2: {
        title: 'Help from others',
        instruction: `Ask about situations where others ask the user for help — at school, in free time, or at home.
Do not ask again about ease or confidence. Do not ask about school subjects.`,
        example: 'What do others ask you for help with?',
      },
      3: {
        title: 'Natural confidence',
        instruction: `Ask about moments when the user feels "I can simply do this" — with a brief situation.
Do not ask again about ease or help from others.`,
        example: 'When do you feel: "I can simply do this"?',
      },
    },
    student: {
      1: {
        title: 'Ease & comparison',
        instruction: `Ask about concrete situations in study, training, or internships where something comes easier than to others.
Do not ask about subjects, grades, or general traits.`,
        example: 'What comes easier to you in your studies or training than to many others?',
      },
      2: {
        title: 'Help from others',
        instruction: `Ask about situations where classmates, colleagues, or friends ask the user for help.
Do not ask again about ease or confidence.`,
        example: 'What do others ask you for help with in study, training, or your team?',
      },
      3: {
        title: 'Natural confidence',
        instruction: `Ask about moments when the user feels sure: "I can simply do this" — with a brief situation.
Do not ask again about ease or help from others.`,
        example: 'When do you feel: "I can simply do this"?',
      },
    },
    early_career: {
      1: {
        title: 'Ease & comparison',
        instruction: `Ask about concrete situations at work, in internships, or projects where something comes easier than to others.
Do not ask about job titles or general traits.`,
        example: 'What comes easier to you at work than to many others?',
      },
      2: {
        title: 'Help from others',
        instruction: `Ask about situations where colleagues or others ask the user for help.
Do not ask again about ease or confidence.`,
        example: 'What do others ask you for help with at work or in projects?',
      },
      3: {
        title: 'Natural confidence',
        instruction: `Ask about moments when the user feels sure: "I can simply do this" — with a brief situation.
Do not ask again about ease or help from others.`,
        example: 'When do you feel at work: "I can simply do this"?',
      },
    },
    mid_career: {
      1: {
        title: 'Ease & comparison',
        instruction: `Ask about concrete situations in daily work where something comes easier than to others.
Do not ask about job titles or general traits.`,
        example: 'What comes easier to you at work than to many others?',
      },
      2: {
        title: 'Help from others',
        instruction: `Ask about situations where colleagues, teammates, or others ask the user for help.
Do not ask again about ease or confidence.`,
        example: 'What do others ask you for help with at work?',
      },
      3: {
        title: 'Natural confidence',
        instruction: `Ask about moments when the user feels sure: "I can simply do this" — with a brief situation.
Do not ask again about ease or help from others.`,
        example: 'When do you feel at work: "I can simply do this"?',
      },
    },
    senior: {
      1: {
        title: 'Ease & comparison',
        instruction: `Ask about concrete situations in responsibility or leadership where something comes easier than to others.
Do not ask about job titles or general traits.`,
        example: 'What comes easier to you in your area of responsibility than to many others?',
      },
      2: {
        title: 'Help from others',
        instruction: `Ask about situations where others ask the user for advice, support, or help.
Do not ask again about ease or confidence.`,
        example: 'What do others ask you for help or advice with in your role?',
      },
      3: {
        title: 'Natural confidence',
        instruction: `Ask about moments when the user feels sure: "I can simply do this" — with a brief situation.
Do not ask again about ease or help from others.`,
        example: 'When do you feel in your role: "I can simply do this"?',
      },
    },
  },
};

function resolveQuestionFocus(lang, questionNumber, audience = 'pupil') {
  const langBucket = QUESTION_FOCUS_BY_AUDIENCE[String(lang || 'de').toLowerCase().startsWith('en') ? 'en' : 'de'];
  const audienceKey = langBucket[audience] ? audience : 'pupil';
  const bucket = langBucket[audienceKey];
  const key = Math.min(Math.max(Number(questionNumber) || 1, 1), COACHING_QUESTION_COUNT);
  return bucket[key] || langBucket.pupil[key];
}

function coachRoleLabel(lang, audience) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  if (audience === 'pupil') {
    return isDe ? 'Du bist ein erfahrener Berufscoach für Jugendliche.' : 'You are an experienced career coach for young people.';
  }
  return isDe ? 'Du bist ein erfahrener Berufscoach.' : 'You are an experienced career coach.';
}

function questionStyleHint(lang, audience) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  if (audience === 'pupil') {
    return isDe
      ? '- Verwende einfache Sprache (ca. 9. Klasse).'
      : '- Use simple, age-appropriate language.';
  }
  return isDe
    ? '- Halte die Frage kurz, klar und passend zum Berufsstand des Nutzers.'
    : '- Keep the question short, clear, and suited to the user\'s career stage.';
}

function buildQuestionTurnUserMessage({ lang, questionNumber, messages, audience = 'pupil' }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const focus = resolveQuestionFocus(lang, questionNumber, audience);
  const pairs = extractPriorCoveragePairs(messages);
  const lastPair = pairs.length > 0 ? pairs[pairs.length - 1] : null;
  const coverage = formatPriorCoverageBlock(messages, lang);

  if (questionNumber <= 1) {
    return isDe
      ? `Stelle jetzt Frage 1 zum Fokus „${focus.title}“.`
      : `Ask question 1 now for the focus "${focus.title}".`;
  }

  if (isDe) {
    return `Letzte Antwort des Nutzers (kurz positiv oder motivierend anerkennen — nicht ins Detail gehen):
„${lastPair?.answer || ''}“

Bereits abgedeckte Bereiche — nicht erneut als Fragestellung:
${coverage}

Formuliere jetzt Frage ${questionNumber} von ${COACHING_QUESTION_COUNT}:
1) ein kurzer, ermutigender Satz zur letzten Antwort (max. ein Satz, keine Rückfrage)
2) danach genau eine Frage zum Fokus „${focus.title}“
Der neue Bereich muss sich deutlich vom vorherigen unterscheiden.`;
  }

  return `The user's latest answer (acknowledge it briefly and positively — do not go into detail):
"${lastPair?.answer || ''}"

Areas already covered — do not ask about them again:
${coverage}

Write question ${questionNumber} of ${COACHING_QUESTION_COUNT} as:
1) one short, encouraging sentence about their latest answer (max. one sentence, not a question)
2) then exactly one question for the focus "${focus.title}"
The new area must differ clearly from the previous one.`;
}

function buildQuestionTaskRules({ lang, questionNumber, focus, audience = 'pupil' }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const example = focus.example;
  const styleHint = questionStyleHint(lang, audience);

  if (questionNumber <= 1) {
    if (isDe) {
      return `Deine Aufgabe jetzt:
- Stelle genau EINE kurze, einfache Frage zu diesem Fokus.
- Frage nach konkreten Situationen und Verhalten — nicht nach Schulfächern oder allgemeinen Aussagen.
- Antworte ausschließlich auf Deutsch.
${styleHint}
- Keine Aufzählungen, keine Erklärungen, keine Begrüßung — nur die eine Frage.

Beispiel für den Stil (nicht wörtlich kopieren): „${example}“`;
    }
    return `Your task now:
- Ask exactly ONE short, simple question about this focus area.
- Ask about concrete situations and behavior — not school subjects or general statements.
- Respond only in English.
${styleHint}
- No lists, no explanations, no greeting — only the single question.

Example for the tone (do not copy verbatim): "${example}"`;
  }

  if (isDe) {
    return `Deine Aufgabe jetzt:
- Reagiere zuerst mit genau EINEM kurzen, positiven oder motivierenden Satz auf die letzte Antwort (keine Rückfrage, keine Wiederholung von Details).
- Stelle danach genau EINE kurze, konkrete Frage zum neuen Fokus — der Bereich muss sich deutlich vom vorherigen unterscheiden.
- Frage nach konkreten Situationen und Verhalten — nicht nach Schulfächern oder allgemeinen Aussagen.
- Antworte ausschließlich auf Deutsch.
- Keine Aufzählungen, keine langen Erklärungen — höchstens ein Ermutigungssatz plus eine Frage.
- Keine Vertiefungsfrage zum vorherigen Thema.

Beispiel für den Stil (nicht wörtlich kopieren): „Das klingt gut! ${example}“`;
  }

  return `Your task now:
- First, write exactly ONE short, positive or encouraging sentence about their latest answer (not a question, do not repeat details).
- Then ask exactly ONE short, concrete question about the new focus — the area must differ clearly from the previous one.
- Ask about concrete situations and behavior — not school subjects or general statements.
- Respond only in English.
- No lists, no long explanations — at most one encouraging sentence plus one question.
- No drill-down on the previous topic.

Example for the tone (do not copy verbatim): "That sounds good! ${example}"`;
}

function buildQuestionSystemPrompt({ audience, lang, seniority, questionNumber, cvContext }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const hints = AUDIENCE_HINTS[isDe ? 'de' : 'en'][audience];
  const context = formatSeniorityContext(seniority, lang);
  const focus = resolveQuestionFocus(lang, questionNumber, audience);
  const { formatCoachingCvContextBlock } = require('../services/profile/coachingCvContext');
  const cvBlock = formatCoachingCvContextBlock('strengths', cvContext, lang);

  if (isDe) {
    const pupilExtra = audience === 'pupil'
      ? `
Zielgruppe: Schülerin/Schüler in der Berufsorientierung (einfache Sprache, ca. 9. Klasse).
Frage nach konkreten Situationen und Verhalten — nicht nach Schulfächern oder allgemeinen Aussagen.`
      : `
Frage nach konkreten Situationen und Verhalten — nicht nach Schulfächern oder allgemeinen Aussagen. Formuliere passend zum Berufsstand des Nutzers.`;
    return `${coachRoleLabel(lang, audience)}
${hints}${pupilExtra}

Deine Aufgabe: Stelle nacheinander ${COACHING_QUESTION_COUNT} kurze, einfache Fragen, um herauszufinden, wobei der Nutzer von Natur aus gut ist oder sich sicher fühlt.

Kontext zum Nutzer:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Fokus dieser Frage (${questionNumber} von ${COACHING_QUESTION_COUNT}): ${focus.title}
${focus.instruction}

${buildQuestionTaskRules({ lang, questionNumber, focus, audience })}`;
  }

  const pupilExtraEn = audience === 'pupil'
    ? '\nAsk about concrete situations and behavior — not school subjects or general statements.'
    : '\nAsk about concrete situations and behavior — not school subjects or general statements. Match wording to the user\'s career stage.';

  return `${coachRoleLabel(lang, audience)}
${hints}${pupilExtraEn}

Your task: ask ${COACHING_QUESTION_COUNT} short, simple questions in sequence to find out what the user is naturally good at or confident doing.

User context:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Focus for this question (${questionNumber} of ${COACHING_QUESTION_COUNT}): ${focus.title}
${focus.instruction}

${buildQuestionTaskRules({ lang, questionNumber, focus, audience })}`;
}

function buildStrengthSynthesisRules(lang) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const forbidden = FORBIDDEN_GENERIC_LABELS.slice(0, 6).join('", "');
  const forbiddenEn = FORBIDDEN_GENERIC_LABELS.slice(6).join('", "');

  if (isDe) {
    return `1. Natürliche Stärken (genau ${STRENGTH_COUNT} Punkte)

Regeln:
- formuliere als konkrete Fähigkeiten oder Handlungen
- max. ${MAX_STRENGTH_WORDS} Wörter pro Punkt
- keine Schulfächer (z. B. nicht „Mathe“, „Deutsch“)
- keine allgemeinen Labels wie „${forbidden}“
- stattdessen konkreter, z. B. „Zusammenhänge schnell verstehen“, „ruhig auf Probleme reagieren“, „Ideen klar erklären“
- wiederhole nicht die Formulierungen des Nutzers 1:1 — fasse sinnvoll zusammen
- vermeide zu allgemeine Aussagen`;
  }

  return `1. Natural strengths (exactly ${STRENGTH_COUNT} items)

Rules:
- phrase as concrete abilities or actions
- max ${MAX_STRENGTH_WORDS} words per item
- no school subjects (e.g. not "math", "English")
- no generic labels like "${forbiddenEn}"
- instead be concrete, e.g. "grasp connections quickly", "stay calm with problems", "explain ideas clearly"
- do not repeat the user's wording verbatim — synthesize meaningfully
- avoid overly general statements`;
}

function buildSkillDomainDerivationRules(lang, canonicalList) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  if (isDe) {
    return `2. Passende Stärken (${SKILL_DOMAIN_COUNT_MIN}–${SKILL_DOMAIN_COUNT_MAX} Punkte)
- Wähle ausschließlich aus dieser kanonischen Liste (exakte Schreibweise): ${canonicalList}
- Leite die Stärken aus den abgeleiteten natürlichen Stärken und dem Gesamtbild der Antworten ab
- Wiederhole keine Stärken-Formulierungen und keine Wörter aus den Antworten wörtlich
- jede Stärke muss klar zu den abgeleiteten natürlichen Stärken passen
- vermeide zu allgemeine Begriffe`;
  }

  return `2. Matching strength domains (${SKILL_DOMAIN_COUNT_MIN}–${SKILL_DOMAIN_COUNT_MAX} items)
- Choose only from this canonical list (exact spelling): ${canonicalList}
- Derive domains from the synthesized strengths and the overall picture of the answers
- Do not repeat strength wording or words from the answers verbatim
- each domain must clearly match the derived strengths
- avoid overly vague terms`;
}

function buildSummarySystemPrompt({ audience, lang, seniority, skillDomainCatalog = '', cvContext }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const hints = AUDIENCE_HINTS[isDe ? 'de' : 'en'][audience];
  const context = formatSeniorityContext(seniority, lang);
  const skillDomainRules = buildSkillDomainDerivationRules(lang, skillDomainCatalog);
  const { formatCoachingCvContextBlock } = require('../services/profile/coachingCvContext');
  const cvBlock = formatCoachingCvContextBlock('strengths', cvContext, lang);
  const cvSummaryRule = isDe
    ? 'Leite strengths und skillDomains ausschließlich aus den Chat-Antworten ab — kopiere keine CV-Inhalte.'
    : 'Derive strengths and skillDomains exclusively from chat answers — do not copy CV content.';

  if (isDe) {
    return `${coachRoleLabel(lang, audience)}
${hints}

Kontext zum Nutzer:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Analysiere die Antworten des Nutzers auf drei Coaching-Fragen und leite daraus ab:

${buildStrengthSynthesisRules(lang)}

- ${cvSummaryRule}

${skillDomainRules}

Ziel: Der Nutzer soll erkennen, was er/sie wirklich gut kann — auch wenn er/sie es bisher nicht bewusst wahrgenommen hat.

Antworte ausschließlich als JSON-Objekt:
{"strengths":["Stärke 1","Stärke 2","Stärke 3","Stärke 4","Stärke 5"],"skillDomains":["Bereich 1","Bereich 2","Bereich 3"]}`;
  }

  return `${coachRoleLabel(lang, audience)}
${hints}

User context:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Analyze the user's answers to three coaching questions and derive:

${buildStrengthSynthesisRules(lang)}

- ${cvSummaryRule}

${skillDomainRules}

Goal: the user should recognize what they are truly good at — even if they had not noticed it consciously before.

Reply only as a JSON object:
{"strengths":["strength 1","strength 2","strength 3","strength 4","strength 5"],"skillDomains":["domain 1","domain 2","domain 3"]}`;
}

function buildSummaryUserPrompt(messages, lang) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const lines = [];
  let q = 0;
  for (const msg of messages) {
    if (!msg || typeof msg.content !== 'string') continue;
    const text = msg.content.trim();
    if (!text) continue;
    if (msg.role === 'assistant') {
      q += 1;
      lines.push(isDe ? `Frage ${q}: ${text}` : `Question ${q}: ${text}`);
    } else if (msg.role === 'user') {
      lines.push(isDe ? `Antwort ${q}: ${text}` : `Answer ${q}: ${text}`);
    }
  }
  const transcript = lines.join('\n');
  if (isDe) {
    return `${transcript}

Leite strengths und skillDomains durch Synthese ab — kopiere die Antworten nicht und liste sie nicht auf.`;
  }
  return `${transcript}

Derive strengths and skillDomains by synthesis — do not copy or list the answers.`;
}

function extractUserAnswerTexts(messages = []) {
  return extractPriorCoveragePairs(messages)
    .map((pair) => String(pair.answer || '').trim())
    .filter(Boolean);
}

module.exports = {
  COACHING_QUESTION_COUNT,
  STRENGTH_COUNT,
  MAX_STRENGTH_WORDS,
  SKILL_DOMAIN_COUNT_MIN,
  SKILL_DOMAIN_COUNT_MAX,
  FORBIDDEN_GENERIC_LABELS,
  QUESTION_FOCUS_BY_AUDIENCE,
  resolveWorkEnjoyCoachingAudience,
  resolveQuestionFocus,
  buildQuestionTurnUserMessage,
  buildQuestionSystemPrompt,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
  extractUserAnswerTexts,
};
