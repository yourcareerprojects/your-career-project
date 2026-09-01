const TOPIC_COUNT = 5;

function formatInterestTopicsAsText(interestTopics = []) {
  return interestTopics.map((item) => String(item || '').trim()).filter(Boolean).join('\n');
}

function parseTopicLines(text) {
  return String(text || '')
    .split('\n')
    .map((line) => line.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

function parseTopicsIndustriesFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return { interestTopics: [], industries: [] };
  const blocks = raw.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
  if (blocks.length >= 2) {
    return { interestTopics: parseTopicLines(blocks[0]), industries: parseTopicLines(blocks[1]) };
  }
  // Legacy flat format: first TOPIC_COUNT lines were topics, remainder industries.
  const lines = parseTopicLines(raw);
  return { interestTopics: lines.slice(0, TOPIC_COUNT), industries: lines.slice(TOPIC_COUNT) };
}

/** Identity field stores interest topics only; industries live in structuredUserInfo.domains. */
function parseInterestTopicsFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  const blocks = raw.split(/\n\s*\n+/).map((block) => block.trim()).filter(Boolean);
  // Legacy dual-block format stored topics then industries; keep the topics block only.
  if (blocks.length >= 2) {
    return parseTopicLines(blocks[0]);
  }
  return parseTopicLines(raw);
}

function formatTopicsIndustriesAsText({ interestTopics = [] } = {}) {
  return formatInterestTopicsAsText(interestTopics);
}

module.exports = {
  TOPIC_COUNT,
  formatInterestTopicsAsText,
  formatTopicsIndustriesAsText,
  parseInterestTopicsFromText,
  parseTopicsIndustriesFromText,
};
