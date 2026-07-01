const { currentEmploymentStatusLabel } = require('../../constants/currentEmploymentStatus');
const { highestDegreeLabel } = require('../../constants/highestDegree');

const COACHING_QUESTION_COUNT = 3;
const ACTIVITY_COUNT = 5;
const MAX_ACTIVITY_WORDS = 6;

const PUPIL_DEGREES = new Set(['none', 'hauptschulabschluss', 'realschulabschluss']);

const GERMAN_STATUS_LABELS = {
  pupil: 'Schüler/in',
  student: 'Student/in',
  intern: 'Praktikant/in oder Azubi',
  employed: 'Angestellt',
  part_time: 'Teilzeit angestellt',
  'self-employed': 'Selbstständig',
  contractor: 'Freelancer / Vertrag',
  unemployed: 'Arbeitsuchend',
  extended_leave: 'Auszeit',
  retired: 'Im Ruhestand',
};

const GERMAN_DEGREE_LABELS = {
  none: 'Kein Abschluss',
  high_school: 'Abitur',
  hauptschulabschluss: 'Hauptschulabschluss',
  realschulabschluss: 'Realschulabschluss',
  ausbildung: 'Ausbildung',
  fachabitur: 'Fachabitur',
  associate: 'Associate-Abschluss',
  bachelors: 'Bachelor',
  masters: 'Master',
  phd: 'Promotion / Doktor',
  staatsexamen: 'Staatsexamen',
  professional: 'Berufsabschluss',
};

const GERMAN_MOST_SENIOR_LABELS = {
  intern: 'Praktikum / Einstieg',
  entry_level: 'Berufseinsteiger',
  mid_level: 'Erfahrene Fachkraft',
  senior: 'Senior',
  lead: 'Teamleitung',
  manager: 'Führungskraft',
  director: 'Direktor / Leitungsebene',
  vp: 'VP',
  c_suite: 'C-Level',
};

/**
 * @param {object} [seniority]
 * @returns {'pupil'|'student'|'early_career'|'mid_career'|'senior'}
 */
function resolveWorkEnjoyCoachingAudience(seniority = {}) {
  const status = String(seniority.currentStatus || '').trim();
  const degree = String(seniority.highestDegree || '').trim();
  const mostSenior = String(seniority.mostSeniorWorkExperience || '').trim();
  const yearsRaw = seniority.yearsOfExperience;
  const years = typeof yearsRaw === 'number' && Number.isFinite(yearsRaw) ? yearsRaw : null;

  if (status === 'pupil') return 'pupil';
  if (status === 'student' || status === 'intern') return 'student';
  if (PUPIL_DEGREES.has(degree) && (years === null || years <= 1)) return 'pupil';

  const executive = new Set(['lead', 'manager', 'director', 'vp', 'c_suite']);
  if (executive.has(mostSenior) || (years !== null && years >= 12)) return 'senior';

  const early = new Set(['intern', 'entry_level']);
  if (early.has(mostSenior) || (years !== null && years <= 3)) return 'early_career';

  return 'mid_career';
}

function formatSeniorityContext(seniority = {}, lang = 'de') {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const statusKey = String(seniority.currentStatus || '').trim();
  const degreeKey = String(seniority.highestDegree || '').trim();
  const mostSeniorKey = String(seniority.mostSeniorWorkExperience || '').trim();
  const status = isDe
    ? (GERMAN_STATUS_LABELS[statusKey] || currentEmploymentStatusLabel(statusKey) || statusKey)
    : (currentEmploymentStatusLabel(statusKey) || statusKey);
  const degree = isDe
    ? (GERMAN_DEGREE_LABELS[degreeKey] || highestDegreeLabel(degreeKey) || degreeKey)
    : (highestDegreeLabel(degreeKey) || degreeKey);
  const mostSenior = isDe
    ? (GERMAN_MOST_SENIOR_LABELS[mostSeniorKey] || mostSeniorKey)
    : mostSeniorKey;
  const years = seniority.yearsOfExperience;
  const yearsText = years === null || years === undefined || years === ''
    ? (isDe ? 'keine Angabe' : 'not specified')
    : String(years);

  if (isDe) {
    return `Aktueller Status: ${status || 'unbekannt'}
Höchster Bildungsabschluss: ${degree || 'unbekannt'}
Berufserfahrung in Jahren: ${yearsText}
Bisher höchste berufliche Rolle: ${mostSenior || 'unbekannt'}`;
  }

  return `Current status: ${status || 'unknown'}
Highest degree: ${degree || 'unknown'}
Years of work experience: ${yearsText}
Most senior role so far: ${mostSenior || 'unknown'}`;
}

