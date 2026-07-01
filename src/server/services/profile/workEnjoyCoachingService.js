const { callOpenAI } = require('../ai/callOpenAI');
const { normalizeCoachingCvContext, buildCvAwareFirstQuestionTurnHint } = require('./coachingCvContext');
const {
  COACHING_QUESTION_COUNT,
  ACTIVITY_COUNT,
  MAX_ACTIVITY_WORDS,
  resolveWorkEnjoyCoachingAudience,
  buildQuestionSystemPrompt,
  buildQuestionTurnUserMessage,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
} = require('../../prompts/workEnjoyCoachingPrompts');

const MAX_MESSAGE_LENGTH = 2000;
const MAX_MESSAGES = 12;

function normalizeCoachingLang(lang) {
  const base = String(lang || 'de').toLowerCase().split('-')[0];
  return base === 'en' ? 'en' : 'de';
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const out = [];
  for (const row of messages) {
    if (!row || typeof row !== 'object') continue;
    const role = String(row.role || '').trim();
    const content = String(row.content || '').trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!content || (role !== 'user' && role !== 'assistant')) continue;
    out.push({ role, content });
  }
  return out.slice(-MAX_MESSAGES);
}

function countUserMessages(messages) {
  return messages.filter((m) => m.role === 'user').length;
}

function countAssistantMessages(messages) {
  return messages.filter((m) => m.role === 'assistant').length;
}

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function normalizeActivity(text) {
  return String(text || '')
    .replace(/^[\s\-*•\d.)]+/, '')
    .replace(/[.!?]+$/, '')
    .trim();
}

function parseActivitiesFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];

  const tryJson = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      const list = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.activities)
          ? parsed.activities
          : [];
      return list.map(normalizeActivity).filter(Boolean);
    } catch {
      return [];
    }
  };

  let activities = tryJson(raw);
  if (activities.length === 0) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) activities = tryJson(match[0]);
  }
  if (activities.length === 0) {
    activities = raw
      .split(/\n+/)
      .map(normalizeActivity)
      .filter(Boolean);
  }

  const seen = new Set();
  const unique = [];
  for (const item of activities) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const words = wordCount(item);
    unique.push(words > MAX_ACTIVITY_WORDS ? item.split(/\s+/).slice(0, MAX_ACTIVITY_WORDS).join(' ') : item);
    if (unique.length >= ACTIVITY_COUNT) break;
  }
  return unique;
}

async function generateCoachingQuestion({ audience, lang, seniority, messages, questionNumber, cvContext, llm = callOpenAI }) {
  const system = buildQuestionSystemPrompt({ audience, lang, seniority, questionNumber, cvContext });
  const chatMessages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: buildQuestionTurnUserMessage({ lang, questionNumber, messages })
        + buildCvAwareFirstQuestionTurnHint(lang, cvContext),
    },
  ];
  const { text } = await llm({
    model: process.env.OPENAI_MODEL,
    temperature: 0.45,
    messages: chatMessages,
  });
  return formatCoachingTurnMessage(text, { allowPreamble: questionNumber > 1 });
}

/** Keep a single coaching question; optionally preserve a short preamble before it. */
function formatCoachingTurnMessage(raw, { allowPreamble = false } = {}) {
  let text = String(raw || '').trim();
  if (!text) return '';

  const stripPrefix = (value) => {
    const input = String(value || '').trim();
    const patterns = [
      /^\d+[\).:\-]\s+/,
      /^(?:Frage|Question)\s+\d+\s*[:.)-]\s+/i,
    ];
    for (const pattern of patterns) {
      const next = input.replace(pattern, '').trim();
      if (next !== input && next.length >= 8) return next;
    }
    return input;
  };

  const questionSegments = (text.match(/[^.!?\n]*\?/g) || []).map((segment) => segment.trim());
  if (!allowPreamble) {
    if (questionSegments.length === 1 && questionSegments[0].length < text.trim().length) {
      return stripPrefix(questionSegments[0]);
    }
    return extractSingleCoachingQuestion(text);
  }

  if (questionSegments.length <= 1) {
    return stripPrefix(text);
  }
  const lastQuestion = questionSegments[questionSegments.length - 1];
  let preamble = text.slice(0, text.lastIndexOf(lastQuestion)).trim();
  for (let i = 0; i < questionSegments.length - 1; i += 1) {
    preamble = preamble.replace(questionSegments[i], '').trim();
  }
  preamble = preamble.replace(/\s+/g, ' ').trim();
  const cleanedQuestion = stripPrefix(lastQuestion);
  return preamble ? `${preamble} ${cleanedQuestion}` : cleanedQuestion;
}

