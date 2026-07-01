const { callOpenAI } = require('../ai/callOpenAI');
const { normalizeCoachingCvContext, buildCvAwareFirstQuestionTurnHint } = require('./coachingCvContext');
const {
  COACHING_QUESTION_COUNT,
  WORK_STYLE_COUNT,
  MAX_WORK_STYLE_WORDS,
  WORK_ENVIRONMENT_MIN,
  WORK_ENVIRONMENT_MAX,
  MAX_ENVIRONMENT_WORDS,
  resolveWorkEnjoyCoachingAudience,
  buildQuestionSystemPrompt,
  buildQuestionTurnUserMessage,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
} = require('../../prompts/workEnvironmentCoachingPrompts');
const {
  normalizeMessages,
  normalizeCoachingLang,
  formatCoachingTurnMessage,
  countUserMessages,
  countAssistantMessages,
} = require('./workEnjoyCoachingService');

function wordCount(text) {
  return String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function normalizeListItem(text) {
  return String(text || '')
    .replace(/^[\s\-*•\d.)]+/, '')
    .replace(/[.!?]+$/, '')
    .trim();
}

function trimToMaxWords(text, maxWords) {
  const words = wordCount(text);
  if (words <= maxWords) return text;
  return String(text).split(/\s+/).slice(0, maxWords).join(' ');
}

function dedupeListItems(items, maxItems, maxWords) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    const normalized = trimToMaxWords(normalizeListItem(item), maxWords);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(normalized);
    if (unique.length >= maxItems) break;
  }
  return unique;
}

function normalizeWorkEnvironmentResult({ workStyles = [], workEnvironments = [] } = {}) {
  return {
    workStyles: dedupeListItems(workStyles, WORK_STYLE_COUNT, MAX_WORK_STYLE_WORDS),
    workEnvironments: dedupeListItems(workEnvironments, WORK_ENVIRONMENT_MAX, MAX_ENVIRONMENT_WORDS),
  };
}

function parseWorkEnvironmentSummary(text) {
  const raw = String(text || '').trim();
  if (!raw) return { workStyles: [], workEnvironments: [] };

  const tryJson = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      const workStyles = Array.isArray(parsed?.workStyles) ? parsed.workStyles : [];
      const workEnvironments = Array.isArray(parsed?.workEnvironments)
        ? parsed.workEnvironments
        : Array.isArray(parsed?.environments)
          ? parsed.environments
          : [];
      return {
        workStyles: workStyles.map(normalizeListItem).filter(Boolean),
        workEnvironments: workEnvironments.map(normalizeListItem).filter(Boolean),
      };
    } catch {
      return { workStyles: [], workEnvironments: [] };
    }
  };

  let result = tryJson(raw);
  if (result.workStyles.length === 0 && result.workEnvironments.length === 0) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) result = tryJson(match[0]);
  }

  if (result.workStyles.length > 0 || result.workEnvironments.length > 0) {
    return normalizeWorkEnvironmentResult(result);
  }

  const blocks = raw.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length >= 2) {
    const parseBlock = (block) => block
      .split(/\n+/)
      .map(normalizeListItem)
      .filter(Boolean);
    return normalizeWorkEnvironmentResult({
      workStyles: parseBlock(blocks[0]),
      workEnvironments: parseBlock(blocks[1]),
    });
  }

  const lines = raw.split(/\n+/).map(normalizeListItem).filter(Boolean);
  return normalizeWorkEnvironmentResult({
    workStyles: lines.slice(0, WORK_STYLE_COUNT),
    workEnvironments: lines.slice(WORK_STYLE_COUNT),
  });
}

function formatWorkEnvironmentAsText({ workStyles = [], workEnvironments = [] } = {}) {
  const styleLines = workStyles.map((item) => String(item || '').trim()).filter(Boolean);
  const environmentLines = workEnvironments.map((item) => String(item || '').trim()).filter(Boolean);
  if (styleLines.length === 0 && environmentLines.length === 0) return '';
  if (environmentLines.length === 0) return styleLines.join('\n');
  return `${styleLines.join('\n')}\n\n${environmentLines.join('\n')}`;
}

async function generateCoachingQuestion({ audience, lang, seniority, messages, questionNumber, cvContext, llm = callOpenAI }) {
  const system = buildQuestionSystemPrompt({ audience, lang, seniority, questionNumber, cvContext });
  const chatMessages = [
    { role: 'system', content: system },
    {
      role: 'user',
      content: buildQuestionTurnUserMessage({ lang, questionNumber, messages, audience })
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

async function generateWorkEnvironmentSummary({ audience, lang, seniority, messages, cvContext, llm = callOpenAI }) {
  const system = buildSummarySystemPrompt({ audience, lang, seniority, cvContext });
  const user = buildSummaryUserPrompt(messages, lang);
  const { text } = await llm({
    model: process.env.OPENAI_MODEL,
    temperature: 0.35,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const parsed = parseWorkEnvironmentSummary(text);
  if (parsed.workStyles.length < 3) {
    throw new Error('LLM returned too few work styles');
  }
  if (parsed.workEnvironments.length < WORK_ENVIRONMENT_MIN) {
    throw new Error('LLM returned too few work environments');
  }
  return parsed;
}

/**
 * @param {{ seniority?: object, messages?: { role: string, content: string }[], lang?: string, llm?: Function }} input
 */
async function advanceWorkEnvironmentCoaching(input = {}) {
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
    const { workStyles, workEnvironments } = await generateWorkEnvironmentSummary({
      audience, lang, seniority, messages, cvContext, llm,
    });
    const summaryIntro = lang === 'de'
      ? 'Basierend auf deinen Antworten passt diese Arbeitsweise und dieses Umfeld besonders gut zu dir:'
      : 'Based on your answers, this way of working and environment suit you especially well:';
    return {
      audience,
      phase: 'summary',
      complete: true,
      message: { role: 'assistant', content: summaryIntro },
      workStyles,
      workEnvironments,
    };
  }

  const expectedQuestionNumber = userCount + 1;
  if (assistantCount > userCount) {
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
  WORK_STYLE_COUNT,
  WORK_ENVIRONMENT_MIN,
  WORK_ENVIRONMENT_MAX,
  resolveWorkEnjoyCoachingAudience,
  normalizeCoachingLang,
  parseWorkEnvironmentSummary,
  normalizeWorkEnvironmentResult,
  formatWorkEnvironmentAsText,
  advanceWorkEnvironmentCoaching,
};