const AUDIENCE_HINTS = {
  de: {
    pupil: 'Der Nutzer ist Schülerin/Schüler oder befindet sich in der Berufsorientierung. Verwende einfache Sprache (ca. 9. Klasse).',
    student: 'Der Nutzer ist Student/in, Azubi oder Praktikant/in. Frage nach Alltag, Studium/Ausbildung und ersten praktischen Erfahrungen.',
    early_career: 'Der Nutzer steht am Berufsanfang. Frage nach konkretem Arbeitsverhalten in Job, Praktika oder Projekten.',
    mid_career: 'Der Nutzer hat Berufserfahrung. Frage nach typischen Tätigkeiten, Rollen und Mustern im Arbeitsalltag.',
    senior: 'Der Nutzer ist erfahren oder in Führungsrollen. Frage nach Verantwortung, Wirkung, Zusammenarbeit und Entscheidungen.',
  },
  en: {
    pupil: 'The user is a school pupil exploring career options. Use simple, age-appropriate language.',
    student: 'The user is a student, apprentice, or intern. Ask about study, training, and early hands-on experience.',
    early_career: 'The user is early in their career. Ask about real behaviors at work, in internships, or projects.',
    mid_career: 'The user has solid work experience. Ask about typical tasks, roles, and patterns at work.',
    senior: 'The user is experienced or in leadership. Ask about responsibility, impact, collaboration, and decisions.',
  },
};

/** Each coaching turn explores a distinct area so answers cover breadth, not the same angle three times. */
const QUESTION_FOCUS = {
  de: {
    1: {
      title: 'Tätigkeiten & Energie',
      instruction: `Frage nach konkreten Dingen, die der Nutzer gern macht oder in denen er/sie aufgeht — z. B. Hobbys, Aufgaben, Projekte, praktische oder kreative Beschäftigung (Schule, Ausbildung, Arbeit, Freizeit).
Nicht nach Wunschberufen oder abstrakten Interessen fragen.`,
      example: 'Was machst du in deiner Freizeit gern so lange, dass du die Zeit vergisst?',
    },
    2: {
      title: 'Menschen & Zusammenarbeit',
      instruction: `Frage nach dem Umgang mit anderen — z. B. in Gruppen, beim Helfen, Erklären, Moderieren, Unterstützen oder Führen.
Nicht erneut nach Einzelaktivitäten oder Hobbys fragen.`,
      example: 'Wenn ihr in einer Gruppe etwas erledigen müsst — welche Rolle übernimmst du meistens?',
    },
    3: {
      title: 'Denken & Herausforderungen',
      instruction: `Frage nach der Art von Problemen oder Aufgaben, die der Nutzer gern angeht — z. B. Rätsel lösen, planen, verbessern, etwas Neues gestalten, Fehler finden, strukturieren.
Nicht erneut nach sozialen Rollen oder Freizeitaktivitäten fragen.`,
      example: 'Welche Art von kniffligen Aufgaben packst du gern an?',
    },
  },
  en: {
    1: {
      title: 'Activities & energy',
      instruction: `Ask about concrete things the user enjoys doing or gets absorbed in — hobbies, tasks, projects, hands-on or creative work (school, training, job, free time).
Do not ask about dream jobs or abstract interests.`,
      example: 'What do you enjoy doing so much in your free time that you lose track of time?',
    },
    2: {
      title: 'People & collaboration',
      instruction: `Ask about how they work with others — in groups, helping, explaining, facilitating, supporting, or leading.
Do not ask again about solo activities or hobbies.`,
      example: 'When your group needs to get something done, what role do you usually take?',
    },
    3: {
      title: 'Thinking & challenges',
      instruction: `Ask about the kinds of problems or tasks they like tackling — solving puzzles, planning, improving, creating something new, finding errors, structuring things.
Do not ask again about social roles or leisure activities.`,
      example: 'What kinds of tricky tasks do you enjoy taking on?',
    },
  },
};

function resolveQuestionFocus(lang, questionNumber) {
  const bucket = QUESTION_FOCUS[String(lang || 'de').toLowerCase().startsWith('en') ? 'en' : 'de'];
  const key = Math.min(Math.max(Number(questionNumber) || 1, 1), COACHING_QUESTION_COUNT);
  return bucket[key] || bucket[1];
}

