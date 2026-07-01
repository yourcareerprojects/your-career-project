const { callOpenAI } = require('../ai/callOpenAI');
const { normalizeCoachingCvContext, buildCvAwareFirstQuestionTurnHint } = require('./coachingCvContext');
const {
  COACHING_QUESTION_COUNT,
  TOPIC_COUNT,
  MAX_TOPIC_WORDS,
  INDUSTRY_COUNT_MIN,
  INDUSTRY_COUNT_MAX,
  resolveWorkEnjoyCoachingAudience,
  buildQuestionSystemPrompt,
  buildQuestionTurnUserMessage,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
  extractUserAnswerTexts,
} = require('../../prompts/topicsIndustriesCoachingPrompts');
const {
  normalizeMessages,
  normalizeCoachingLang,
  formatCoachingTurnMessage,
  countUserMessages,
  countAssistantMessages,
} = require('./workEnjoyCoachingService');
const {
  normalizeIndustryDomains,
  inferIndustriesFromText,
  formatIndustryTaxonomyForPrompt,
} = require('../../../constants/industries');

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

function normalizeTopicsIndustriesResult({ interestTopics = [], industries = [] } = {}) {
  return {
    interestTopics: dedupeListItems(interestTopics, TOPIC_COUNT, MAX_TOPIC_WORDS),
    industries: normalizeIndustryDomains(industries, { keepUnknown: false, maxItems: INDUSTRY_COUNT_MAX }),
  };
}

function parseTopicsIndustriesSummary(text) {
  const raw = String(text || '').trim();
  if (!raw) return { interestTopics: [], industries: [] };

  const tryJson = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      const interestTopics = Array.isArray(parsed?.interestTopics)
        ? parsed.interestTopics
        : Array.isArray(parsed?.topics)
          ? parsed.topics
          : [];
      const industries = Array.isArray(parsed?.industries) ? parsed.industries : [];
      return {
        interestTopics: interestTopics.map(normalizeListItem).filter(Boolean),
        industries: industries.map(normalizeListItem).filter(Boolean),
      };
    } catch {
      return { interestTopics: [], industries: [] };
    }
  };

  let result = tryJson(raw);
  if (result.interestTopics.length === 0 && result.industries.length === 0) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) result = tryJson(match[0]);
  }

  if (result.interestTopics.length > 0 || result.industries.length > 0) {
    return normalizeTopicsIndustriesResult(result);
  }

  const blocks = raw.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length >= 2) {
    const parseBlock = (block) => block
      .split(/\n+/)
      .map(normalizeListItem)
      .filter(Boolean);
    return normalizeTopicsIndustriesResult({
      interestTopics: parseBlock(blocks[0]),
      industries: parseBlock(blocks[1]),
    });
  }

  const lines = raw.split(/\n+/).map(normalizeListItem).filter(Boolean);
  return normalizeTopicsIndustriesResult({
    interestTopics: lines.slice(0, TOPIC_COUNT),
    industries: lines.slice(TOPIC_COUNT),
  });
}

function formatTopicsIndustriesAsText({ interestTopics = [], industries = [] } = {}) {
  const topicLines = interestTopics.map((item) => String(item || '').trim()).filter(Boolean);
  const industryLines = industries.map((item) => String(item || '').trim()).filter(Boolean);
  if (topicLines.length === 0 && industryLines.length === 0) return '';
  if (industryLines.length === 0) return topicLines.join('\n');
  return `${topicLines.join('\n')}\n\n${industryLines.join('\n')}`;
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

function tokenizeForOverlap(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2);
}

function interestTopicTooCloseToAnswers(topic, answers = []) {
  const topicNorm = normalizeListItem(topic).toLowerCase();
  if (!topicNorm) return false;
  const topicTokens = tokenizeForOverlap(topicNorm);
  for (const answer of answers) {
    const answerNorm = String(answer || '').trim().toLowerCase();
    if (!answerNorm) continue;
    if (answerNorm.includes(topicNorm) || topicNorm.includes(answerNorm)) return true;
    if (topicTokens.length === 0) continue;
    const answerTokens = new Set(tokenizeForOverlap(answerNorm));
    const overlap = topicTokens.filter((token) => answerTokens.has(token)).length / topicTokens.length;
    if (overlap >= 0.66) return true;
  }
  return false;
}

