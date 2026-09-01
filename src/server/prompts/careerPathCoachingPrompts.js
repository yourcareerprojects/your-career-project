const {
  formatSeniorityContext,
  resolveWorkEnjoyCoachingAudience,
} = require('./workEnjoyCoachingPrompts');

function normalizeLang(lang) {
  return String(lang || 'de').toLowerCase().startsWith('en') ? 'en' : 'de';
}

/**
 * Map seniority signals onto path-planning question sets.
 * early_career + mid_career → career; senior is separate.
 * @param {object} [seniority]
 * @returns {'pupil' | 'student' | 'career' | 'senior'}
 */
function resolvePathPlanningAudience(seniority = {}) {
  const audience = resolveWorkEnjoyCoachingAudience(seniority);
  if (audience === 'pupil') return 'pupil';
  if (audience === 'student') return 'student';
  if (audience === 'senior') return 'senior';
  return 'career';
}

function normalizeStringList(items, max = 10) {
  if (!Array.isArray(items)) return [];
  return items
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .slice(0, max);
}

function formatRoleContext(role = {}, lang = 'de') {
  const isDe = normalizeLang(lang) === 'de';
  const title = String(role.title || role.name || '').trim() || (isDe ? 'Unbekannte Rolle' : 'Unknown role');
  const description = String(role.description || '').trim().slice(0, 1200);
  const matchScore = role.matchScore ?? role.score ?? null;
  const skillGaps = Array.isArray(role.skillGaps) ? role.skillGaps.slice(0, 8) : [];
  const recommendedActions = Array.isArray(role.recommendedActions)
    ? role.recommendedActions.slice(0, 6)
    : [];
  const progressionNotes = Array.isArray(role.progressionNotes)
    ? role.progressionNotes.slice(0, 6)
    : [];
  const requiredSkills = normalizeStringList(role.requiredSkills, 10);

  const lines = isDe ? [`Zielrolle: ${title}`] : [`Target role: ${title}`];

  if (matchScore != null && Number.isFinite(Number(matchScore))) {
    lines.push(isDe ? `Passungs-Score: ${Math.round(Number(matchScore))}%` : `Fit score: ${Math.round(Number(matchScore))}%`);
  }
  if (description) {
    lines.push(isDe ? `Beschreibung: ${description}` : `Description: ${description}`);
  }
  if (requiredSkills.length) {
    lines.push(
      isDe
        ? `Relevante Skills für die Rolle: ${requiredSkills.join(', ')}`
        : `Relevant skills for the role: ${requiredSkills.join(', ')}`
    );
  }
  if (skillGaps.length) {
    lines.push(
      isDe
        ? `Skill-Lücken (Systemhinweis): ${skillGaps.join(', ')}`
        : `Skill gaps (system hint): ${skillGaps.join(', ')}`
    );
  }
  if (recommendedActions.length) {
    lines.push(
      isDe
        ? `Mögliche Entwicklungsschritte (Systemhinweis): ${recommendedActions.join('; ')}`
        : `Possible development steps (system hint): ${recommendedActions.join('; ')}`
    );
  }
  if (progressionNotes.length) {
    lines.push(
      isDe
        ? `Typische Aufstiegswege (Systemhinweis): ${progressionNotes.join('; ')}`
        : `Typical progression routes (system hint): ${progressionNotes.join('; ')}`
    );
  }
  return lines.join('\n');
}

function formatUserContext(userContext = {}, lang = 'de') {
  const isDe = normalizeLang(lang) === 'de';
  const seniority = userContext.seniority && typeof userContext.seniority === 'object'
    ? userContext.seniority
    : {};

  const lines = [
    isDe
      ? '=== Bekanntes Nutzerprofil (NICHT erneut abfragen) ==='
      : '=== Known user profile (DO NOT ask again) ===',
    formatSeniorityContext(seniority, lang),
  ];

  const listFields = [
    [userContext.skills, isDe ? 'Skills' : 'Skills'],
    [userContext.skillsInDevelopment, isDe ? 'Skills in Entwicklung' : 'Skills in development'],
    [userContext.domains, isDe ? 'Domänen' : 'Domains'],
    [userContext.keyResponsibilities, isDe ? 'Zentrale Aufgaben' : 'Key responsibilities'],
    [userContext.interests, isDe ? 'Interessen' : 'Interests'],
  ];

  for (const [items, label] of listFields) {
    const normalized = normalizeStringList(items, 12);
    if (normalized.length) {
      lines.push(`${label}: ${normalized.join(', ')}`);
    }
  }

  const textFields = [
    [userContext.careerGoal, isDe ? 'Karriereziel' : 'Career goal'],
    [userContext.bio, isDe ? 'Bio' : 'Bio'],
    [userContext.workEnjoyMost, isDe ? 'Arbeit, die Freude macht' : 'Work they enjoy'],
    [userContext.naturallyGoodAt, isDe ? 'Natürliche Stärken' : 'Natural strengths'],
    [userContext.topicsIndustriesInterest, isDe ? 'Themen & Branchen' : 'Topics & industries'],
  ];

  for (const [value, label] of textFields) {
    const text = String(value || '').trim().slice(0, 300);
    if (text) lines.push(`${label}: ${text}`);
  }

  return lines.join('\n');
}

module.exports = {
  resolvePathPlanningAudience,
  formatRoleContext,
  formatUserContext,
};
