const { callOpenAI } = require('../ai/callOpenAI');
const { normalizeCoachingCvContext, buildCvAwareFirstQuestionTurnHint } = require('./coachingCvContext');
const {
  COACHING_QUESTION_COUNT,
  CAREER_GOAL_COUNT,
  MAX_CAREER_GOAL_WORDS,
  PRIORITY_COUNT,
  MAX_PRIORITY_WORDS,
  resolveWorkEnjoyCoachingAudience,
  buildQuestionSystemPrompt,
  buildQuestionTurnUserMessage,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
} = require('../../prompts/workingLifeAchievementCoachingPrompts');
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

function normalizeWorkingLifeAchievementResult({ careerGoals = [], priorities = [] } = {}) {
  return {
    careerGoals: dedupeListItems(careerGoals, CAREER_GOAL_COUNT, MAX_CAREER_GOAL_WORDS),
    priorities: dedupeListItems(priorities, PRIORITY_COUNT, MAX_PRIORITY_WORDS),
  };
}

function parseWorkingLifeAchievementSummary(text) {
  const raw = String(text || '').trim();
  if (!raw) return { careerGoals: [], priorities: [] };

  const tryJson = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      const careerGoals = Array.isArray(parsed?.careerGoals)
        ? parsed.careerGoals
        : Array.isArray(parsed?.goals)
          ? parsed.goals
          : [];
      const priorities = Array.isArray(parsed?.priorities)
        ? parsed.priorities
        : Array.isArray(parsed?.whatMatters)
          ? parsed.whatMatters
          : [];
      return {
        careerGoals: careerGoals.map(normalizeListItem).filter(Boolean),
        priorities: priorities.map(normalizeListItem).filter(Boolean),
      };
    } catch {
      return { careerGoals: [], priorities: [] };
    }
  };

  let result = tryJson(raw);
  if (result.careerGoals.length === 0 && result.priorities.length === 0) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) result = tryJson(match[0]);
  }

  if (result.careerGoals.length > 0 || result.priorities.length > 0) {
    return normalizeWorkingLifeAchievementResult(result);
  }

  const blocks = raw.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length >= 2) {
    const parseBlock = (block) => block
      .split(/\n+/)
      .map(normalizeListItem)
      .filter(Boolean);
    return normalizeWorkingLifeAchievementResult({
      careerGoals: parseBlock(blocks[0]),
      priorities: parseBlock(blocks[1]),
    });
  }

  const lines = raw.split(/\n+/).map(normalizeListItem).filter(Boolean);
  return normalizeWorkingLifeAchievementResult({
    careerGoals: lines.slice(0, CAREER_GOAL_COUNT),
    priorities: lines.slice(CAREER_GOAL_COUNT),
  });
}

function formatWorkingLifeAchievementAsText({ careerGoals = [], priorities = [] } = {}) {
  const goalLines = careerGoals.map((item) => String(item || '').trim()).filter(Boolean);
  const priorityLines = priorities.map((item) => String(item || '').trim()).filter(Boolean);
  if (goalLines.length === 0 && priorityLines.length === 0) return '';
  if (priorityLines.length === 0) return goalLines.join('\n');
  return `${goalLines.join('\n')}\n\n${priorityLines.join('\n')}`;
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
  return formatCoachingTurnMessage(text, { allowPreamble: false });
}

async function generateWorkingLifeAchievementSummary({ audience, lang, seniority, messages, cvContext, llm = callOpenAI }) {
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
  const parsed = parseWorkingLifeAchievementSummary(text);
  if (parsed.careerGoals.length < 3) {
    throw new Error('LLM returned too few career goals');
  }
  if (parsed.priorities.length < PRIORITY_COUNT) {
    throw new Error('LLM returned too few priorities');
  }
  return parsed;
}

/**
 * @param {{ seniority?: object, messages?: { role: string, content: string }[], lang?: string, llm?: Function }} input
 */
async function advanceWorkingLifeAchievementCoaching(input = {}) {
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
    const { careerGoals, priorities } = await generateWorkingLifeAchievementSummary({
      audience, lang, seniority, messages, cvContext, llm,
    });
    const summaryIntro = lang === 'de'
      ? 'Basierend auf deinen Antworten sind das deine wichtigsten Ziele im Berufsleben:'
      : 'Based on your answers, these are your key career goals:';
    return {
      audience,
      phase: 'summary',
      complete: true,
      message: { role: 'assistant', content: summaryIntro },
      careerGoals,
      priorities,
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
  CAREER_GOAL_COUNT,
  PRIORITY_COUNT,
  resolveWorkEnjoyCoachingAudience,
  normalizeCoachingLang,
  parseWorkingLifeAchievementSummary,
  normalizeWorkingLifeAchievementResult,
  formatWorkingLifeAchievementAsText,
  advanceWorkingLifeAchievementCoaching,
};
