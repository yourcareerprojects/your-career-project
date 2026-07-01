const {
  resolveWorkEnjoyCoachingAudience,
  formatSeniorityContext,
  AUDIENCE_HINTS,
  extractPriorCoveragePairs,
  formatPriorCoverageBlock,
} = require('./workEnjoyCoachingPrompts');
const { formatIndustryTaxonomyForPrompt } = require('../../constants/industries');

const COACHING_QUESTION_COUNT = 3;
const TOPIC_COUNT = 5;
const MAX_TOPIC_WORDS = 3;
const INDUSTRY_COUNT_MIN = 3;
const INDUSTRY_COUNT_MAX = 5;

/** Per-audience question angles — pupils get school-oriented wording; others get study/work context. */
const QUESTION_FOCUS_BY_AUDIENCE = {
  de: {
    pupil: {
      1: {
        title: 'Freiwillige Themen',
        instruction: `Frage nach Themen, mit denen sich der Nutzer freiwillig beschäftigt — z. B. Videos schauen, lesen, recherchieren, Podcasts hören.
Nicht nur nach Hobbys oder Sport fragen. Nicht nach Wunschberufen fragen.`,
        example: 'Über welche Themen schaust du freiwillig Videos oder liest du etwas?',
      },
      2: {
        title: 'Schule & Lernen',
        instruction: `Frage nach Themen oder Fächern in der Schule, die der Nutzer spannend findet — auch wenn er/sie darin nicht besonders gut ist.
Nicht erneut nach Freizeitmedien oder Hobbys fragen.`,
        example: 'Welche Themen findest du in der Schule spannend (auch wenn du nicht gut darin bist)?',
      },
      3: {
        title: 'Gespräche & Austausch',
        instruction: `Frage nach Themen, über die der Nutzer sich länger unterhalten kann, ohne dass es langweilig wird.
Nicht erneut nach Medienkonsum oder Schulfächern fragen.`,
        example: 'Worüber kannst du dich länger unterhalten, ohne dass es langweilig wird?',
      },
    },
    student: {
      1: {
        title: 'Freiwillige Themen',
        instruction: `Frage nach Themen, denen der Nutzer in der Freizeit freiwillig nachgeht — z. B. Podcasts, Videos, Artikel, Blogs oder Foren.
Nicht nur nach Hobbys oder Sport fragen. Nicht nach Wunschberufen fragen.`,
        example: 'Welche Themen verfolgst du in deiner Freizeit freiwillig — z. B. durch Podcasts, Videos oder Artikel?',
      },
      2: {
        title: 'Studium & Ausbildung',
        instruction: `Frage nach Modulen, Fächern oder Themen aus Studium oder Ausbildung, die spannend wirken — auch wenn Noten oder Aufwand manchmal nerven.
Nicht erneut nach Freizeitmedien oder Hobbys fragen.`,
        example: 'Welche Themen im Studium oder in der Ausbildung findest du spannend, auch wenn du nicht überall top bist?',
      },
      3: {
        title: 'Gespräche & Austausch',
        instruction: `Frage nach Themen, über die der Nutzer sich mit Kommiliton/innen, Kolleg/innen oder Freund/innen länger austauschen kann.
Nicht erneut nach Medienkonsum oder Studieninhalten fragen.`,
        example: 'Worüber könntest du dich mit anderen länger unterhalten, ohne dass es langweilig wird?',
      },
    },
    early_career: {
      1: {
        title: 'Freiwillige Themen',
        instruction: `Frage nach Themen, zu denen sich der Nutzer in der Freizeit freiwillig informiert — z. B. Podcasts, Fachartikel, Nachrichten, Dokus oder Online-Kurse.
Nicht nur nach Hobbys fragen. Nicht nach Wunschberufen oder Gehaltsvorstellungen fragen.`,
        example: 'Über welche Themen informierst du dich in deiner Freizeit freiwillig — z. B. durch Podcasts, Artikel oder Dokus?',
      },
      2: {
        title: 'Arbeit & Projekte',
        instruction: `Frage nach Aufgaben, Projekten oder Bereichen im Job, in Praktika oder in ersten Berufsjahre, die echte Neugier wecken — nicht nur Pflichtaufgaben.
Nicht erneut nach Freizeitmedien oder Hobbys fragen.`,
        example: 'Welche Themen oder Aufgaben in deinem Job oder in Projekten findest du besonders spannend?',
      },
      3: {
        title: 'Gespräche & Austausch',
        instruction: `Frage nach Themen, über die der Nutzer sich im Berufsalltag oder privat länger unterhalten kann — z. B. mit Kolleg/innen oder in Teams.
Nicht erneut nach Medienkonsum oder konkreten Arbeitsaufgaben fragen.`,
        example: 'Worüber kannst du dich beruflich oder privat länger unterhalten, ohne dass es langweilig wird?',
      },
    },
    mid_career: {
      1: {
        title: 'Freiwillige Themen',
        instruction: `Frage nach Themen, denen der Nutzer freiwillig und regelmäßig nachgeht — z. B. Fachpublikationen, Branchennews, Podcasts oder Weiterbildungen aus eigenem Antrieb.
Nicht nur nach Hobbys fragen. Nicht nach Wunschpositionen fragen. Nicht nach konkreten Arbeitstätigkeiten fragen.`,
        example: 'Welchen Themen oder Trends gehst du freiwillig nach — z. B. durch Fachartikel, Podcasts oder Weiterbildung?',
      },
      2: {
        title: 'Beruf & Fachgebiet',
        instruction: `Frage nach beruflichen Themen, Fachgebieten oder Aufgaben im Arbeitsalltag, die besonders interessieren — auch abseits der reinen Pflicht.
Nicht erneut nach Freizeitmedien oder Hobbys fragen.`,
        example: 'Welche fachlichen Themen oder Aufgaben in deinem Berufsalltag findest du besonders spannend?',
      },
      3: {
        title: 'Freizeit & Privatleben',
        instruction: `Frage nach Themen, die den Nutzer freiwillig in der Freizeit beschäftigen — unabhängig vom Beruf. Z. B. Hobbys, Ehrenamt, Vereine, persönliche Projekte oder Themen aus purem Interesse.
Explizit nicht nach beruflicher Weiterbildung, Branchennews, Fachmedien oder Arbeitsthemen fragen.`,
        example: 'Womit beschäftigst du dich in deiner Freizeit freiwillig — abseits vom Job? Z. B. Hobbys, Ehrenamt oder persönliche Interessen?',
      },
    },
    senior: {
      1: {
        title: 'Freiwillige Themen',
        instruction: `Frage nach Themen, denen der Nutzer freiwillig folgt — z. B. Branchentrends, Strategie, Gesellschaft oder Fachentwicklungen über Medien und Netzwerke.
Nicht nach Wunschpositionen oder Gehalt fragen. Nicht nach konkreten Arbeitstätigkeiten fragen.`,
        example: 'Welchen Themen oder Entwicklungen folgst du freiwillig — z. B. in Fachmedien, Podcasts oder Netzwerken?',
      },
      2: {
        title: 'Verantwortung & Wirkung',
        instruction: `Frage nach Themen, Entscheidungen oder Herausforderungen in Führungs- oder Expertenrollen, die besonders fesseln — z. B. Strategie, Wirkung, Zusammenarbeit, Veränderung.
Nicht erneut nach Freizeitmedien oder Hobbys fragen.`,
        example: 'Welche Themen oder Herausforderungen in deiner Verantwortung findest du besonders spannend?',
      },
      3: {
        title: 'Freizeit & Privatleben',
        instruction: `Frage nach Themen, die den Nutzer freiwillig außerhalb der Arbeit beschäftigen — z. B. Hobbys, Ehrenamt, Vereine, persönliche Projekte, Reisen oder Themen aus purem Interesse.
Explizit nicht nach Branchentrends, Strategie, Fachmedien oder beruflicher Weiterbildung fragen.`,
        example: 'Was beschäftigt dich freiwillig außerhalb der Arbeit — z. B. Hobbys, Ehrenamt oder persönliche Interessen?',
      },
    },
  },
  en: {
    pupil: {
      1: {
        title: 'Voluntary topics',
        instruction: `Ask about topics the user voluntarily engages with — e.g. watching videos, reading, researching, listening to podcasts.
Do not only ask about hobbies or sports. Do not ask about dream jobs.`,
        example: 'What topics do you voluntarily watch videos about or read about?',
      },
      2: {
        title: 'School & learning',
        instruction: `Ask about school subjects the user finds exciting — even if they are not especially good at them.
Do not ask again about leisure media or hobbies.`,
        example: 'Which subjects at school do you find exciting (even if you are not good at them)?',
      },
      3: {
        title: 'Conversations',
        instruction: `Ask about topics the user can talk about at length without getting bored.
Do not ask again about media consumption or school subjects.`,
        example: 'What could you talk about for a long time without getting bored?',
      },
    },
    student: {
      1: {
        title: 'Voluntary topics',
        instruction: `Ask about topics the user voluntarily follows in their free time — e.g. podcasts, videos, articles, blogs, or forums.
Do not only ask about hobbies or sports. Do not ask about dream jobs.`,
        example: 'What topics do you voluntarily follow in your free time — e.g. through podcasts, videos, or articles?',
      },
      2: {
        title: 'Study & training',
        instruction: `Ask about modules, subjects, or topics from university or training that feel exciting — even when grades or workload are tough.
Do not ask again about leisure media or hobbies.`,
        example: 'Which topics in your studies or training do you find exciting, even if you are not top everywhere?',
      },
      3: {
        title: 'Conversations',
        instruction: `Ask about topics the user can discuss at length with classmates, colleagues, or friends.
Do not ask again about media habits or coursework.`,
        example: 'What could you talk about with others for a long time without getting bored?',
      },
    },
    early_career: {
      1: {
        title: 'Voluntary topics',
        instruction: `Ask about topics the user voluntarily explores in their free time — e.g. podcasts, articles, news, documentaries, or online courses.
Do not only ask about hobbies. Do not ask about dream jobs or salary expectations.`,
        example: 'What topics do you voluntarily explore in your free time — e.g. through podcasts, articles, or documentaries?',
      },
      2: {
        title: 'Work & projects',
        instruction: `Ask about tasks, projects, or areas at work or in early internships that spark real curiosity — not just mandatory duties.
Do not ask again about leisure media or hobbies.`,
        example: 'Which topics or tasks in your job or projects do you find especially interesting?',
      },
      3: {
        title: 'Conversations',
        instruction: `Ask about topics the user can discuss at length at work or in private life — e.g. with colleagues or in teams.
Do not ask again about media consumption or specific work tasks.`,
        example: 'What can you talk about at work or in private life for a long time without getting bored?',
      },
    },
    mid_career: {
      1: {
        title: 'Voluntary topics',
        instruction: `Ask about topics the user voluntarily and regularly follows — e.g. trade publications, industry news, podcasts, or self-driven learning.
Do not only ask about hobbies. Do not ask about dream positions. Do not ask about specific work tasks.`,
        example: 'What topics or trends do you voluntarily follow — e.g. through trade articles, podcasts, or training?',
      },
      2: {
        title: 'Work & expertise',
        instruction: `Ask about professional topics, domains, or tasks in daily work that are especially interesting — beyond pure obligation.
Do not ask again about leisure media or hobbies.`,
        example: 'Which professional topics or tasks in your daily work do you find especially interesting?',
      },
      3: {
        title: 'Leisure & personal life',
        instruction: `Ask about topics the user voluntarily engages with in their free time — independent of work. E.g. hobbies, volunteering, clubs, personal projects, or topics pursued purely for interest.
Do not ask about professional development, industry news, trade media, or work topics.`,
        example: 'What do you voluntarily spend time on in your free time — outside of work? E.g. hobbies, volunteering, or personal interests?',
      },
    },
    senior: {
      1: {
        title: 'Voluntary topics',
        instruction: `Ask about topics the user voluntarily follows — e.g. industry trends, strategy, society, or domain developments via media and networks.
Do not ask about dream positions or compensation. Do not ask about specific work tasks.`,
        example: 'What topics or developments do you voluntarily follow — e.g. in trade media, podcasts, or networks?',
      },
      2: {
        title: 'Responsibility & impact',
        instruction: `Ask about topics, decisions, or challenges in leadership or expert roles that are especially engaging — e.g. strategy, impact, collaboration, change.
Do not ask again about leisure media or hobbies.`,
        example: 'Which topics or challenges in your area of responsibility do you find especially engaging?',
      },
      3: {
        title: 'Leisure & personal life',
        instruction: `Ask about topics the user voluntarily pursues outside work — e.g. hobbies, volunteering, clubs, personal projects, travel, or topics followed purely for interest.
Do not ask about industry trends, strategy, trade media, or professional development.`,
        example: 'What do you voluntarily engage with outside work — e.g. hobbies, volunteering, or personal interests?',
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

function questionStyleHint(lang, audience, questionNumber) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  if (audience === 'pupil') {
    return isDe
      ? '- Halte die Frage einfach und verständlich.'
      : '- Keep the question simple and clear.';
  }
  return isDe
    ? '- Halte die Frage kurz, klar und passend zum Berufsstand des Nutzers.'
    : '- Keep the question short, clear, and suited to the user\'s career stage.';
}

function audienceCoachingHint(lang, audience) {
  if (audience !== 'mid_career' && audience !== 'senior') return '';
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  return isDe
    ? '\nEine der drei Fragen zielt bewusst auf Interessen außerhalb des Berufs (Freizeit, Privatleben); die übrigen Fragen dürfen berufliche Themen abfragen.'
    : '\nOne of the three questions deliberately explores interests outside work (leisure, private life); the other questions may cover professional topics.';
}

function audienceSummaryHint(lang, audience) {
  if (audience !== 'mid_career' && audience !== 'senior') return '';
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  return isDe
    ? '\nBerücksichtige auch Antworten aus Freizeit und Privatleben — nicht nur berufliche Themen.'
    : '\nInclude insights from leisure and private-life answers — not only professional topics.';
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

function buildQuestionTaskRules({ lang, questionNumber, focus, audience = 'pupil' }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const example = focus.example;
  const styleHint = questionStyleHint(lang, audience, questionNumber);

  if (questionNumber <= 1) {
    if (isDe) {
      return `Deine Aufgabe jetzt:
- Stelle genau EINE kurze, einfache Frage zu diesem Fokus.
- Frage nach echtem Interesse im Alltag — nicht nur nach Hobbys.
- Antworte ausschließlich auf Deutsch.
${styleHint}
- Keine Aufzählungen, keine Erklärungen, keine Begrüßung — nur die eine Frage.

Beispiel für den Stil (nicht wörtlich kopieren): „${example}“`;
    }
    return `Your task now:
- Ask exactly ONE short, simple question about this focus area.
- Ask about real everyday interest — not just hobbies.
- Respond only in English.
${styleHint}
- No lists, no explanations, no greeting — only the single question.

Example for the tone (do not copy verbatim): "${example}"`;
  }

  if (isDe) {
    return `Deine Aufgabe jetzt:
- Reagiere zuerst mit genau EINEM kurzen, positiven oder motivierenden Satz auf die letzte Antwort (keine Rückfrage, keine Wiederholung von Details).
- Stelle danach genau EINE kurze, konkrete Frage zum neuen Fokus — das Thema muss sich deutlich vom vorherigen Bereich unterscheiden.
- Frage nach echtem Interesse im Alltag — nicht nur nach Hobbys.
- Antworte ausschließlich auf Deutsch.
- Keine Aufzählungen, keine langen Erklärungen — höchstens ein Ermutigungssatz plus eine Frage.
- Keine Vertiefungsfrage zum vorherigen Thema (kein „Und beim …?“, kein „Was genau …?“ zum letzten Bereich).

Beispiel für den Stil (nicht wörtlich kopieren): „Das klingt spannend! ${example}“`;
  }

  return `Your task now:
- First, write exactly ONE short, positive or encouraging sentence about their latest answer (not a question, do not repeat details).
- Then ask exactly ONE short, concrete question about the new focus — the topic must differ clearly from the previous area.
- Respond only in English.
- No lists, no long explanations — at most one encouraging sentence plus one question.
- No drill-down on the previous topic (no "and when you …", no "what exactly …" about the last area).

Example for the tone (do not copy verbatim): "That sounds interesting! ${example}"`;
}

function buildQuestionSystemPrompt({ audience, lang, seniority, questionNumber, cvContext }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const hints = AUDIENCE_HINTS[isDe ? 'de' : 'en'][audience];
  const context = formatSeniorityContext(seniority, lang);
  const focus = resolveQuestionFocus(lang, questionNumber, audience);
  const { formatCoachingCvContextBlock } = require('../services/profile/coachingCvContext');
  const cvBlock = formatCoachingCvContextBlock('topics', cvContext, lang);

  if (isDe) {
    const pupilExtra = audience === 'pupil'
      ? `
Zielgruppe: Schülerin/Schüler in der Berufsorientierung (einfache Sprache, ca. 9. Klasse).
Frage nach echtem Interesse im Alltag — nicht nur nach Hobbys und nicht nach Wunschberufen.`
      : `
Frage nach echtem Interesse im Alltag — nicht nur nach Hobbys. Formuliere passend zum Berufsstand des Nutzers (keine Schulfragen an Berufstätige).${audienceCoachingHint(lang, audience)}`;
    return `${coachRoleLabel(lang, audience)}
${hints}${pupilExtra}

Deine Aufgabe: Stelle nacheinander ${COACHING_QUESTION_COUNT} kurze, einfache Fragen, um herauszufinden, welche Themen den Nutzer wirklich interessieren.

Kontext zum Nutzer:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Fokus dieser Frage (${questionNumber} von ${COACHING_QUESTION_COUNT}): ${focus.title}
${focus.instruction}

${buildQuestionTaskRules({ lang, questionNumber, focus, audience })}`;
  }

  const pupilExtraEn = audience === 'pupil'
    ? '\nAsk about real everyday interest — not just hobbies and not dream jobs.'
    : '\nAsk about real everyday interest — not just hobbies. Match wording to the user\'s career stage (no school questions for employed adults).'
    + audienceCoachingHint(lang, audience);

  return `${coachRoleLabel(lang, audience)}
${hints}${pupilExtraEn}

Your task: ask ${COACHING_QUESTION_COUNT} short, simple questions in sequence to find out which topics truly interest the user.

User context:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Focus for this question (${questionNumber} of ${COACHING_QUESTION_COUNT}): ${focus.title}
${focus.instruction}

${buildQuestionTaskRules({ lang, questionNumber, focus, audience })}`;
}

function extractUserAnswerTexts(messages = []) {
  return extractPriorCoveragePairs(messages)
    .map((pair) => String(pair.answer || '').trim())
    .filter(Boolean);
}

function buildInterestTopicSynthesisRules(lang) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  if (isDe) {
    return `1. Die wichtigsten Interessen (genau ${TOPIC_COUNT} Punkte)

Deine Aufgabe ist Synthese über alle drei Antworten hinweg — keine Wiedergabe der Antworten:
- Erkenne übergreifende Interessen-Muster; nicht ein Punkt pro Antwort und keine Aufzählung dessen, was genannt wurde
- Übernimm keine Formulierungen, Schlagwörter, Hobby-Namen, Fächer, Medien oder Aktivitäten aus den Antworten wörtlich oder leicht umformuliert
- Formuliere eine Ebene abstrakter: Was zieht die Person an? Was will sie verstehen, erleben, gestalten oder herausfinden?
- Bei kurzen Antworten: vorsichtig ableiten — aber in allgemeine Interessen-Stichworte übersetzen, nicht die kurzen Antworten spiegeln

Regeln:
- kurze Stichworte (max. ${MAX_TOPIC_WORDS} Wörter pro Punkt)
- jeder Punkt ein anderer Aspekt — keine Wiederholung untereinander
- keine Berufe, keine Branchen (Branchen kommen separat unter industries)
- möglichst konkret in der Abstraktion (z. B. „Technik verstehen“ statt „Technik“)

Stil-Beispiele für gute Abstraktion (nur als Orientierung — nicht übernehmen, wenn sie nicht passen):
- „Fußball und Minecraft“ → „Wettbewerb verfolgen“, „Welten gestalten“
- „Weltraum-Videos“ → „Ferne Welten erkunden“

Verboten: die genannten Wörter aus den Antworten als Interessen-Punkte zurückgeben (z. B. „Fußball“, „Minecraft“, „Biologie“).`;
  }

  return `1. Main interest topics (exactly ${TOPIC_COUNT} items)

Your job is synthesis across all three answers — not replaying what was said:
- Find cross-cutting interest patterns; not one item per answer and not a list of what they named
- Do not copy or lightly rephrase wording, hobby names, school subjects, media, or activities from the answers
- Go one level more abstract: what draws them in? What do they want to understand, experience, create, or explore?
- With short answers: infer carefully — but translate into general interest keywords, do not mirror the short replies

Rules:
- short keywords (max ${MAX_TOPIC_WORDS} words each)
- each item a different angle — no duplicates
- no job titles, no industries (industries go separately under industries)
- concrete abstraction (e.g. "understanding technology" not "technology")

Style examples for good abstraction (orientation only — do not copy unless they fit):
- "football and Minecraft" → "following competition", "shaping worlds"
- "space videos" → "exploring distant worlds"

Forbidden: returning the exact words from the answers as interest items (e.g. "football", "Minecraft", "biology").`;
}

function buildIndustryDerivationRules(lang) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const canonicalList = formatIndustryTaxonomyForPrompt(lang);
  if (isDe) {
    return `2. Passende Branchen oder Bereiche (${INDUSTRY_COUNT_MIN}–${INDUSTRY_COUNT_MAX} Punkte)
- Wähle ausschließlich aus dieser kanonischen Liste (exakte Schreibweise): ${canonicalList}
- Leite Branchen aus den abgeleiteten Interessen und dem Gesamtbild der Antworten ab
- Wiederhole keine Interessen-Stichworte und keine Wörter aus den Antworten wörtlich
- keine konkreten Berufe oder Firmen
- jede Branche muss klar zu den abgeleiteten Interessen passen
- vermeide zu allgemeine Begriffe wie „alles mit Menschen“ oder „kreative Sachen“`;
  }

  return `2. Matching industries or fields (${INDUSTRY_COUNT_MIN}–${INDUSTRY_COUNT_MAX} items)
- Choose only from this canonical list (exact spelling): ${canonicalList}
- Derive industries from the synthesized interests and the overall picture of the answers
- Do not repeat interest keywords or words from the answers verbatim
- no specific jobs or companies
- each industry must clearly match the derived interests
- avoid vague terms like "anything with people" or "creative stuff"`;
}

function buildSummarySystemPrompt({ audience, lang, seniority, cvContext }) {
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const hints = AUDIENCE_HINTS[isDe ? 'de' : 'en'][audience];
  const context = formatSeniorityContext(seniority, lang);
  const { formatCoachingCvContextBlock } = require('../services/profile/coachingCvContext');
  const cvBlock = formatCoachingCvContextBlock('topics', cvContext, lang);
  const cvSummaryRule = isDe
    ? 'Leite interestTopics und industries ausschließlich aus den Chat-Antworten ab — kopiere keine CV-Inhalte.'
    : 'Derive interestTopics and industries exclusively from chat answers — do not copy CV content.';

  if (isDe) {
    return `${coachRoleLabel(lang, audience)}
${hints}${audienceSummaryHint(lang, audience)}

Kontext zum Nutzer:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Analysiere die Antworten des Nutzers auf drei Coaching-Fragen und leite daraus ab:

${buildInterestTopicSynthesisRules(lang)}

${buildIndustryDerivationRules(lang)}

- ${cvSummaryRule}

Ziel: Der Nutzer soll erkennen, was ihn wirklich interessiert — als verdichtete Einsicht, nicht als Wiederholung seiner Worte.

Antworte ausschließlich als JSON-Objekt:
{"interestTopics":["Thema 1","Thema 2","Thema 3","Thema 4","Thema 5"],"industries":["Branche 1","Branche 2","Branche 3"]}`;
  }

  return `${coachRoleLabel(lang, audience)}
${hints}${audienceSummaryHint(lang, audience)}

User context:
${context}
${cvBlock ? `\n${cvBlock}\n` : ''}
Analyze the user's answers to three coaching questions and derive:

${buildInterestTopicSynthesisRules(lang)}

${buildIndustryDerivationRules(lang)}

- ${cvSummaryRule}

Goal: the user should recognize what truly interests them — as a distilled insight, not a repeat of their wording.

Reply only as a JSON object:
{"interestTopics":["topic 1","topic 2","topic 3","topic 4","topic 5"],"industries":["industry 1","industry 2","industry 3"]}`;
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

Leite interestTopics und industries durch Synthese ab — kopiere die Antworten nicht und liste sie nicht auf.`;
  }
  return `${transcript}

Derive interestTopics and industries by synthesis — do not copy or list the answers.`;
}

module.exports = {
  COACHING_QUESTION_COUNT,
  TOPIC_COUNT,
  MAX_TOPIC_WORDS,
  INDUSTRY_COUNT_MIN,
  INDUSTRY_COUNT_MAX,
  QUESTION_FOCUS_BY_AUDIENCE,
  resolveWorkEnjoyCoachingAudience,
  resolveQuestionFocus,
  buildQuestionTurnUserMessage,
  buildQuestionSystemPrompt,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
  extractUserAnswerTexts,
};
