const SESSION_PREFIX = 'careerPathPlanning:';

export function getCareerPathStepId(role) {
  const stepId = role?.stepId || role?.id;
  if (stepId != null && stepId !== '') return String(stepId);
  const title = role?.title;
  if (title != null && title !== '') {
    if (typeof title === 'object') {
      return String(title.en || title.de || Object.values(title)[0] || '').trim();
    }
    return String(title).trim();
  }
  return '';
}

export function normalizeEscoId(value) {
  return String(value || '').trim().toLowerCase();
}

/** Normalize a UI language to a stored plan language ('de' | 'en'). */
export function normalizeCareerPathLang(value) {
  return String(value || 'en').toLowerCase().split('-')[0] === 'de' ? 'de' : 'en';
}

/** Normalized escoId — the canonical per-role planning key. */
export function getCareerPathEscoKey(role) {
  return normalizeEscoId(role?.escoId);
}

/**
 * Canonical planning key for a role: escoId when available (so a plan is recognized
 * everywhere), otherwise falls back to the legacy stepId (local-only, no server plan).
 */
export function getCareerPathPlanKey(role) {
  return getCareerPathEscoKey(role) || getCareerPathStepId(role);
}

export function buildCareerPathPlanningPath({ stepId, savedSimulationId }) {
  const encoded = encodeURIComponent(stepId);
  if (savedSimulationId) {
    return `/saved-simulation/${savedSimulationId}/path/${encoded}`;
  }
  return `/simulation/path/${encoded}`;
}

export function storeCareerPathRoleSnapshot(stepId, role, meta = {}) {
  if (!stepId) return;
  try {
    localStorage.setItem(
      `${SESSION_PREFIX}role:${stepId}`,
      JSON.stringify({ role, meta, storedAt: Date.now() })
    );
  } catch {
    /* ignore quota errors */
  }
}

