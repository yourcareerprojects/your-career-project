const ALLOWED = new Set(['keep', 'skip', 'dislike']);

/**
 * Returns a payload fragment for POST /api/profile/saved-career-steps when the
 * role was rated during simulation ranking (Keep / Skip / Dislike).
 */
export function pickUserEvaluationForSave(source) {
  const v = source?.userEvaluation;
  if (v == null) return {};
  const key = String(v).toLowerCase();
  if (!ALLOWED.has(key)) return {};
  return { userEvaluation: key };
}
