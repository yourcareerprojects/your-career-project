/**
 * Detect small manual profile text edits (typos, a few words, one short sentence)
 * so we can skip expensive narrative / embedding LLM work.
 */

const MAX_MINOR_WORD_CHANGES = 3;
const MAX_MINOR_CHAR_EDIT_RATIO = 0.18;
const MAX_MINOR_ABS_CHAR_EDITS = 48;
const MINOR_SHORT_TEXT_MAX_LEN = 220;

function normalizeComparableText(value = '') {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenizeWords(value = '') {
  return normalizeComparableText(value)
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

function levenshteinDistance(left = '', right = '') {
  const a = String(left);
  const b = String(right);
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[rows - 1][cols - 1];
}

function countWordLevelChanges(beforeWords = [], afterWords = []) {
  const maxLen = Math.max(beforeWords.length, afterWords.length);
  let changes = 0;
  for (let i = 0; i < maxLen; i += 1) {
    if ((beforeWords[i] || '') !== (afterWords[i] || '')) changes += 1;
  }
  return changes;
}

/**
 * @param {string} before
 * @param {string} after
 * @returns {boolean}
 */
function isMinorTextEdit(before = '', after = '') {
  const prev = normalizeComparableText(before);
  const next = normalizeComparableText(after);
  if (prev === next) return true;
  if (!prev || !next) return false;

  const maxLen = Math.max(prev.length, next.length);
  const charEdits = levenshteinDistance(prev.toLowerCase(), next.toLowerCase());
  if (charEdits <= MAX_MINOR_ABS_CHAR_EDITS && charEdits / maxLen <= MAX_MINOR_CHAR_EDIT_RATIO) {
    return true;
  }

  const prevWords = tokenizeWords(prev);
  const nextWords = tokenizeWords(next);
  const wordChanges = countWordLevelChanges(prevWords, nextWords);
  if (
    wordChanges <= MAX_MINOR_WORD_CHANGES
    && Math.abs(prevWords.length - nextWords.length) <= MAX_MINOR_WORD_CHANGES
  ) {
    return true;
  }

  if (prev.length <= MINOR_SHORT_TEXT_MAX_LEN && next.length <= MINOR_SHORT_TEXT_MAX_LEN) {
    const similarity = 1 - (charEdits / maxLen);
    if (similarity >= 0.72) return true;
  }

  return false;
}

/**
 * @param {string[]} previousAnswers
 * @param {string[]} nextAnswers
 * @returns {{
 *   changedIndices: number[],
 *   minorIndices: number[],
 *   majorIndices: number[],
 *   hasChanges: boolean,
 *   hasMajorChange: boolean,
 *   onlyMinorChanges: boolean,
 * }}
 */
function classifyIdentityAnswerChanges(previousAnswers = [], nextAnswers = []) {
  const prev = Array.isArray(previousAnswers) ? previousAnswers : [];
  const next = Array.isArray(nextAnswers) ? nextAnswers : [];
  const changedIndices = [];
  const minorIndices = [];
  const majorIndices = [];

  for (let idx = 0; idx < 5; idx += 1) {
    const before = String(prev[idx] || '').trim();
    const after = String(next[idx] || '').trim();
    if (before === after) continue;
    changedIndices.push(idx);
    if (isMinorTextEdit(before, after)) minorIndices.push(idx);
    else majorIndices.push(idx);
  }

  return {
    changedIndices,
    minorIndices,
    majorIndices,
    hasChanges: changedIndices.length > 0,
    hasMajorChange: majorIndices.length > 0,
    onlyMinorChanges: changedIndices.length > 0 && majorIndices.length === 0,
  };
}

/**
 * Same-length list with only minor per-item text edits (no add/remove/reorder).
 *
 * @param {string[]} beforeList
 * @param {string[]} afterList
 * @returns {boolean}
 */
function isMinorStructuredListEdit(beforeList = [], afterList = []) {
  const before = Array.isArray(beforeList) ? beforeList.map((v) => String(v || '').trim()) : [];
  const after = Array.isArray(afterList) ? afterList.map((v) => String(v || '').trim()) : [];
  if (before.length !== after.length) return false;
  let hasChange = false;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] === after[i]) continue;
    hasChange = true;
    if (!isMinorTextEdit(before[i], after[i])) return false;
  }
  return hasChange;
}

module.exports = {
  isMinorTextEdit,
  classifyIdentityAnswerChanges,
  isMinorStructuredListEdit,
  MAX_MINOR_WORD_CHANGES,
};