export function loadCareerPathRoleSnapshot(stepId) {
  if (!stepId) return null;
  try {
    const raw = localStorage.getItem(`${SESSION_PREFIX}role:${stepId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.role ? parsed : null;
  } catch {
    return null;
  }
}

export function storeCareerPathSession(stepId, snapshot) {
  if (!stepId) return;
  try {
    localStorage.setItem(`${SESSION_PREFIX}session:${stepId}`, JSON.stringify(snapshot));
  } catch {
    /* ignore */
  }
}

export function loadCareerPathSession(stepId) {
  if (!stepId) return null;
  try {
    const raw = localStorage.getItem(`${SESSION_PREFIX}session:${stepId}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearCareerPathSession(stepId) {
  if (!stepId) return;
  try {
    localStorage.removeItem(`${SESSION_PREFIX}session:${stepId}`);
  } catch {
    /* ignore */
  }
}

/**
 * Remove all stored career-path role snapshots and sessions.
 * Call on login/logout so durable localStorage plans don't leak across users.
 */
export function clearAllCareerPathPlanning() {
  try {
    if (typeof localStorage === 'undefined') return;
    const keys = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(SESSION_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* ignore */
  }
}

export function navigateToCareerPathPlanning({
  role,
  savedSimulationId,
  navigate,
  guardedNavigate,
  from,
}) {
  const key = getCareerPathPlanKey(role);
  if (!key) return;
  storeCareerPathRoleSnapshot(key, role, { savedSimulationId });
  const path = buildCareerPathPlanningPath({ stepId: key, savedSimulationId });
  // Capture where the user came from so the path page's back button can return
  // there instead of always defaulting to the ranking.
  const origin =
    from
    || (typeof window !== 'undefined'
      ? `${window.location.pathname}${window.location.search}`
      : '');
  const navigateFn = guardedNavigate || navigate;
  navigateFn(path, origin ? { state: { from: origin } } : undefined);
}

/** Find the persisted plan for a role key (escoId) in a specific language. */
export function findCareerPathPlan(plans, key, language) {
  const norm = normalizeEscoId(key);
  if (!norm || !Array.isArray(plans)) return null;
  const lang = normalizeCareerPathLang(language);
  return (
    plans.find(
      (plan) =>
        normalizeEscoId(plan?.escoId) === norm &&
        normalizeCareerPathLang(plan?.language) === lang
    ) || null
  );
}

/** Find any persisted plan for a role key (escoId), regardless of language. */
export function findCareerPathPlanAnyLang(plans, key) {
  const norm = normalizeEscoId(key);
  if (!norm || !Array.isArray(plans)) return null;
  return plans.find((plan) => normalizeEscoId(plan?.escoId) === norm) || null;
}

/** Upsert a generated plan server-side (keyed by escoId). Returns the saved record. */
export async function saveCareerPathPlanRemote({
  escoId,
  pathPlan,
  answers,
  audience,
  roleTitle,
  lang,
}) {
  const key = normalizeEscoId(escoId);
  if (!key) throw new Error('escoId is required to save a career path plan');
  const token = localStorage.getItem('token');
  const res = await fetch(`/api/profile/career-path-plans/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ pathPlan, answers, audience, roleTitle, lang }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || 'Failed to save career path plan');
  }
  return data.careerPathPlan;
}

/**
 * Delete persisted plan(s) for a role (keyed by escoId).
 * Pass a language to remove only that language; omit it to remove all languages.
 */
export async function deleteCareerPathPlanRemote(escoId, language) {
  const key = normalizeEscoId(escoId);
  if (!key) return;
  const token = localStorage.getItem('token');
  const query = language ? `?lang=${encodeURIComponent(normalizeCareerPathLang(language))}` : '';
  await fetch(`/api/profile/career-path-plans/${encodeURIComponent(key)}${query}`, {
    method: 'DELETE',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
}

/**
 * Warm career context enrichment while the user answers the questionnaire.
 * Fire-and-forget — failures are non-fatal.
 */
export async function prefetchCareerPathEnrichment({ role, lang }) {
  const token = localStorage.getItem('token');
  if (!token) return;
  const language = normalizeCareerPathLang(lang);
  try {
    await fetch(`/api/profile/career-path-coaching/prefetch?lang=${encodeURIComponent(language)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        role: buildCareerPathRolePayload(role),
        lang: language,
      }),
    });
  } catch {
    /* prefetch is best-effort */
  }
}

/**
 * Request a generated plan from the coaching endpoint in a specific language.
 * Used to (re)generate a plan for the current UI language from existing answers.
 */
export async function requestCareerPathPlan({ role, userContext, preferences, lang }) {
  const token = localStorage.getItem('token');
  const language = normalizeCareerPathLang(lang);
  const res = await fetch(`/api/profile/career-path-coaching?lang=${encodeURIComponent(language)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      role: buildCareerPathRolePayload(role),
      userContext,
      ...(preferences ? { preferences } : {}),
      lang: language,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.details || 'Career path planning request failed');
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Fetch the audience-aware questionnaire definition (question ids, types, options)
 * without triggering plan generation. Calling the coaching endpoint without
 * preferences returns the questionnaire payload, so this is a lightweight request
 * used to render the "adjust your answers" dropdowns on the overview.
 */
export async function requestCareerPathQuestionnaireConfig({ role, userContext, lang }) {
  const data = await requestCareerPathPlan({ role, userContext, lang });
  return {
    audience: data?.audience || null,
    questions: Array.isArray(data?.questions) ? data.questions.filter((q) => q?.id) : [],
  };
}

export function buildCareerPathUserContext(fullProfile) {
  const profile = fullProfile?.profile || fullProfile || {};
  const seniority = profile.seniority || profile.careerSimulationInputs?.seniority || {};
  const structured = profile.structuredUserInfo
    || profile.careerSimulationInputs?.structuredUserInfo
    || {};
  const identity = profile.userIdentity || profile.careerSimulationInputs?.userIdentity || {};

  const toList = (items) => (Array.isArray(items) ? items : [])
    .map((s) => String(s || '').trim())
    .filter(Boolean);

  const skills = [...new Set([
    ...toList(structured.skills),
    ...toList(structured.skillsInDevelopment),
  ])].slice(0, 20);

  return {
    seniority,
    skills,
    skillsInDevelopment: [...new Set(toList(structured.skillsInDevelopment))].slice(0, 12),
    domains: [...new Set(toList(structured.domains))].slice(0, 10),
    keyResponsibilities: [...new Set(toList(structured.keyResponsibilities))].slice(0, 10),
    interests: [...new Set(toList(identity.interests))].slice(0, 10),
    bio: identity.bio || '',
    careerGoal: identity.careerGoal || '',
    workEnjoyMost: identity.workEnjoyMost || '',
    naturallyGoodAt: identity.naturallyGoodAt || '',
    topicsIndustriesInterest: identity.topicsIndustriesInterest || '',
  };
}

export function buildCareerPathRolePayload(role) {
  if (!role || typeof role !== 'object') return {};

  const keyResponsibilities = Array.isArray(role.keyResponsibilities)
    ? role.keyResponsibilities
    : (Array.isArray(role.keyResponsibilities?.responsibilities)
      ? role.keyResponsibilities.responsibilities
      : undefined);

  return {
    title: role.title,
    description: role.description,
    matchScore: role.matchScore ?? role.score ?? null,
    skillGaps: role.skillGaps,
    recommendedActions: role.recommendedActions,
    progressionNotes: role.progressionNotes,
    requiredSkills: role.requiredSkills,
    keyResponsibilities,
    skillDomains: role.skillDomains,
    seniority: role.seniority,
    escoId: role.escoId,
    careerPathId: role.careerPathId ?? role._id,
    iscoGroup: role.iscoGroup,
    altTitles: role.altTitles,
    category: role.category ?? role.listCategory,
  };
}
