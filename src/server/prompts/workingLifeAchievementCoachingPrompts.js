const {
  resolveWorkEnjoyCoachingAudience,
  formatSeniorityContext,
  AUDIENCE_HINTS,
  formatPriorCoverageBlock,
} = require('./workEnjoyCoachingPrompts');

const COACHING_QUESTION_COUNT = 3;
const CAREER_GOAL_COUNT = 5;
const MAX_CAREER_GOAL_WORDS = 8;
const PRIORITY_COUNT = 3;
const MAX_PRIORITY_WORDS = 12;

const FORBIDDEN_GENERIC_GOALS = [
  'glücklich sein',
  'gluecklich sein',
  'viel geld verdienen',
  'erfolgreich sein',
  'be happy',
  'earn a lot of money',
  'be successful',
  'make lots of money',
];

/** Three independent topic areas — each question stands alone, no follow-ups or build-up. */
const QUESTION_FOCUS_BY_AUDIENCE = {
  de: {
    pupil: {
      1: {
        title: 'Gefühl am Tagesende',
        instruction: `Eigenständiges Thema: Was ein Job am Ende des Tages mitbringen müsste.
Frage nur danach — nicht nach Werten, Prioritäten oder Passung.
Nicht nach Wunschberufen oder großen Träumen fragen.`,
        example: 'Was müsste dein Job haben, damit du dich am Ende des Tages gut fühlst?',
      },
      2: {
        title: 'Werte & Prioritäten',
        instruction: `Eigenständiges Thema: Was dem Nutzer wichtiger ist — z. B. Sicherheit, Spaß, Geld, anderen helfen oder etwas erschaffen — und warum.
Frage nur danach — kein Bezug auf die Antwort zu Frage 1, kein „Und …?“.
Nicht erneut nach dem Gefühl am Tagesende oder nach Passung fragen.`,
        example: 'Was wäre dir wichtiger: Sicherheit, Spaß, Geld, anderen helfen oder etwas erschaffen? Warum?',
      },
      3: {
        title: 'Erkennungszeichen für gute Passung',
        instruction: `Eigenständiges Thema: Woran der Nutzer merken würde, dass ein Job gut zu ihm/ihr passt — konkrete Signale oder Situationen.
Frage nur danach — kein Bezug auf vorherige Antworten, kein Aufbau darauf.
Nicht erneut nach Gefühl am Tagesende oder Werte-Rangfolge fragen.`,
        example: 'Woran würdest du merken, dass dein Job gut zu dir passt?',
      },
    },
    student: {
      1: {
        title: 'Gefühl am Tagesende',
        instruction: `Eigenständiges Thema: Was ein Job am Ende des Tages mitbringen müsste.
Frage nur danach — nicht nach Werten, Prioritäten oder Passung.
Nicht nur nach großen Träumen oder abstrakten Zielen fragen.`,
        example: 'Was müsste dein Job haben, damit du dich am Ende des Tages gut fühlst?',
      },
      2: {
        title: 'Werte & Prioritäten',
        instruction: `Eigenständiges Thema: Was dem Nutzer wichtiger ist — z. B. Sicherheit, Spaß, Geld, anderen helfen oder etwas erschaffen — und warum.
Frage nur danach — kein Bezug auf die Antwort zu Frage 1.
Nicht erneut nach dem Gefühl am Tagesende oder nach Passung fragen.`,
        example: 'Was wäre dir wichtiger: Sicherheit, Spaß, Geld, anderen helfen oder etwas erschaffen? Warum?',
      },
      3: {
        title: 'Erkennungszeichen für gute Passung',
        instruction: `Eigenständiges Thema: Woran der Nutzer merken würde, dass ein Job gut passt — konkrete Signale oder Situationen.
Frage nur danach — kein Bezug auf vorherige Antworten.
Nicht erneut nach Gefühl am Tagesende oder Werte-Rangfolge fragen.`,
        example: 'Woran würdest du merken, dass dein Job gut zu dir passt?',
      },
    },
    early_career: {
      1: {
        title: 'Gefühl am Tagesende',
        instruction: `Eigenständiges Thema: Was ein Job am Ende des Tages mitbringen müsste.
Frage nur danach — nicht nach Werten, Prioritäten oder Passung.
Nicht nur nach großen Träumen oder Karriereplänen fragen.`,
        example: 'Was müsste dein Job haben, damit du dich am Ende des Tages gut fühlst?',
      },
      2: {
        title: 'Werte & Prioritäten',
        instruction: `Eigenständiges Thema: Was dem Nutzer wichtiger ist — z. B. Sicherheit, Spaß, Geld, anderen helfen oder etwas erschaffen — und warum.
Frage nur danach — kein Bezug auf die Antwort zu Frage 1.
Nicht erneut nach dem Gefühl am Tagesende oder nach Passung fragen.`,
        example: 'Was wäre dir wichtiger: Sicherheit, Spaß, Geld, anderen helfen oder etwas erschaffen? Warum?',
      },
      3: {
        title: 'Erkennungszeichen für gute Passung',
        instruction: `Eigenständiges Thema: Woran der Nutzer merken würde, dass ein Job gut passt — konkrete Signale oder Situationen.
Frage nur danach — kein Bezug auf vorherige Antworten.
Nicht erneut nach Gefühl am Tagesende oder Werte-Rangfolge fragen.`,
        example: 'Woran würdest du merken, dass dein Job gut zu dir passt?',
      },
    },
    mid_career: {
      1: {
        title: 'Gefühl am Tagesende',
        instruction: `Eigenständiges Thema: Was ein Job im Berufsalltag am Ende des Tages mitbringen müsste.
Frage nur danach — nicht nach Werten, Prioritäten oder Passung.
Nicht nur nach großen Träumen oder Status fragen.`,
        example: 'Was müsste dein Job haben, damit du dich am Ende des Tages gut fühlst?',
      },
      2: {
        title: 'Werte & Prioritäten',
        instruction: `Eigenständiges Thema: Was dem Nutzer wichtiger ist — z. B. Sicherheit, Spaß, Geld, anderen helfen oder etwas erschaffen — und warum.
Frage nur danach — kein Bezug auf die Antwort zu Frage 1.
Nicht erneut nach dem Gefühl am Tagesende oder nach Passung fragen.`,
        example: 'Was wäre dir wichtiger: Sicherheit, Spaß, Geld, anderen helfen oder etwas erschaffen? Warum?',
      },
      3: {
        title: 'Erkennungszeichen für gute Passung',
        instruction: `Eigenständiges Thema: Woran der Nutzer merken würde, dass ein Job gut passt — konkrete Signale oder Situationen.
Frage nur danach — kein Bezug auf vorherige Antworten.
Nicht erneut nach Gefühl am Tagesende oder Werte-Rangfolge fragen.`,
        example: 'Woran würdest du merken, dass dein Job gut zu dir passt?',
      },
    },
    senior: {
      1: {
        title: 'Gefühl am Tagesende',
        instruction: `Eigenständiges Thema: Was eine Rolle am Ende des Tages mitbringen müsste.
Frage nur danach — nicht nach Werten, Prioritäten oder Passung.
Nicht nur nach großen Träumen oder Status fragen.`,
        example: 'Was müsste dein Job haben, damit du dich am Ende des Tages gut fühlst?',
      },
      2: {
        title: 'Werte & Prioritäten',
        instruction: `Eigenständiges Thema: Was dem Nutzer wichtiger ist — z. B. Sicherheit, Spaß, Geld, anderen helfen oder etwas erschaffen — und warum.
Frage nur danach — kein Bezug auf die Antwort zu Frage 1.
Nicht erneut nach dem Gefühl am Tagesende oder nach Passung fragen.`,
        example: 'Was wäre dir wichtiger: Sicherheit, Spaß, Geld, anderen helfen oder etwas erschaffen? Warum?',
      },
      3: {
        title: 'Erkennungszeichen für gute Passung',
        instruction: `Eigenständiges Thema: Woran der Nutzer merken würde, dass eine Rolle gut passt — konkrete Signale oder Situationen.
Frage nur danach — kein Bezug auf vorherige Antworten.
Nicht erneut nach Gefühl am Tagesende oder Werte-Rangfolge fragen.`,
        example: 'Woran würdest du merken, dass dein Job gut zu dir passt?',
      },
    },
  },
  en: {
    pupil: {
      1: {
        title: 'End-of-day feeling',
        instruction: `Standalone topic: what a job would need to provide by the end of the day.
Ask only about this — not values, priorities, or fit.
Do not ask about dream jobs or big dreams.`,
        example: 'What would your job need to have for you to feel good at the end of the day?',
      },
      2: {
        title: 'Values & priorities',
        instruction: `Standalone topic: what matters more to the user — e.g. security, fun, money, helping others, or creating something — and why.
Ask only about this — no reference to the answer to question 1, no "And what about …?".
Do not ask again about end-of-day feeling or fit.`,
        example: 'What would matter more to you: security, fun, money, helping others, or creating something? Why?',
      },
      3: {
        title: 'Signs of good fit',
        instruction: `Standalone topic: how the user would notice that a job fits them — concrete signals or situations.
Ask only about this — no reference to previous answers, no building on them.
Do not ask again about end-of-day feeling or value rankings.`,
        example: 'How would you notice that your job fits you well?',
      },
    },
    student: {
      1: {
        title: 'End-of-day feeling',
        instruction: `Standalone topic: what a job would need to provide by the end of the day.
Ask only about this — not values, priorities, or fit.
Do not ask only about big dreams or abstract goals.`,
        example: 'What would your job need to have for you to feel good at the end of the day?',
      },
      2: {
        title: 'Values & priorities',
        instruction: `Standalone topic: what matters more to the user — e.g. security, fun, money, helping others, or creating something — and why.
Ask only about this — no reference to the answer to question 1.
Do not ask again about end-of-day feeling or fit.`,
        example: 'What would matter more to you: security, fun, money, helping others, or creating something? Why?',
      },
      3: {
        title: 'Signs of good fit',
        instruction: `Standalone topic: how the user would notice that a job fits them — concrete signals or situations.
Ask only about this — no reference to previous answers.
Do not ask again about end-of-day feeling or value rankings.`,
        example: 'How would you notice that your job fits you well?',
      },
    },
    early_career: {
      1: {
        title: 'End-of-day feeling',
        instruction: `Standalone topic: what a job would need to provide by the end of the day.
Ask only about this — not values, priorities, or fit.
Do not ask only about big dreams or career plans.`,
        example: 'What would your job need to have for you to feel good at the end of the day?',
      },
      2: {
        title: 'Values & priorities',
        instruction: `Standalone topic: what matters more to the user — e.g. security, fun, money, helping others, or creating something — and why.
Ask only about this — no reference to the answer to question 1.
Do not ask again about end-of-day feeling or fit.`,
        example: 'What would matter more to you: security, fun, money, helping others, or creating something? Why?',
      },
      3: {
        title: 'Signs of good fit',
        instruction: `Standalone topic: how the user would notice that a job fits them — concrete signals or situations.
Ask only about this — no reference to previous answers.
Do not ask again about end-of-day feeling or value rankings.`,
        example: 'How would you notice that your job fits you well?',
      },
    },
    mid_career: {
      1: {
        title: 'End-of-day feeling',
        instruction: `Standalone topic: what a job in daily work would need to provide by the end of the day.
Ask only about this — not values, priorities, or fit.
Do not ask only about big dreams or status.`,
        example: 'What would your job need to have for you to feel good at the end of the day?',
      },
      2: {
        title: 'Values & priorities',
        instruction: `Standalone topic: what matters more to the user — e.g. security, fun, money, helping others, or creating something — and why.
Ask only about this — no reference to the answer to question 1.
Do not ask again about end-of-day feeling or fit.`,
        example: 'What would matter more to you: security, fun, money, helping others, or creating something? Why?',
      },
      3: {
        title: 'Signs of good fit',
        instruction: `Standalone topic: how the user would notice that a job fits them — concrete signals or situations.
Ask only about this — no reference to previous answers.
Do not ask again about end-of-day feeling or value rankings.`,
        example: 'How would you notice that your job fits you well?',
      },
    },
    senior: {
      1: {
        title: 'End-of-day feeling',
        instruction: `Standalone topic: what a role would need to provide by the end of the day.
Ask only about this — not values, priorities, or fit.
Do not ask only about big dreams or status.`,
        example: 'What would your job need to have for you to feel good at the end of the day?',
      },
      2: {
        title: 'Values & priorities',
        instruction: `Standalone topic: what matters more to the user — e.g. security, fun, money, helping others, or creating something — and why.
Ask only about this — no reference to the answer to question 1.
Do not ask again about end-of-day feeling or fit.`,
        example: 'What would matter more to you: security, fun, money, helping others, or creating something? Why?',
      },
      3: {
        title: 'Signs of good fit',
        instruction: `Standalone topic: how the user would notice that a role fits them — concrete signals or situations.
Ask only about this — no reference to previous answers.
Do not ask again about end-of-day feeling or value rankings.`,
        example: 'How would you notice that your job fits you well?',
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

/**
 * Single user turn for question generation. Prior answers are listed only for de-duplication,
 * not to build follow-up questions on top of them.
 */
function buildQuestionTurnUserMessage({ lang, questionNumber, messages, audience = 'pupil' }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const focus = resolveQuestionFocus(lang, questionNumber, audience);
  const coverage = formatPriorCoverageBlock(messages, lang);

  if (questionNumber <= 1) {
    return isDe
      ? `Stelle jetzt Frage 1 zum eigenständigen Thema „${focus.title}“.`
      : `Ask question 1 now for the standalone topic "${focus.title}".`;
  }

  if (isDe) {
    return `Bereits abgedeckte Themenbereiche — diese Bereiche sind abgeschlossen, nicht erneut ansprechen:
${coverage}

Stelle jetzt Frage ${questionNumber} von ${COACHING_QUESTION_COUNT} zum eigenständigen Thema „${focus.title}“.
- Nur die eine Frage ausgeben
- Kein Bezug auf vorherige Antworten (kein „Du hast gesagt …“, kein „Und …?“, kein Aufbau darauf)
- Das neue Thema muss sich klar von den bereits abgedeckten Bereichen unterscheiden`;
  }

  return `Topic areas already covered — these are complete, do not revisit them:
${coverage}

Ask question ${questionNumber} of ${COACHING_QUESTION_COUNT} for the standalone topic "${focus.title}".
- Output only the single question
- No reference to previous answers (no "you said …", no "and what about …", no building on them)
- The new topic must differ clearly from the areas already covered`;
}

function buildQuestionTaskRules({ lang, questionNumber, focus, audience = 'pupil' }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const example = focus.example;
  const styleHint = questionStyleHint(lang, audience);

  if (isDe) {
    return `Deine Aufgabe jetzt:
- Stelle genau EINE kurze, einfache Frage zu diesem eigenständigen Thema.
- Frage nicht nur nach großen Träumen, sondern nach dem, was dem Nutzer wirklich wichtig ist.
- Jede Frage ist ein eigenes Thema — keine Vertiefung, kein Aufbau auf vorherigen Antworten.
- Antworte ausschließlich auf Deutsch.
${styleHint}
- Keine Aufzählungen, keine Erklärungen, keine Begrüßung, kein Ermutigungssatz — nur die eine Frage.
- Kein „Und …?“, kein „Du hast erwähnt …“, kein Bezug auf frühere Antworten.

Beispiel für den Stil (nicht wörtlich kopieren): „${example}“`;
  }

  return `Your task now:
- Ask exactly ONE short, simple question about this standalone topic.
- Do not ask only about big dreams — ask what really matters to the user.
- Each question is its own topic — no drill-down, no building on previous answers.
- Respond only in English.
${styleHint}
- No lists, no explanations, no greeting, no encouraging preamble — only the single question.
- No "and what about …", no "you mentioned …", no reference to earlier answers.

Example for the tone (do not copy verbatim): "${example}"`;
}

function buildQuestionSystemPrompt({ audience, lang, seniority, questionNumber, cvContext }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const hints = AUDIENCE_HINTS[isDe ? 'de' : 'en'][audience];
  const context = formatSeniorityContext(seniority, lang);
  const focus = resolveQuestionFocus(lang, questionNumber, audience);
  const { formatCoachingCvContextBlock } = require('../services/profile/coachingCvContext');
  const cvBlock = formatCoachingCvContextBlock('workingLifeAchievement', cvContext, lang);

  if (isDe) {
    const pupilExtra = audience === 'pupil'
      ? `
Zielgruppe: Schülerin/Schüler in der Berufsorientierung (einfache Sprache, ca. 9. Klasse).
Frage nicht nur nach großen Träumen, sondern nach dem, was dem Nutzer wirklich wichtig ist.`
      : `
Frage nicht nur nach großen Träumen, sondern nach dem, was dem Nutzer wirklich wichtig ist. Formuliere passend zum Berufsstand des Nutzers.`;
    return `${coachRoleLabel(lang, audience)}
${hints}${pupilExtra}

Deine Aufgabe: Stelle nacheinander ${COACHING_QUESTION_COUNT} kurze, einfache Fragen zu drei eigenständigen Themen — nicht als Aufbau aufeinander, sondern als getrennte Blickwinkel.

Kontext zum Nutzer:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Eigenständiges Thema dieser Frage (${questionNumber} von ${COACHING_QUESTION_COUNT}): ${focus.title}
${focus.instruction}

${buildQuestionTaskRules({ lang, questionNumber, focus, audience })}`;
  }

  const pupilExtraEn = audience === 'pupil'
    ? '\nDo not ask only about big dreams — ask what really matters to the user.'
    : '\nDo not ask only about big dreams — ask what really matters to the user. Match wording to the user\'s career stage.';

  return `${coachRoleLabel(lang, audience)}
${hints}${pupilExtraEn}

Your task: ask ${COACHING_QUESTION_COUNT} short, simple questions on three standalone topics — not building on each other, but as separate angles.

User context:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Standalone topic for this question (${questionNumber} of ${COACHING_QUESTION_COUNT}): ${focus.title}
${focus.instruction}

${buildQuestionTaskRules({ lang, questionNumber, focus, audience })}`;
}

function buildCareerGoalsSynthesisRules(lang) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const forbidden = FORBIDDEN_GENERIC_GOALS.slice(0, 3).join('", "');
  const forbiddenEn = FORBIDDEN_GENERIC_GOALS.slice(3).join('", "');

  if (isDe) {
    return `1. Wichtigste Ziele im Berufsleben (genau ${CAREER_GOAL_COUNT} Punkte)

Regeln:
- formuliere als klare Aussagen
- max. ${MAX_CAREER_GOAL_WORDS} Wörter pro Punkt
- vermeide Floskeln wie „${forbidden}“
- stattdessen konkreter, z. B. „am Ende des Tages etwas geschafft haben“, „anderen Menschen konkret weiterhelfen“, „eigene Ideen umsetzen können“
- beziehe dich gedanklich auf die Antworten
- wiederhole die Aussagen des Nutzers nicht 1:1 — fasse sinnvoll zusammen`;
  }

  return `1. Key career goals (exactly ${CAREER_GOAL_COUNT} items)

Rules:
- phrase as clear statements
- max ${MAX_CAREER_GOAL_WORDS} words per item
- avoid fluff like "${forbiddenEn}"
- instead be concrete, e.g. "accomplish something meaningful by day's end", "help others in concrete ways", "put my own ideas into practice"
- mentally refer to the answers
- do not repeat the user's wording verbatim — synthesize meaningfully`;
}

function buildPrioritiesSynthesisRules(lang) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  if (isDe) {
    return `2. Was dem Nutzer dabei besonders wichtig ist (genau ${PRIORITY_COUNT} Punkte)

Regeln:
- kurze Begründungen in einfacher Sprache
- direkt aus den Antworten ableiten
- keine allgemeinen Aussagen
- max. ${MAX_PRIORITY_WORDS} Wörter pro Punkt
- wiederhole die Aussagen des Nutzers nicht 1:1 — fasse sinnvoll zusammen`;
  }

  return `2. What matters especially to the user (exactly ${PRIORITY_COUNT} items)

Rules:
- short reasons in simple language
- derive directly from the answers
- no generic statements
- max ${MAX_PRIORITY_WORDS} words per item
- do not repeat the user's wording verbatim — synthesize meaningfully`;
}

function buildSummarySystemPrompt({ audience, lang, seniority, cvContext }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const hints = AUDIENCE_HINTS[isDe ? 'de' : 'en'][audience];
  const context = formatSeniorityContext(seniority, lang);
  const { formatCoachingCvContextBlock } = require('../services/profile/coachingCvContext');
  const cvBlock = formatCoachingCvContextBlock('workingLifeAchievement', cvContext, lang);
  const cvSummaryRule = isDe
    ? 'Leite careerGoals und priorities ausschließlich aus den Chat-Antworten ab — kopiere keine CV-Inhalte.'
    : 'Derive careerGoals and priorities exclusively from chat answers — do not copy CV content.';

  if (isDe) {
    return `${coachRoleLabel(lang, audience)}
${hints}

Kontext zum Nutzer:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Analysiere die Antworten des Nutzers auf drei Coaching-Fragen und leite daraus ab:

${buildCareerGoalsSynthesisRules(lang)}

${buildPrioritiesSynthesisRules(lang)}

- ${cvSummaryRule}

Ziel: Der Nutzer soll verstehen, was ihn/sie langfristig antreibt — nicht nur, was „gut klingt“.

Antworte ausschließlich als JSON-Objekt:
{"careerGoals":["Ziel 1","Ziel 2","Ziel 3","Ziel 4","Ziel 5"],"priorities":["Wichtig 1","Wichtig 2","Wichtig 3"]}`;
  }

  return `${coachRoleLabel(lang, audience)}
${hints}

User context:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Analyze the user's answers to three coaching questions and derive:

${buildCareerGoalsSynthesisRules(lang)}

${buildPrioritiesSynthesisRules(lang)}

- ${cvSummaryRule}

Goal: the user should understand what drives them long term — not just what sounds good.

Reply only as a JSON object:
{"careerGoals":["goal 1","goal 2","goal 3","goal 4","goal 5"],"priorities":["priority 1","priority 2","priority 3"]}`;
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

Leite careerGoals und priorities durch Synthese ab — kopiere die Antworten nicht und liste sie nicht auf.`;
  }
  return `${transcript}

Derive careerGoals and priorities by synthesis — do not copy or list the answers.`;
}

module.exports = {
  COACHING_QUESTION_COUNT,
  CAREER_GOAL_COUNT,
  MAX_CAREER_GOAL_WORDS,
  PRIORITY_COUNT,
  MAX_PRIORITY_WORDS,
  FORBIDDEN_GENERIC_GOALS,
  QUESTION_FOCUS_BY_AUDIENCE,
  resolveWorkEnjoyCoachingAudience,
  resolveQuestionFocus,
  buildQuestionTurnUserMessage,
  buildQuestionTaskRules,
  buildQuestionSystemPrompt,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
};