function countParrotInterestTopics(interestTopics = [], answers = []) {
  return interestTopics.filter((topic) => interestTopicTooCloseToAnswers(topic, answers)).length;
}

function isValidTopicsIndustriesSummary(parsed) {
  return parsed.interestTopics.length >= 3 && parsed.industries.length >= INDUSTRY_COUNT_MIN;
}

function supplementIndustriesFromContext(parsed, messages) {
  if (parsed.industries.length >= INDUSTRY_COUNT_MIN) return parsed;
  const contextText = [
    ...parsed.interestTopics,
    ...extractUserAnswerTexts(messages),
  ].join(' ');
  const inferred = inferIndustriesFromText(contextText, { maxItems: INDUSTRY_COUNT_MAX });
  const industries = normalizeIndustryDomains(
    [...parsed.industries, ...inferred],
    { keepUnknown: false, maxItems: INDUSTRY_COUNT_MAX }
  );
  return { ...parsed, industries };
}

async function generateTopicsIndustriesSummary({ audience, lang, seniority, messages, cvContext, llm = callOpenAI }) {
  const system = buildSummarySystemPrompt({ audience, lang, seniority, cvContext });
  const answers = extractUserAnswerTexts(messages);
  const isDe = String(lang || 'de').toLowerCase().startsWith('de');
  const canonicalList = formatIndustryTaxonomyForPrompt(lang);

  const run = async (extraUserHint = '') => {
    const user = `${buildSummaryUserPrompt(messages, lang)}${extraUserHint}`;
    const { text } = await llm({
      model: process.env.OPENAI_MODEL,
      temperature: 0.38,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    });
    return parseTopicsIndustriesSummary(text);
  };

  let parsed = await run('');
  if (countParrotInterestTopics(parsed.interestTopics, answers) >= 2) {
    const retryHint = isDe
      ? '\n\nDie interestTopics waren zu nah an den Antworten. Formuliere alle fünf Interessen neu — abstrakter, ohne Wörter aus den Antworten.'
      : '\n\nThe interestTopics were too close to the answers. Rewrite all five interests more abstractly, without words from the answers.';
    parsed = await run(retryHint);
  }

  if (!isValidTopicsIndustriesSummary(parsed)) {
    const retryHint = isDe
      ? `\n\nZu wenige gültige Ergebnisse nach Normalisierung. Liefere genau fünf interestTopics (mind. 3 nach Trim) und ${INDUSTRY_COUNT_MIN}–${INDUSTRY_COUNT_MAX} industries ausschließlich aus dieser kanonischen Liste (exakte Schreibweise): ${canonicalList}`
      : `\n\nToo few valid results after normalization. Return exactly five interestTopics (at least 3 after trim) and ${INDUSTRY_COUNT_MIN}–${INDUSTRY_COUNT_MAX} industries chosen only from this canonical list (exact spelling): ${canonicalList}`;
    parsed = await run(retryHint);
  }

  parsed = supplementIndustriesFromContext(parsed, messages);

  if (parsed.interestTopics.length < 3) {
    throw new Error('LLM returned too few interest topics');
  }
  if (parsed.industries.length < INDUSTRY_COUNT_MIN) {
    throw new Error('LLM returned too few industries');
  }
  return parsed;
}

/**
 * @param {{ seniority?: object, messages?: { role: string, content: string }[], lang?: string, llm?: Function }} input
 */
async function advanceTopicsIndustriesCoaching(input = {}) {
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
    const { interestTopics, industries } = await generateTopicsIndustriesSummary({
      audience, lang, seniority, messages, cvContext, llm,
    });
    const summaryIntro = lang === 'de'
      ? 'Basierend auf deinen Antworten passen diese Themen und Bereiche besonders gut zu dir:'
      : 'Based on your answers, these topics and fields fit you well:';
    return {
      audience,
      phase: 'summary',
      complete: true,
      message: { role: 'assistant', content: summaryIntro },
      interestTopics,
      industries,
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
  TOPIC_COUNT,
  INDUSTRY_COUNT_MIN,
  INDUSTRY_COUNT_MAX,
  resolveWorkEnjoyCoachingAudience,
  normalizeCoachingLang,
  parseTopicsIndustriesSummary,
  normalizeTopicsIndustriesResult,
  formatTopicsIndustriesAsText,
  advanceTopicsIndustriesCoaching,
  interestTopicTooCloseToAnswers,
  countParrotInterestTopics,
};
