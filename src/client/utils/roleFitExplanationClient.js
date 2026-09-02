import axios from 'axios';
import { getEvalQueue } from './evaluationFlowModel';
import { getSimulationRoleKey } from './simulationRoleKey';

let cacheEpoch = 0;
let prefetchGeneration = 0;
/** @type {Map<string, { status: 'pending' | 'ready' | 'error', bullets: string[] }>} */
const cache = new Map();
/** @type {Map<string, Promise<object>>} */
const inflight = new Map();
/** @type {Map<string, Set<(entry: object|null) => void>>} */
const listeners = new Map();
/** @type {null | ((payload: object) => Promise<object>)} */
let postImpl = null;

export function normalizeRoleFitLang(i18nOrLang) {
  if (i18nOrLang && typeof i18nOrLang === 'object') {
    const raw = i18nOrLang.resolvedLanguage || i18nOrLang.language || 'en';
    return String(raw).toLowerCase().split('-')[0] || 'en';
  }
  return String(i18nOrLang || 'en').toLowerCase().split('-')[0] || 'en';
}

/**
 * Stable identity for cache + in-flight dedupe. Must not follow object identity of `stepDetails`.
 */
export function buildRoleFitRequestKey(stepDetails, simulationScopeId, lang) {
  const roleKey = getSimulationRoleKey(stepDetails);
  if (!roleKey) return '';
  const scope = String(simulationScopeId || stepDetails?.simulationId || '').trim() || 'local';
  const language = normalizeRoleFitLang(lang);
  return `${roleKey}::${scope}::${language}`;
}

export function setRoleFitExplanationPoster(fn) {
  postImpl = typeof fn === 'function' ? fn : null;
}

export function getRoleFitExplanationEntry(requestKey) {
  if (!requestKey) return null;
  return cache.get(requestKey) || null;
}

export function isRoleFitExplanationSettled(entry) {
  return entry?.status === 'ready' || entry?.status === 'error';
}

function notify(requestKey) {
  const set = listeners.get(requestKey);
  if (!set) return;
  const entry = cache.get(requestKey) || null;
  set.forEach((listener) => {
    try {
      listener(entry);
    } catch {
      /* ignore subscriber errors */
    }
  });
}

export function subscribeRoleFitExplanation(requestKey, listener) {
  if (!requestKey || typeof listener !== 'function') return () => {};
  if (!listeners.has(requestKey)) listeners.set(requestKey, new Set());
  listeners.get(requestKey).add(listener);
  return () => {
    const set = listeners.get(requestKey);
    if (!set) return;
    set.delete(listener);
    if (set.size === 0) listeners.delete(requestKey);
  };
}

function writeEntry(requestKey, entry) {
  cache.set(requestKey, entry);
  notify(requestKey);
}

function getAuthToken() {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
}

async function defaultPostRoleFitExplanation({ role, simulationScopeId, language }) {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Not authenticated');
  }
  const { data } = await axios.post(
    '/api/profile/role-fit-explanation',
    {
      language,
      role,
      simulationScopeId: simulationScopeId || undefined,
    },
    {
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  return data;
}

/**
 * Fetch-or-reuse a role-fit explanation. Concurrent callers share one in-flight request.
 */
export async function ensureRoleFitExplanation({
  role,
  simulationScopeId = null,
  language = 'en',
} = {}) {
  const lang = normalizeRoleFitLang(language);
  const requestKey = buildRoleFitRequestKey(role, simulationScopeId, lang);
  if (!requestKey) {
    return { requestKey: '', status: 'error', bullets: [] };
  }

  const existing = cache.get(requestKey);
  if (isRoleFitExplanationSettled(existing)) {
    return { requestKey, ...existing };
  }
  if (inflight.has(requestKey)) {
    return inflight.get(requestKey);
  }

  const epochAtStart = cacheEpoch;
  writeEntry(requestKey, { status: 'pending', bullets: Array.isArray(existing?.bullets) ? existing.bullets : [] });

  const promise = (async () => {
    try {
      const poster = postImpl || defaultPostRoleFitExplanation;
      const data = await poster({ role, simulationScopeId, language: lang });
      const bullets = Array.isArray(data?.bullets)
        ? data.bullets.map((b) => String(b || '').trim()).filter(Boolean)
        : [];
      const entry = { status: data?.success === false ? 'error' : 'ready', bullets };
      if (epochAtStart !== cacheEpoch) {
        return { requestKey, status: 'error', bullets: [] };
      }
      writeEntry(requestKey, entry);
      return { requestKey, ...entry };
    } catch {
      const entry = { status: 'error', bullets: [] };
      if (epochAtStart !== cacheEpoch) {
        return { requestKey, status: 'error', bullets: [] };
      }
      writeEntry(requestKey, entry);
      return { requestKey, ...entry };
    } finally {
      if (inflight.get(requestKey) === promise) {
        inflight.delete(requestKey);
      }
    }
  })();

  inflight.set(requestKey, promise);
  return promise;
}

/** Unevaluated next-step roles first, then unevaluated outside-the-box roles. */
export function collectEvaluationRolesForPrefetch(evaluationFlow) {
  if (!evaluationFlow || typeof evaluationFlow !== 'object') return [];
  const next = getEvalQueue(evaluationFlow, 'nextSteps').filter((role) => role && role.userEvaluation == null);
  const ootb = getEvalQueue(evaluationFlow, 'outsideTheBox').filter((role) => role && role.userEvaluation == null);
  return [...next, ...ootb];
}

export function cancelRoleFitPrefetch() {
  prefetchGeneration += 1;
}

export function prefetchRoleFitExplanations({
  roles,
  simulationScopeId = null,
  language = 'en',
} = {}) {
  const generation = ++prefetchGeneration;
  const list = Array.isArray(roles) ? roles.filter(Boolean) : [];
  return (async () => {
    for (const role of list) {
      if (generation !== prefetchGeneration) return;
      await ensureRoleFitExplanation({ role, simulationScopeId, language });
    }
  })();
}

export function prefetchRoleFitExplanationsForEvaluation({
  evaluationFlow,
  simulationScopeId = null,
  language = 'en',
} = {}) {
  return prefetchRoleFitExplanations({
    roles: collectEvaluationRolesForPrefetch(evaluationFlow),
    simulationScopeId,
    language,
  });
}

export function clearRoleFitExplanationCache() {
  cacheEpoch += 1;
  prefetchGeneration += 1;
  cache.clear();
  inflight.clear();
}