/** Keep a single coaching question even when the model returns multiples. */
function extractSingleCoachingQuestion(raw) {
  let text = String(raw || '').trim();
  if (!text) return '';

  const stripPrefix = (value) => {
    const input = String(value || '').trim();
    const patterns = [
      /^\d+[\).:\-]\s+/,
      /^(?:Frage|Question)\s+\d+\s*[:.)-]\s+/i,
    ];
    for (const pattern of patterns) {
      const next = input.replace(pattern, '').trim();
      if (next !== input && next.length >= 8) return next;
    }
    return input;
  };

  const lines = text.split(/\n+/).map((line) => stripPrefix(line.trim())).filter(Boolean);
  if (lines.length > 1) {
    const questionLine = lines.find((line) => line.includes('?')) || lines[0];
    text = questionLine;
  }

  const firstQuestionMark = text.indexOf('?');
  if (firstQuestionMark !== -1 && text.indexOf('?', firstQuestionMark + 1) !== -1) {
    text = text.slice(0, firstQuestionMark + 1).trim();
  }

  return stripPrefix(text);
}

async function generateActivitiesSummary({ audience, lang, seniority, messages, cvContext, llm = callOpenAI }) {
  const system = buildSummarySystemPrompt({ audience, lang, seniority, cvContext });
  const user = buildSummaryUserPrompt(messages, lang);
  const { text } = await llm({
    model: process.env.OPENAI_MODEL,
    temperature: 0.25,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const activities = parseActivitiesFromText(text);
  if (activities.length < 3) {
    throw new Error('LLM returned too few activities');
  }
  return activities.slice(0, ACTIVITY_COUNT);
}

/**
 * @param {{ seniority?: object, messages?: { role: string, content: string }[], lang?: string, llm?: Function }} input
 */
async function advanceWorkEnjoyCoaching(input = {}) {
  const seniority = input.seniority && typeof input.seniority === 'object' ? input.seniority : {};
  const lang = normalizeCoachingLang(input.lang);
  const llm = typeof input.llm === 'function' ? input.llm : callOpenAI;
  const messages = normalizeMessages(input.messages);
  const cvContext = normalizeCoachingCvContext(input.cvContext);
  const audience = resolveWorkEnjoyCoachingAudience(seniority);
  const userCount = countUserMessages(messages);
  const assistantCount = countAssistantMessages(messages);

  if (userCount > COACHING_QUESTION_COUNT) {
    throw new Error('Too many user messages');
  }

  if (userCount === COACHING_QUESTION_COUNT) {
    const activities = await generateActivitiesSummary({ audience, lang, seniority, messages, cvContext, llm });
    const summaryIntro = lang === 'de'
      ? 'Basierend auf deinen Antworten passen diese Tätigkeiten besonders gut zu dir:'
      : 'Based on your answers, these activities fit you well:';
    return {
      audience,
      phase: 'summary',
      complete: true,
      message: { role: 'assistant', content: summaryIntro },
      activities,
    };
  }

  const expectedQuestionNumber = userCount + 1;
  if (assistantCount > userCount) {
  // Client already has the latest assistant question waiting for an answer.
    throw new Error('Answer the current question before requesting another');
  }

  const question = await generateCoachingQuestion({
    audience,
    lang,
    seniority,
    messages,
    questionNumber: expectedQuestionNumber,
    cvContext,
    llm,
  });

  if (!question) {
    throw new Error('Empty coaching question from LLM');
  }

  return {
    audience,
    phase: 'question',
    complete: false,
    questionIndex: expectedQuestionNumber,
    message: { role: 'assistant', content: question },
  };
}

module.exports = {
  COACHING_QUESTION_COUNT,
  ACTIVITY_COUNT,
  resolveWorkEnjoyCoachingAudience,
  normalizeMessages,
  normalizeCoachingLang,
  formatCoachingTurnMessage,
  extractSingleCoachingQuestion,
  parseActivitiesFromText,
  countUserMessages,
  countAssistantMessages,
  advanceWorkEnjoyCoaching,
};