/**
 * Prior Q&A pairs for de-duplication — not passed as chat turns (that invites follow-ups).
 * @param {{ role: string, content: string }[]} messages
 * @returns {{ question: string, answer: string }[]}
 */
function extractPriorCoveragePairs(messages = []) {
  const pairs = [];
  let pendingQuestion = null;
  for (const msg of messages) {
    if (!msg || typeof msg.content !== 'string') continue;
    const text = msg.content.trim();
    if (!text) continue;
    if (msg.role === 'assistant') {
      pendingQuestion = text;
    } else if (msg.role === 'user' && pendingQuestion) {
      pairs.push({ question: pendingQuestion, answer: text });
      pendingQuestion = null;
    }
  }
  return pairs;
}

function formatPriorCoverageBlock(messages, lang) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const pairs = extractPriorCoveragePairs(messages);
  if (pairs.length === 0) return '';

  return pairs.map((pair, idx) => {
    const n = idx + 1;
    if (isDe) {
      return `${n}. Frage: „${pair.question}“
   Antwort (bereits abgedeckt — nicht erneut ansprechen): „${pair.answer}“`;
    }
    return `${n}. Question: "${pair.question}"
   Answer (already covered — do not revisit): "${pair.answer}"`;
  }).join('\n');
}

/**
 * Single user turn for question generation. Avoids multi-turn chat, which biases the model toward follow-ups.
 */
function buildQuestionTurnUserMessage({ lang, questionNumber, messages }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const focus = resolveQuestionFocus(lang, questionNumber);
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

Bereits abgedeckte Themenbereiche — nicht erneut als Fragestellung:
${coverage}

Formuliere jetzt Frage ${questionNumber} von ${COACHING_QUESTION_COUNT}:
1) ein kurzer, ermutigender Satz zur letzten Antwort (max. ein Satz, keine Rückfrage)
2) danach genau eine Frage zum Fokus „${focus.title}“
Das neue Thema muss sich deutlich vom vorherigen Bereich unterscheiden.`;
  }

  return `The user's latest answer (acknowledge it briefly and positively — do not go into detail):
"${lastPair?.answer || ''}"

Topic areas already covered — do not ask about them again:
${coverage}

Write question ${questionNumber} of ${COACHING_QUESTION_COUNT} as:
1) one short, encouraging sentence about their latest answer (max. one sentence, not a question)
2) then exactly one question for the focus "${focus.title}"
The new topic must differ clearly from the previous area.`;
}

function buildQuestionTaskRules({ lang, questionNumber, focus }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const example = focus.example;

  if (questionNumber <= 1) {
    if (isDe) {
      return `Deine Aufgabe jetzt:
- Stelle genau EINE kurze, konkrete Frage zu diesem Fokus.
- Antworte ausschließlich auf Deutsch.
- Halte die Frage einfach und verständlich.
- Keine Aufzählungen, keine Erklärungen, keine Begrüßung — nur die eine Frage.

Beispiel für den Stil (nicht wörtlich kopieren): „${example}“`;
    }
    return `Your task now:
- Ask exactly ONE short, concrete question about this focus area.
- Respond only in English.
- Keep the question simple and clear.
- No lists, no explanations, no greeting — only the single question.

Example for the tone (do not copy verbatim): "${example}"`;
  }

  if (isDe) {
    return `Deine Aufgabe jetzt:
- Reagiere zuerst mit genau EINEM kurzen, positiven oder motivierenden Satz auf die letzte Antwort (keine Rückfrage, keine Wiederholung von Details).
- Stelle danach genau EINE kurze, konkrete Frage zum neuen Fokus — das Thema muss sich deutlich vom vorherigen Bereich unterscheiden.
- Antworte ausschließlich auf Deutsch.
- Keine Aufzählungen, keine langen Erklärungen — höchstens ein Ermutigungssatz plus eine Frage.
- Keine Vertiefungsfrage zum vorherigen Thema (kein „Und beim …?“, kein „Was genau …?“ zum letzten Bereich).

Beispiel für den Stil (nicht wörtlich kopieren): „Das klingt richtig gut! ${example}“`;
  }

  return `Your task now:
- First, write exactly ONE short, positive or encouraging sentence about their latest answer (not a question, do not repeat details).
- Then ask exactly ONE short, concrete question about the new focus — the topic must differ clearly from the previous area.
- Respond only in English.
- No lists, no long explanations — at most one encouraging sentence plus one question.
- No drill-down on the previous topic (no "and when you …", no "what exactly …" about the last area).

