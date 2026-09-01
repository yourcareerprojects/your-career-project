const MAX_TEXT_LENGTH = 2500;
const MAX_STEPS = 6;
const MIN_ALTERNATIVES = 2;
const MAX_ALTERNATIVES = 2;
const MIN_ALTERNATIVE_STEPS = 2;
const MAX_SKILLS = 8;

/**
 * @param {string} text
 * @returns {object | null}
 */
function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const tryParse = (candidate) => {
    try {
      const parsed = JSON.parse(candidate);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };

  let parsed = tryParse(raw);
  if (parsed) return parsed;

  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    parsed = tryParse(match[0]);
    if (parsed) return parsed;
  }

  return null;
}

/**
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
function normalizeText(value, max = MAX_TEXT_LENGTH) {
  return String(value || '').trim().slice(0, max);
}

/**
 * @param {unknown} steps
 * @returns {{ title: string, description: string, duration: string }[]}
 */
function normalizeSteps(steps) {
  if (!Array.isArray(steps)) return [];
  return steps
    .map((step) => {
      if (!step || typeof step !== 'object') return null;
      const title = normalizeText(step.title || step.phase, 200);
      const description = normalizeText(step.description || (
        Array.isArray(step.actions) ? step.actions.map((a) => `• ${a}`).join('\n') : ''
      ), 2000);
      const duration = normalizeText(step.duration, 80);
      if (!title || !description) return null;
      return { title, description, duration };
    })
    .filter(Boolean)
    .slice(0, MAX_STEPS);
}

/**
 * @param {unknown} alternatives
 * @returns {{ title: string, steps: { title: string, description: string, duration: string }[] }[]}
 */
function normalizeAlternatives(alternatives) {
  if (!Array.isArray(alternatives)) return [];
  return alternatives
    .map((alt, idx) => {
      if (typeof alt === 'string') {
        const title = normalizeText(alt, 200) || `Alternative ${idx + 1}`;
        return { title, steps: [] };
      }
      if (!alt || typeof alt !== 'object') return null;
      const title = normalizeText(alt.title, 200) || `Alternative ${idx + 1}`;
      const steps = normalizeSteps(alt.steps);
      if (steps.length < MIN_ALTERNATIVE_STEPS) return null;
      return { title, steps };
    })
    .filter(Boolean)
    .slice(0, MAX_ALTERNATIVES);
}

/**
 * @param {{ alternativePaths?: object[] }} data
 * @returns {string | null}
 */
function validateAlternativePaths(data) {
  const alternatives = Array.isArray(data?.alternativePaths) ? data.alternativePaths : [];
  if (alternatives.length < MIN_ALTERNATIVES) {
    return `Career plan must include exactly ${MIN_ALTERNATIVES} alternative paths`;
  }
  const invalidAlt = alternatives.find(
    (alt) => !Array.isArray(alt?.steps) || alt.steps.length < MIN_ALTERNATIVE_STEPS
  );
  if (invalidAlt) {
    return `Each alternative must include at least ${MIN_ALTERNATIVE_STEPS} roadmap steps`;
  }
  return null;
}

/**
 * Parse LLM career-coach JSON into a normalized coaching plan.
 * @param {string} text
 * @returns {{ ok: true, data: object } | { ok: false, error: string }}
 */
function parseExplanationResponse(text) {
  const parsed = extractJsonObject(text);
  if (!parsed) {
    return { ok: false, error: 'Response is not valid JSON' };
  }

  const introduction = normalizeText(
    parsed.introduction || parsed.motivation || parsed.understood
  );
  const whyThisPath = normalizeText(
    parsed.whyThisPath || parsed.explanation
  );
  const keySkills = Array.isArray(parsed.keySkills)
    ? parsed.keySkills.map((s) => normalizeText(s, 80)).filter(Boolean).slice(0, MAX_SKILLS)
    : [];

  const recommendedPathRaw = parsed.recommendedPath && typeof parsed.recommendedPath === 'object'
    ? parsed.recommendedPath
    : {};
  const steps = normalizeSteps(recommendedPathRaw.steps || parsed.steps || parsed.phases);
  const alternatives = normalizeAlternatives(parsed.alternatives || parsed.alternativePaths);

  // Legacy explanation-only responses (no steps) remain parseable for retries/tests.
  const hasCoachingProse = Boolean(introduction || whyThisPath);
  if (!hasCoachingProse) {
    return { ok: false, error: 'Missing introduction or whyThisPath' };
  }

  return {
    ok: true,
    data: {
      introduction,
      whyThisPath,
      explanation: whyThisPath,
      motivation: introduction,
      keySkills,
      alternatives: alternatives.map((alt) => alt.title),
      alternativePaths: alternatives,
      recommendedPath: {
        timeline: normalizeText(recommendedPathRaw.timeline, 120),
        steps,
      },
      summary: {
        understood: introduction,
        whyThisPath,
        alternatives: alternatives.map((alt) => alt.title),
      },
    },
  };
}

/**
 * @param {() => Promise<string>} fetchText
 * @param {{ maxAttempts?: number, requireSteps?: boolean, requireAlternatives?: boolean }} [options]
 * @returns {Promise<object>}
 */
async function parseExplanationWithRetry(fetchText, options = {}) {
  const maxAttempts = Math.max(1, Number(options.maxAttempts) || 3);
  const requireSteps = options.requireSteps !== false;
  const requireAlternatives = options.requireAlternatives !== false && requireSteps;
  let lastError = 'Unknown parse error';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const text = await fetchText(attempt, lastError);
    const result = parseExplanationResponse(text);
    if (!result.ok) {
      lastError = result.error;
      continue;
    }
    if (requireSteps && (!result.data.recommendedPath?.steps || result.data.recommendedPath.steps.length < 2)) {
      lastError = 'Career plan must include at least 2 roadmap steps';
      continue;
    }
    if (requireAlternatives) {
      const alternativeError = validateAlternativePaths(result.data);
      if (alternativeError) {
        lastError = alternativeError;
        continue;
      }
    }
    return result.data;
  }

  throw new Error(`LLM returned invalid career coach response: ${lastError}`);
}

module.exports = {
  parseExplanationResponse,
  parseExplanationWithRetry,
  extractJsonObject,
  normalizeSteps,
  normalizeAlternatives,
  validateAlternativePaths,
  MIN_ALTERNATIVES,
};
