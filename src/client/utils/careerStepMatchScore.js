/**
 * Match score for career step detail UI: hybrid embedding scores from simulation,
 * with fallbacks for legacy data (0–10 score, matched-input heuristic).
 */

function lc(s) {
  return String(s || '').toLowerCase();
}

function isOutsideCategory(step) {
  const list = lc(step.listCategory).replace(/\s+/g, '');
  const cat = lc(step.category).replace(/[\s_-]/g, '');
  return list === 'outsidetheboxroles' || cat === 'outsidethebox' || cat === 'outsidecomfortzone';
}

function isNextCategory(step) {
  const list = lc(step.listCategory).replace(/\s+/g, '');
  const cat = lc(step.category).replace(/[\s_-]/g, '');
  return list === 'nextcareerroles' || cat === 'nextsteps' || cat === 'nextstep';
}

/**
 * Raw hybrid value used for the step's list (NEXT vs OUT_OF_THE_BOX), or null.
 */
export function getHybridRawForStep(step) {
  if (!step || typeof step !== 'object') return null;
  const hN = step.hybridScoreNextRole;
  const hO = step.hybridScoreOutOfTheBox;
  const outside = isOutsideCategory(step);
  const next = isNextCategory(step);
  if (outside && typeof hO === 'number' && Number.isFinite(hO)) return hO;
  if (next && typeof hN === 'number' && Number.isFinite(hN)) return hN;
  if (typeof hN === 'number' && Number.isFinite(hN)) return hN;
  if (typeof hO === 'number' && Number.isFinite(hO)) return hO;
  return null;
}

/**
 * Percent 0–100 for LinearProgress and headers. Hybrid scores are cosine×(1−penalty), typically ∈ [0, 1].
 */
export function getCareerStepMatchScorePercent(step) {
  const raw = getHybridRawForStep(step);
  if (raw != null && Number.isFinite(raw)) {
    return Math.min(100, Math.max(0, Math.round(raw * 100)));
  }
  if (step && typeof step.score === 'number' && Number.isFinite(step.score)) {
    return Math.min(100, Math.max(0, Math.round(step.score * 10)));
  }
  const matched = step && (step.matchedInputs || step.matchedProfileInputs);
  if (Array.isArray(matched) && matched.length > 0) {
    return Math.min((matched.length / 5) * 100, 100);
  }
  return 0;
}

/**
 * Optional fields to persist when saving a career step so match % stays correct after reload.
 */
export function getMatchScoreFieldsForSave(step) {
  if (!step || typeof step !== 'object') return {};
  const out = {};
  if (step.listCategory != null && String(step.listCategory).trim() !== '') {
    out.listCategory = String(step.listCategory).trim();
  }
  if (typeof step.hybridScoreNextRole === 'number' && Number.isFinite(step.hybridScoreNextRole)) {
    out.hybridScoreNextRole = step.hybridScoreNextRole;
  }
  if (typeof step.hybridScoreOutOfTheBox === 'number' && Number.isFinite(step.hybridScoreOutOfTheBox)) {
    out.hybridScoreOutOfTheBox = step.hybridScoreOutOfTheBox;
  }
  return out;
}