Example for the tone (do not copy verbatim): "That sounds great! ${example}"`;
}

function buildQuestionSystemPrompt({ audience, lang, seniority, questionNumber, cvContext }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const hints = AUDIENCE_HINTS[isDe ? 'de' : 'en'][audience];
  const context = formatSeniorityContext(seniority, lang);
  const focus = resolveQuestionFocus(lang, questionNumber);
  const { formatCoachingCvContextBlock } = require('../services/profile/coachingCvContext');
  const cvBlock = formatCoachingCvContextBlock('workEnjoy', cvContext, lang);

  if (isDe) {
    const pupilExtra = audience === 'pupil'
      ? `
Zielgruppe: Schülerin/Schüler in der Berufsorientierung (einfache Sprache, ca. 9. Klasse).
Frage nach echtem Verhalten im Alltag — nicht nach Wünschen oder abstrakten Interessen.`
      : '';
    return `Du bist ein erfahrener Berufscoach.
${hints}${pupilExtra}

Kontext zum Nutzer:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Fokus dieser Frage (${questionNumber} von ${COACHING_QUESTION_COUNT}): ${focus.title}
${focus.instruction}

${buildQuestionTaskRules({ lang, questionNumber, focus })}`;
  }

  return `You are an experienced career coach.
${hints}

User context:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Focus for this question (${questionNumber} of ${COACHING_QUESTION_COUNT}): ${focus.title}
${focus.instruction}

${buildQuestionTaskRules({ lang, questionNumber, focus })}`;
}

function buildSummarySystemPrompt({ audience, lang, seniority, cvContext }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const hints = AUDIENCE_HINTS[isDe ? 'de' : 'en'][audience];
  const context = formatSeniorityContext(seniority, lang);
  const { formatCoachingCvContextBlock } = require('../services/profile/coachingCvContext');
  const cvBlock = formatCoachingCvContextBlock('workEnjoy', cvContext, lang);
  const cvSummaryRule = isDe
    ? 'Leite die Tätigkeiten ausschließlich aus den Chat-Antworten ab — kopiere keine CV-Inhalte.'
    : 'Derive activities exclusively from chat answers — do not copy CV content.';

  if (isDe) {
    return `Du bist ein erfahrener Berufscoach.
${hints}

Kontext zum Nutzer:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Analysiere die Antworten des Nutzers auf drei Coaching-Fragen und leite daraus genau ${ACTIVITY_COUNT} berufliche Tätigkeiten ab.

Regeln für die Tätigkeiten:
- ${cvSummaryRule}
- Formuliere alle Tätigkeiten ausschließlich auf Deutsch.
- Formuliere sie als kurze, allgemeine Aktivitäten (max. ${MAX_ACTIVITY_WORDS} Wörter pro Tätigkeit)
- Verwende einfache, klare Sprache passend zur Zielgruppe
- Keine konkreten Berufe oder Jobtitel
- Keine langen Erklärungen
- Fokus auf übertragbare Tätigkeiten (z. B. „Dinge organisieren“, „Probleme logisch lösen“)

Antworte ausschließlich als JSON-Objekt:
{"activities":["Tätigkeit 1","Tätigkeit 2","Tätigkeit 3","Tätigkeit 4","Tätigkeit 5"]}`;
  }

  return `You are an experienced career coach.
${hints}

User context:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Analyze the user's answers to three coaching questions and derive exactly ${ACTIVITY_COUNT} work activities.

Rules for activities:
- ${cvSummaryRule}
- Write all activities in English only.
- Phrase them as short, general activities (max ${MAX_ACTIVITY_WORDS} words each)
- Use clear language suited to the user's background
- No specific job titles or occupation names
- No long explanations
- Focus on transferable activities (e.g. "organizing things", "solving problems logically")

Reply only as a JSON object:
{"activities":["activity 1","activity 2","activity 3","activity 4","activity 5"]}`;
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
  return lines.join('\n');
}

module.exports = {
  COACHING_QUESTION_COUNT,
  ACTIVITY_COUNT,
  MAX_ACTIVITY_WORDS,
  AUDIENCE_HINTS,
  QUESTION_FOCUS,
  resolveWorkEnjoyCoachingAudience,
  formatSeniorityContext,
  resolveQuestionFocus,
  extractPriorCoveragePairs,
  formatPriorCoverageBlock,
  buildQuestionTurnUserMessage,
  buildQuestionSystemPrompt,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
};
