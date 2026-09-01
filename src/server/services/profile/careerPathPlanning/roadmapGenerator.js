/**
 * Maps AI career-coach output into the CareerPathOverview pathPlan contract.
 */

/**
 * @param {object} summary
 * @param {'de' | 'en'} lang
 * @returns {string}
 */
function buildSummaryText(summary, lang = 'de') {
  if (!summary || typeof summary !== 'object') return '';
  const isDe = lang === 'de';
  const parts = [];

  if (summary.understood) parts.push(summary.understood);
  if (summary.whyThisPath) parts.push(summary.whyThisPath);
  if (Array.isArray(summary.alternatives) && summary.alternatives.length > 0) {
    const prefix = isDe ? 'Mögliche Alternativen:' : 'Possible alternatives:';
    parts.push(`${prefix}\n${summary.alternatives.map((alt) => `• ${alt}`).join('\n')}`);
  }

  return parts.join('\n\n');
}

/**
 * @param {unknown} alt
 * @param {number} idx
 * @param {boolean} isDe
 * @returns {object | null}
 */
function mapAlternativePath(alt, idx, isDe) {
  if (typeof alt === 'string') {
    const title = String(alt || '').trim() || (isDe ? `Alternative ${idx + 1}` : `Alternative ${idx + 1}`);
    return { title, steps: [] };
  }
  if (!alt || typeof alt !== 'object') return null;

  const stepsRaw = Array.isArray(alt.steps) ? alt.steps : [];
  const steps = stepsRaw.map((step, stepIdx) => ({
    order: stepIdx + 1,
    title: String(step.title || '').trim(),
    description: String(step.description || '').trim(),
    duration: String(step.duration || '').trim(),
  })).filter((step) => step.title && step.description);

  const title = String(alt.title || (isDe ? `Alternative ${idx + 1}` : `Alternative ${idx + 1}`)).trim();

  if (steps.length < 2) return null;

  return { title, steps };
}

/**
 * Build pathPlan from AI coach response (preferred path).
 * @param {object} coachPlan
 * @param {object} state
 * @param {'de'|'en'} [lang]
 * @param {{ keySkillsFallback?: string[] }} [options]
 * @returns {object|null}
 */
function buildPathPlanFromCoachPlan(coachPlan, state, lang = 'de', options = {}) {
  if (!coachPlan || typeof coachPlan !== 'object') return null;

  const isDe = lang === 'de';
  const stepsRaw = Array.isArray(coachPlan.recommendedPath?.steps)
    ? coachPlan.recommendedPath.steps
    : [];

  if (stepsRaw.length < 2) return null;

  const steps = stepsRaw.map((step, idx) => ({
    order: idx + 1,
    title: String(step.title || '').trim(),
    description: String(step.description || '').trim(),
    duration: String(step.duration || '').trim(),
  })).filter((step) => step.title && step.description);

  if (steps.length < 2) return null;

  const introduction = String(coachPlan.introduction || coachPlan.motivation || '').trim();
  const whyThisPath = String(coachPlan.whyThisPath || coachPlan.explanation || '').trim();

  const headline = isDe
    ? 'Dein persönlicher Weg'
    : 'Your personal path';

  const alternativePaths = Array.isArray(coachPlan.alternativePaths) && coachPlan.alternativePaths.length
    ? coachPlan.alternativePaths.slice(0, 2).map((alt, idx) => mapAlternativePath(alt, idx, isDe)).filter(Boolean)
    : (Array.isArray(coachPlan.alternatives)
      ? coachPlan.alternatives.slice(0, 2).map((alt, idx) => mapAlternativePath(alt, idx, isDe)).filter(Boolean)
      : []);

  const keySkills = Array.isArray(coachPlan.keySkills) && coachPlan.keySkills.length
    ? coachPlan.keySkills.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8)
    : (Array.isArray(options.keySkillsFallback)
      ? options.keySkillsFallback.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8)
      : []);

  const summaryParts = [introduction, whyThisPath].filter(Boolean);

  return {
    headline,
    summary: summaryParts.join('\n\n').trim() || (isDe
      ? 'Hier ist dein persönlicher Entwicklungsplan basierend auf deinen Antworten.'
      : 'Here is your personal development plan based on your answers.'),
    introduction,
    whyThisPath,
    motivation: introduction,
    recommendedPath: {
      timeline: String(coachPlan.recommendedPath?.timeline || '').trim(),
      steps,
    },
    alternativePaths,
    keySkills,
  };
}

