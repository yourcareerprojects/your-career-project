const { callOpenAI } = require('../ai/callOpenAI');
const { normalizeCoachingCvContext, buildCvAwareFirstQuestionTurnHint } = require('./coachingCvContext');
const {
  COACHING_QUESTION_COUNT,
  STRENGTH_COUNT,
  MAX_STRENGTH_WORDS,
  SKILL_DOMAIN_COUNT_MIN,
  SKILL_DOMAIN_COUNT_MAX,
  resolveWorkEnjoyCoachingAudience,
  buildQuestionSystemPrompt,
  buildQuestionTurnUserMessage,
  buildSummarySystemPrompt,
  buildSummaryUserPrompt,
  extractUserAnswerTexts,
} = require('../../prompts/naturallyGoodAtCoachingPrompts');
const {
  normalizeMessages,
  normalizeCoachingLang,
  formatCoachingTurnMessage,
  countUserMessages,
  countAssistantMessages,
} = require('./workEnjoyCoachingService');
const {
  listDistinctRoleSkillDomainsForSelection,
  normalizeSkillDomainSelection,
  formatSkillDomainCatalogForPrompt,
  shortlistSkillDomainsForCoaching,
} = require('../careerPathSkillService');

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

function normalizeNaturallyGoodAtResult({ strengths = [], skillDomains = [] } = {}, catalog = []) {
  return {
    strengths: dedupeListItems(strengths, STRENGTH_COUNT, MAX_STRENGTH_WORDS),
    skillDomains: normalizeSkillDomainSelection(skillDomains, catalog, {
      maxItems: SKILL_DOMAIN_COUNT_MAX,
    }),
  };
}

function parseNaturallyGoodAtSummary(text, catalog = []) {
  const raw = String(text || '').trim();
  if (!raw) return { strengths: [], skillDomains: [] };

  const tryJson = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      const strengths = Array.isArray(parsed?.strengths) ? parsed.strengths : [];
      const skillDomains = Array.isArray(parsed?.skillDomains)
        ? parsed.skillDomains
        : Array.isArray(parsed?.everydayExamples)
          ? parsed.everydayExamples
          : Array.isArray(parsed?.examples)
            ? parsed.examples
            : [];
      return {
        strengths: strengths.map(normalizeListItem).filter(Boolean),
        skillDomains: skillDomains.map(normalizeListItem).filter(Boolean),
      };
    } catch {
      return { strengths: [], skillDomains: [] };
    }
  };

  let result = tryJson(raw);
  if (result.strengths.length === 0 && result.skillDomains.length === 0) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) result = tryJson(match[0]);
  }

  if (result.strengths.length > 0 || result.skillDomains.length > 0) {
    return normalizeNaturallyGoodAtResult(result, catalog);
  }

  const blocks = raw.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length >= 2) {
    const parseBlock = (block) => block
      .split(/\n+/)
      .map(normalizeListItem)
      .filter(Boolean);
    return normalizeNaturallyGoodAtResult({
      strengths: parseBlock(blocks[0]),
      skillDomains: parseBlock(blocks[1]),
    }, catalog);
  }

  const lines = raw.split(/\n+/).map(normalizeListItem).filter(Boolean);
  return normalizeNaturallyGoodAtResult({
    strengths: lines.slice(0, STRENGTH_COUNT),
    skillDomains: lines.slice(STRENGTH_COUNT),
  }, catalog);
}

function formatNaturallyGoodAtAsText({ strengths = [] } = {}) {
  return strengths.map((item) => String(item || '').trim()).filter(Boolean).join('\n');
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

async function generateNaturallyGoodAtSummary({
  audience,
  lang,
  seniority,
  messages,
  cvContext,
  llm = callOpenAI,
  loadSkillDomainCatalog = listDistinctRoleSkillDomainsForSelection,
}) {
  const { skillDomains: catalog } = await loadSkillDomainCatalog(lang);
  if (!Array.isArray(catalog) || catalog.length === 0) {
    throw new Error('No skill domains available in role catalog');
  }

  const answers = extractUserAnswerTexts(messages);
  const shortlist = shortlistSkillDomainsForCoaching(catalog, answers);
  const canonicalList = formatSkillDomainCatalogForPrompt(shortlist);
  const system = buildSummarySystemPrompt({
    audience, lang, seniority, skillDomainCatalog: canonicalList, cvContext,
  });
  const user = buildSummaryUserPrompt(messages, lang);
  const { text } = await llm({
    model: process.env.OPENAI_MODEL,
    temperature: 0.35,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  });
  const parsed = parseNaturallyGoodAtSummary(text, catalog);
  if (parsed.strengths.length < 3) {
    throw new Error('LLM returned too few strengths');
  }
  if (parsed.skillDomains.length < SKILL_DOMAIN_COUNT_MIN) {
    const retryHint = lang === 'de'
      ? '\n\nDie skillDomains waren ungültig oder zu wenige. Wähle 3–5 Bereiche ausschließlich aus der kanonischen Liste.'
      : '\n\nThe skillDomains were invalid or too few. Choose 3–5 domains only from the canonical list.';
    const { text: retryText } = await llm({
      model: process.env.OPENAI_MODEL,
      temperature: 0.35,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `${user}${retryHint}` },
      ],
    });
    const retried = parseNaturallyGoodAtSummary(retryText, catalog);
    if (retried.strengths.length >= 3 && retried.skillDomains.length >= SKILL_DOMAIN_COUNT_MIN) {
      return retried;
    }
    throw new Error('LLM returned too few skill domains');
  }
  return parsed;
}

/**
 * @param {{ seniority?: object, messages?: { role: string, content: string }[], lang?: string, llm?: Function, loadSkillDomainCatalog?: Function }} input
 */
async function advanceNaturallyGoodAtCoaching(input = {}) {
  const seniority = input.seniority && typeof input.seniority === 'object' ? input.seniority : {};
  const lang = normalizeCoachingLang(input.lang);
  const llm = typeof input.llm === 'function' ? input.llm : callOpenAI;
  const loadSkillDomainCatalog = typeof input.loadSkillDomainCatalog === 'function'
    ? input.loadSkillDomainCatalog
    : listDistinctRoleSkillDomainsForSelection;
  const messages = normalizeMessages(input.messages);
  const cvContext = normalizeCoachingCvContext(input.cvContext);
  const audience = resolveWorkEnjoyCoachingAudience(seniority);
  const userCount = countUserMessages(messages);
  const assistantCount = countAssistantMessages(messages);

  if (userCount > COACHING_QUESTION_COUNT) {
    throw new Error('Too many user messages');
  }

  if (userCount === COACHING_QUESTION_COUNT) {
    const { strengths, skillDomains } = await generateNaturallyGoodAtSummary({
      audience, lang, seniority, messages, cvContext, llm, loadSkillDomainCatalog,
    });
    const summaryIntro = lang === 'de'
      ? 'Basierend auf deinen Antworten sind das deine natürlichen Stärken:'
      : 'Based on your answers, these are your natural strengths:';
    return {
      audience,
      phase: 'summary',
      complete: true,
      message: { role: 'assistant', content: summaryIntro },
      strengths,
      skillDomains,
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
  STRENGTH_COUNT,
  SKILL_DOMAIN_COUNT_MIN,
  SKILL_DOMAIN_COUNT_MAX,
  resolveWorkEnjoyCoachingAudience,
  normalizeCoachingLang,
  parseNaturallyGoodAtSummary,
  normalizeNaturallyGoodAtResult,
  formatNaturallyGoodAtAsText,
  advanceNaturallyGoodAtCoaching,
};
