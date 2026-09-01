/**
 * Rank and filter exploration candidates from delta matches.
 * Quality filter: positive delta above configured minimum (applied upstream).
 */

const { getRoleKey } = require('./careerExplorationService');

/**
 * @param {object} match
 * @returns {string|null}
 */
function matchJobKey(match) {
  return getRoleKey(match?.role);
}

/**
 * Rank delta matches by positive delta (desc), excluding previously surfaced jobs.
 *
 * @param {object[]} deltaJobMatches
 * @param {{ previouslyShownJobIds?: Set<string>|string[], minDelta?: number }} [options]
 * @returns {{ ranked: object[], excludedCount: number, candidateCount: number }}
 */
function rankExplorationCandidates(deltaJobMatches, options = {}) {
  const previouslyShown = new Set(
    (options.previouslyShownJobIds instanceof Set
      ? [...options.previouslyShownJobIds]
      : options.previouslyShownJobIds || []
    ).map(String)
  );

  const minDelta = Number.isFinite(options.minDelta) ? options.minDelta : 0;

  const pool = (Array.isArray(deltaJobMatches) ? deltaJobMatches : [])
    .filter((m) => m && m.role && Number.isFinite(m.delta) && Number.isFinite(m.newScore))
    .filter((m) => m.delta > minDelta)
    .sort((a, b) => {
      const deltaDiff = b.delta - a.delta;
      if (deltaDiff !== 0) return deltaDiff;
      const newDiff = b.newScore - a.newScore;
      if (newDiff !== 0) return newDiff;
      return String(matchJobKey(a) || '').localeCompare(String(matchJobKey(b) || ''));
    });

  let excludedCount = 0;
  const ranked = [];

  for (const match of pool) {
    const key = matchJobKey(match);
    if (key && previouslyShown.has(key)) {
      excludedCount += 1;
      continue;
    }
    ranked.push(match);
  }

  return {
    ranked,
    excludedCount,
    candidateCount: pool.length,
  };
}

module.exports = {
  rankExplorationCandidates,
  matchJobKey,
};
