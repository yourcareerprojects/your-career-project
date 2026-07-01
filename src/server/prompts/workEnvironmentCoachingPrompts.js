const {
  resolveWorkEnjoyCoachingAudience,
  formatSeniorityContext,
  AUDIENCE_HINTS,
  extractPriorCoveragePairs,
  formatPriorCoverageBlock,
} = require('./workEnjoyCoachingPrompts');

const COACHING_QUESTION_COUNT = 3;
const WORK_STYLE_COUNT = 5;
const MAX_WORK_STYLE_WORDS = 7;
const WORK_ENVIRONMENT_MIN = 3;
const WORK_ENVIRONMENT_MAX = 5;
const MAX_ENVIRONMENT_WORDS = 8;

const FORBIDDEN_GENERIC_WORK_STYLES = [
  'im team arbeiten',
  'selbstständig arbeiten',
  'selbststaendig arbeiten',
  'teamarbeit',
  'eigenständig arbeiten',
  'eigenstaendig arbeiten',
  'work in a team',
  'work independently',
  'teamwork',
  'work alone',
];

/** Per-audience question angles — concrete daily situations, not wishful thinking. */
const QUESTION_FOCUS_BY_AUDIENCE = {
  de: {
    pupil: {
      1: {
        title: 'Allein oder mit anderen',
        instruction: `Frage nach konkreten Situationen aus dem Alltag (Schule, Freizeit, zu Hause), in denen der Nutzer lieber allein oder mit anderen arbeitet.
Nicht nach Wunschberufen oder abstrakten Vorstellungen fragen.`,
        example: 'Wann arbeitest du am besten: allein oder mit anderen? Warum?',
      },
      2: {
        title: 'Ruhig oder mit Action',
        instruction: `Frage nach Situationen, in denen der Nutzer lieber ruhig und konzentriert arbeitet oder eher mit viel Action und Abwechslung.
Nicht erneut nach allein vs. mit anderen fragen.`,
        example: 'Arbeitest du lieber ruhig und konzentriert oder mit viel Action?',
      },
      3: {
        title: 'Vorgaben oder eigene Lösungen',
        instruction: `Frage nach Situationen, in denen der Nutzer klare Vorgaben braucht oder lieber eigene Lösungen findet.
Nicht erneut nach allein vs. mit anderen oder ruhig vs. Action fragen.`,
        example: 'Magst du klare Vorgaben oder findest du lieber eigene Lösungen?',
      },
    },
    student: {
      1: {
        title: 'Allein oder mit anderen',
        instruction: `Frage nach konkreten Situationen in Studium, Ausbildung oder Praktika, in denen der Nutzer lieber allein oder mit anderen arbeitet.
Nicht nach Wunschberufen oder abstrakten Vorstellungen fragen.`,
        example: 'Wann arbeitest du am besten: allein oder mit anderen? Warum?',
      },
      2: {
        title: 'Ruhig oder mit Action',
        instruction: `Frage nach Situationen, in denen der Nutzer lieber ruhig und konzentriert arbeitet oder eher mit viel Action und Abwechslung.
Nicht erneut nach allein vs. mit anderen fragen.`,
        example: 'Arbeitest du lieber ruhig und konzentriert oder mit viel Action?',
      },
      3: {
        title: 'Vorgaben oder eigene Lösungen',
        instruction: `Frage nach Situationen, in denen der Nutzer klare Vorgaben braucht oder lieber eigene Lösungen findet.
Nicht erneut nach den vorherigen Bereichen fragen.`,
        example: 'Magst du klare Vorgaben oder findest du lieber eigene Lösungen?',
      },
    },
    early_career: {
      1: {
        title: 'Allein oder mit anderen',
        instruction: `Frage nach konkreten Situationen im Job, in Praktika oder Projekten, in denen der Nutzer lieber allein oder mit anderen arbeitet.
Nicht nach Wunschberufen oder abstrakten Vorstellungen fragen.`,
        example: 'Wann arbeitest du bei der Arbeit am besten: allein oder mit anderen?',
      },
      2: {
        title: 'Ruhig oder mit Action',
        instruction: `Frage nach Situationen, in denen der Nutzer lieber ruhig und konzentriert arbeitet oder eher mit viel Action und Abwechslung.
Nicht erneut nach allein vs. mit anderen fragen.`,
        example: 'Arbeitest du lieber ruhig und konzentriert oder mit viel Action im Arbeitsalltag?',
      },
      3: {
        title: 'Vorgaben oder eigene Lösungen',
        instruction: `Frage nach Situationen, in denen der Nutzer klare Vorgaben braucht oder lieber eigene Lösungen findet.
Nicht erneut nach den vorherigen Bereichen fragen.`,
        example: 'Magst du klare Vorgaben oder findest du lieber eigene Lösungen bei der Arbeit?',
      },
    },
    mid_career: {
      1: {
        title: 'Allein oder mit anderen',
        instruction: `Frage nach konkreten Situationen im Berufsalltag, in denen der Nutzer lieber allein oder mit anderen arbeitet.
Nicht nach Wunschberufen oder abstrakten Vorstellungen fragen.`,
        example: 'Wann arbeitest du im Berufsalltag am besten: allein oder mit anderen?',
      },
      2: {
        title: 'Ruhig oder mit Action',
        instruction: `Frage nach Situationen, in denen der Nutzer lieber ruhig und konzentriert arbeitet oder eher mit viel Action und Abwechslung.
Nicht erneut nach allein vs. mit anderen fragen.`,
        example: 'Arbeitest du lieber ruhig und konzentriert oder mit viel Action im Berufsalltag?',
      },
      3: {
        title: 'Vorgaben oder eigene Lösungen',
        instruction: `Frage nach Situationen, in denen der Nutzer klare Vorgaben braucht oder lieber eigene Lösungen findet.
Nicht erneut nach den vorherigen Bereichen fragen.`,
        example: 'Magst du klare Vorgaben oder findest du lieber eigene Lösungen im Job?',
      },
    },
    senior: {
      1: {
        title: 'Allein oder mit anderen',
        instruction: `Frage nach konkreten Situationen in Verantwortung oder Führung, in denen der Nutzer lieber allein oder mit anderen arbeitet.
Nicht nach Wunschberufen oder abstrakten Vorstellungen fragen.`,
        example: 'Wann arbeitest du in deiner Rolle am besten: allein oder mit anderen?',
      },
      2: {
        title: 'Ruhig oder mit Action',
        instruction: `Frage nach Situationen, in denen der Nutzer lieber ruhig und konzentriert arbeitet oder eher mit viel Action und Abwechslung.
Nicht erneut nach allein vs. mit anderen fragen.`,
        example: 'Arbeitest du lieber ruhig und konzentriert oder mit viel Action in deiner Verantwortung?',
      },
      3: {
        title: 'Vorgaben oder eigene Lösungen',
        instruction: `Frage nach Situationen, in denen der Nutzer klare Vorgaben braucht oder lieber eigene Lösungen findet.
Nicht erneut nach den vorherigen Bereichen fragen.`,
        example: 'Magst du klare Vorgaben oder findest du lieber eigene Lösungen in deiner Rolle?',
      },
    },
  },
  en: {
    pupil: {
      1: {
        title: 'Alone or with others',
        instruction: `Ask about concrete situations from daily life (school, free time, home) where the user prefers working alone or with others.
Do not ask about dream jobs or abstract ideals.`,
        example: 'When do you work best: alone or with others? Why?',
      },
      2: {
        title: 'Quiet or high energy',
        instruction: `Ask about situations where the user prefers calm, focused work or more action and variety.
Do not ask again about alone vs. with others.`,
        example: 'Do you prefer working quietly and focused, or with lots of action?',
      },
      3: {
        title: 'Guidelines or own solutions',
        instruction: `Ask about situations where the user needs clear guidelines or prefers finding their own solutions.
Do not ask again about the previous areas.`,
        example: 'Do you like clear guidelines, or do you prefer finding your own solutions?',
      },
    },
    student: {
      1: {
        title: 'Alone or with others',
        instruction: `Ask about concrete situations in study, training, or internships where the user prefers working alone or with others.
Do not ask about dream jobs or abstract ideals.`,
        example: 'When do you work best: alone or with others? Why?',
      },
      2: {
        title: 'Quiet or high energy',
        instruction: `Ask about situations where the user prefers calm, focused work or more action and variety.
Do not ask again about alone vs. with others.`,
        example: 'Do you prefer working quietly and focused, or with lots of action?',
      },
      3: {
        title: 'Guidelines or own solutions',
        instruction: `Ask about situations where the user needs clear guidelines or prefers finding their own solutions.
Do not ask again about the previous areas.`,
        example: 'Do you like clear guidelines, or do you prefer finding your own solutions?',
      },
    },
    early_career: {
      1: {
        title: 'Alone or with others',
        instruction: `Ask about concrete situations at work, in internships, or projects where the user prefers working alone or with others.
Do not ask about dream jobs or abstract ideals.`,
        example: 'When do you work best at work: alone or with others?',
      },
      2: {
        title: 'Quiet or high energy',
        instruction: `Ask about situations where the user prefers calm, focused work or more action and variety.
Do not ask again about alone vs. with others.`,
        example: 'Do you prefer working quietly and focused, or with lots of action at work?',
      },
      3: {
        title: 'Guidelines or own solutions',
        instruction: `Ask about situations where the user needs clear guidelines or prefers finding their own solutions.
Do not ask again about the previous areas.`,
        example: 'Do you like clear guidelines, or do you prefer finding your own solutions at work?',
      },
    },
    mid_career: {
      1: {
        title: 'Alone or with others',
        instruction: `Ask about concrete situations in daily work where the user prefers working alone or with others.
Do not ask about dream jobs or abstract ideals.`,
        example: 'When do you work best at work: alone or with others?',
      },
      2: {
        title: 'Quiet or high energy',
        instruction: `Ask about situations where the user prefers calm, focused work or more action and variety.
Do not ask again about alone vs. with others.`,
        example: 'Do you prefer working quietly and focused, or with lots of action at work?',
      },
      3: {
        title: 'Guidelines or own solutions',
        instruction: `Ask about situations where the user needs clear guidelines or prefers finding their own solutions.
Do not ask again about the previous areas.`,
        example: 'Do you like clear guidelines, or do you prefer finding your own solutions on the job?',
      },
    },
    senior: {
      1: {
        title: 'Alone or with others',
        instruction: `Ask about concrete situations in responsibility or leadership where the user prefers working alone or with others.
Do not ask about dream jobs or abstract ideals.`,
        example: 'When do you work best in your role: alone or with others?',
      },
      2: {
        title: 'Quiet or high energy',
        instruction: `Ask about situations where the user prefers calm, focused work or more action and variety.
Do not ask again about alone vs. with others.`,
        example: 'Do you prefer working quietly and focused, or with lots of action in your role?',
      },
      3: {
        title: 'Guidelines or own solutions',
        instruction: `Ask about situations where the user needs clear guidelines or prefers finding their own solutions.
Do not ask again about the previous areas.`,
        example: 'Do you like clear guidelines, or do you prefer finding your own solutions in your role?',
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
- Frage nach konkreten Situationen aus dem Alltag — nicht nach Wunschvorstellungen.
- Antworte ausschließlich auf Deutsch.
${styleHint}
- Keine Aufzählungen, keine Erklärungen, keine Begrüßung — nur die eine Frage.

Beispiel für den Stil (nicht wörtlich kopieren): „${example}“`;
    }
    return `Your task now:
- Ask exactly ONE short, simple question about this focus area.
- Ask about concrete situations from daily life — not wishful thinking.
- Respond only in English.
${styleHint}
- No lists, no explanations, no greeting — only the single question.

Example for the tone (do not copy verbatim): "${example}"`;
  }

  if (isDe) {
    return `Deine Aufgabe jetzt:
- Reagiere zuerst mit genau EINEM kurzen, positiven oder motivierenden Satz auf die letzte Antwort (keine Rückfrage, keine Wiederholung von Details).
- Stelle danach genau EINE kurze, konkrete Frage zum neuen Fokus — der Bereich muss sich deutlich vom vorherigen unterscheiden.
- Frage nach konkreten Situationen aus dem Alltag — nicht nach Wunschvorstellungen.
- Antworte ausschließlich auf Deutsch.
- Keine Aufzählungen, keine langen Erklärungen — höchstens ein Ermutigungssatz plus eine Frage.
- Keine Vertiefungsfrage zum vorherigen Thema.

Beispiel für den Stil (nicht wörtlich kopieren): „Das klingt gut! ${example}“`;
  }

  return `Your task now:
- First, write exactly ONE short, positive or encouraging sentence about their latest answer (not a question, do not repeat details).
- Then ask exactly ONE short, concrete question about the new focus — the area must differ clearly from the previous one.
- Ask about concrete situations from daily life — not wishful thinking.
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
  const cvBlock = formatCoachingCvContextBlock('workEnvironment', cvContext, lang);

  if (isDe) {
    const pupilExtra = audience === 'pupil'
      ? `
Zielgruppe: Schülerin/Schüler in der Berufsorientierung (einfache Sprache, ca. 9. Klasse).
Frage nach konkreten Situationen aus dem Alltag — nicht nach Wunschvorstellungen.`
      : `
Frage nach konkreten Situationen aus dem Alltag — nicht nach Wunschvorstellungen. Formuliere passend zum Berufsstand des Nutzers.`;
    return `${coachRoleLabel(lang, audience)}
${hints}${pupilExtra}

Deine Aufgabe: Stelle nacheinander ${COACHING_QUESTION_COUNT} kurze, einfache Fragen, um herauszufinden, wie der Nutzer am liebsten arbeitet und in welchem Umfeld er/sie sich wohlfühlt.

Kontext zum Nutzer:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Fokus dieser Frage (${questionNumber} von ${COACHING_QUESTION_COUNT}): ${focus.title}
${focus.instruction}

${buildQuestionTaskRules({ lang, questionNumber, focus, audience })}`;
  }

  const pupilExtraEn = audience === 'pupil'
    ? '\nAsk about concrete situations from daily life — not wishful thinking.'
    : '\nAsk about concrete situations from daily life — not wishful thinking. Match wording to the user\'s career stage.';

  return `${coachRoleLabel(lang, audience)}
${hints}${pupilExtraEn}

Your task: ask ${COACHING_QUESTION_COUNT} short, simple questions in sequence to find out how the user prefers to work and what environment they feel comfortable in.

User context:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Focus for this question (${questionNumber} of ${COACHING_QUESTION_COUNT}): ${focus.title}
${focus.instruction}

${buildQuestionTaskRules({ lang, questionNumber, focus, audience })}`;
}

function buildWorkStyleSynthesisRules(lang) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const forbidden = FORBIDDEN_GENERIC_WORK_STYLES.slice(0, 5).join('", "');
  const forbiddenEn = FORBIDDEN_GENERIC_WORK_STYLES.slice(5).join('", "');

  if (isDe) {
    return `1. Bevorzugte Arbeitsweise (genau ${WORK_STYLE_COUNT} Punkte)

Regeln:
- formuliere als konkretes Verhalten bei der Arbeit
- max. ${MAX_WORK_STYLE_WORDS} Wörter pro Punkt
- keine allgemeinen Aussagen wie „${forbidden}“
- stattdessen konkreter, z. B. „Aufgaben eigenständig strukturieren und umsetzen“, „Ideen im Austausch mit anderen entwickeln“, „Schritt für Schritt nach Plan arbeiten“
- beziehe dich gedanklich auf die Antworten
- vermeide zu allgemeine Begriffe
- wiederhole die Aussagen des Nutzers nicht 1:1 — fasse sinnvoll zusammen`;
  }

  return `1. Preferred way of working (exactly ${WORK_STYLE_COUNT} items)

Rules:
- phrase as concrete behavior at work
- max ${MAX_WORK_STYLE_WORDS} words per item
- no generic statements like "${forbiddenEn}"
- instead be concrete, e.g. "structure and complete tasks independently", "develop ideas in exchange with others", "work step by step according to plan"
- mentally refer to the answers
- avoid overly general terms
- do not repeat the user's wording verbatim — synthesize meaningfully`;
}

function buildWorkEnvironmentSynthesisRules(lang) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  if (isDe) {
    return `2. Passendes Arbeitsumfeld (${WORK_ENVIRONMENT_MIN}–${WORK_ENVIRONMENT_MAX} Punkte)

Regeln:
- beschreibe Umgebung oder Rahmenbedingungen
- einfach verständlich
- max. ${MAX_ENVIRONMENT_WORDS} Wörter pro Punkt
- keine unrealistischen Wünsche (z. B. „wenig arbeiten, viel verdienen“)
- Beispiele für das gewünschte Niveau: „ruhige Umgebung mit wenig Ablenkung“, „abwechslungsreiche Aufgaben im Alltag“, „klare Strukturen und feste Abläufe“
- beziehe dich gedanklich auf die Antworten
- wiederhole die Aussagen des Nutzers nicht 1:1 — fasse sinnvoll zusammen`;
  }

  return `2. Suitable work environment (${WORK_ENVIRONMENT_MIN}–${WORK_ENVIRONMENT_MAX} items)

Rules:
- describe environment or working conditions
- easy to understand
- max ${MAX_ENVIRONMENT_WORDS} words per item
- no unrealistic wishes (e.g. "work little, earn a lot")
- examples of the desired level: "quiet environment with few distractions", "varied tasks in daily work", "clear structures and fixed routines"
- mentally refer to the answers
- do not repeat the user's wording verbatim — synthesize meaningfully`;
}

function buildSummarySystemPrompt({ audience, lang, seniority, cvContext }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const hints = AUDIENCE_HINTS[isDe ? 'de' : 'en'][audience];
  const context = formatSeniorityContext(seniority, lang);
  const { formatCoachingCvContextBlock } = require('../services/profile/coachingCvContext');
  const cvBlock = formatCoachingCvContextBlock('workEnvironment', cvContext, lang);
  const cvSummaryRule = isDe
    ? 'Leite workStyles und workEnvironments ausschließlich aus den Chat-Antworten ab — kopiere keine CV-Inhalte.'
    : 'Derive workStyles and workEnvironments exclusively from chat answers — do not copy CV content.';

  if (isDe) {
    return `${coachRoleLabel(lang, audience)}
${hints}

Kontext zum Nutzer:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Analysiere die Antworten des Nutzers auf drei Coaching-Fragen und leite daraus ab:

${buildWorkStyleSynthesisRules(lang)}

${buildWorkEnvironmentSynthesisRules(lang)}

- ${cvSummaryRule}

Ziel: Der Nutzer soll verstehen, wie er/sie gut arbeitet — nicht nur, was er/sie machen will.

Antworte ausschließlich als JSON-Objekt:
{"workStyles":["Arbeitsweise 1","Arbeitsweise 2","Arbeitsweise 3","Arbeitsweise 4","Arbeitsweise 5"],"workEnvironments":["Umfeld 1","Umfeld 2","Umfeld 3"]}`;
  }

  return `${coachRoleLabel(lang, audience)}
${hints}

User context:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Analyze the user's answers to three coaching questions and derive:

${buildWorkStyleSynthesisRules(lang)}

${buildWorkEnvironmentSynthesisRules(lang)}

- ${cvSummaryRule}

Goal: the user should understand how they work well — not just what they want to do.

Reply only as a JSON object:
{"workStyles":["work style 1","work style 2","work style 3","work style 4","work style 5"],"workEnvironments":["environment 1","environment 2","environment 3"]}`;
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

Leite workStyles und workEnvironments durch Synthese ab — kopiere die Antworten nicht und liste sie nicht auf.`;
  }
  return `${transcript}

Derive workStyles and workEnvironments by synthesis — do not copy or list the answers.`;
}

module.exports = {
  COACHING_QUESTION_COUNT,
  WORK_STYLE_COUNT,
  MAX_WORK_STYLE_WORDS,
  WORK_ENVIRONMENT_MIN,
  WORK_ENVIRONMENT_MAX,
  MAX_ENVIRONMENT_WORDS,
  FORBIDDEN_GENERIC_WORK_STYLES,
  QUESTION_FOCUS_BY_AUDIENCE,
  resolveWorkEnjoyCoachingAudience,
  resolveQuestionFocus,
  buildQuestionTurnUserMessage,
  buildQuestionSystemPrompt,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
};