/**
 * Legacy helper: map deterministic roadmap phases + explanation into pathPlan.
 * @deprecated Prefer buildPathPlanFromCoachPlan — roadmap templates are retired.
 */
function buildPathPlanFromRoadmap(roadmap, summary, state, lang = 'de', options = {}) {
  if (!roadmap || !Array.isArray(roadmap.phases) || roadmap.phases.length < 2) {
    return null;
  }

  const isDe = lang === 'de';
  const summaryText = buildSummaryText(summary, lang);
  const motivation = String(options.motivation || summary?.understood || '').trim();

  const steps = roadmap.phases.map((phase, idx) => ({
    order: idx + 1,
    title: phase.title,
    description: phase.actions.map((action) => `• ${action}`).join('\n'),
    duration: '',
  }));

  const headline = isDe
    ? 'Dein persönlicher Weg'
    : 'Your personal path';

  const alternativePaths = Array.isArray(summary?.alternatives)
    ? summary.alternatives.slice(0, 2).map((alt, idx) => ({
      title: isDe ? `Alternative ${idx + 1}` : `Alternative ${idx + 1}`,
      description: alt,
      pros: [],
      cons: [],
    }))
    : [];

  const summaryParts = [motivation, summaryText].filter(Boolean);
  const combinedSummary = summaryParts.join('\n\n').trim();

  return {
    headline,
    summary: combinedSummary || (isDe
      ? 'Hier ist dein persönlicher Entwicklungsplan basierend auf deinen Antworten.'
      : 'Here is your personal development plan based on your answers.'),
    motivation,
    recommendedPath: {
      timeline: '',
      steps,
    },
    alternativePaths,
    keySkills: Array.isArray(options.keySkills) ? options.keySkills : [],
  };
}

/**
 * Backwards-compatible parser for legacy path plan JSON.
 * @param {string} text
 * @returns {object | null}
 */
function parseLegacyPathPlanFromText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const tryJson = (candidate) => {
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  };

  let parsed = tryJson(raw);
  if (!parsed) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) parsed = tryJson(match[0]);
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const steps = Array.isArray(parsed.recommendedPath?.steps)
    ? parsed.recommendedPath.steps
      .map((step, idx) => ({
        order: Number(step?.order) || idx + 1,
        title: String(step?.title || '').trim(),
        description: String(step?.description || '').trim(),
        duration: String(step?.duration || '').trim(),
      }))
      .filter((step) => step.title)
    : [];

  const alternativePaths = Array.isArray(parsed.alternativePaths)
    ? parsed.alternativePaths
      .map((path, idx) => mapAlternativePath(path, idx, true))
      .filter((path) => path?.title && path?.steps?.length >= 2)
    : [];

  const headline = String(parsed.headline || '').trim();
  const summary = String(parsed.summary || '').trim();
  const timeline = String(parsed.recommendedPath?.timeline || '').trim();

  if (!headline || !summary || steps.length < 2) {
    return null;
  }

  return {
    headline,
    summary,
    recommendedPath: {
      timeline,
      steps,
    },
    alternativePaths: alternativePaths.slice(0, 2),
    keySkills: Array.isArray(parsed.keySkills)
      ? parsed.keySkills.map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8)
      : [],
  };
}

module.exports = {
  buildSummaryText,
  buildPathPlanFromCoachPlan,
  buildPathPlanFromRoadmap,
  parseLegacyPathPlanFromText,
};
