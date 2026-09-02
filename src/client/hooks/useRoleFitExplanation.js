import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  buildRoleFitRequestKey,
  ensureRoleFitExplanation,
  getRoleFitExplanationEntry,
  isRoleFitExplanationSettled,
  normalizeRoleFitLang,
  subscribeRoleFitExplanation,
} from '../utils/roleFitExplanationClient';

/**
 * Shared cache + fetch for "Why this role fits you". Safe to call from cards and prefetch.
 */
export function useRoleFitExplanation(role, simulationScopeId, options = {}) {
  const { i18n } = useTranslation();
  const enabled = options.enabled !== false && Boolean(role);
  const lang = normalizeRoleFitLang(i18n);
  const roleRef = useRef(role);
  roleRef.current = role;

  const requestKey = useMemo(
    () => (enabled ? buildRoleFitRequestKey(role, simulationScopeId, lang) : ''),
    [
      enabled,
      lang,
      simulationScopeId,
      role?.escoId,
      role?.careerPathId,
      role?._id,
      role?.id,
      role?.stepId,
      role?.instanceId,
      role?.simulationId,
    ]
  );

  const [entry, setEntry] = useState(() => getRoleFitExplanationEntry(requestKey));

  useEffect(() => {
    if (!enabled || !requestKey) {
      setEntry(null);
      return undefined;
    }

    setEntry(getRoleFitExplanationEntry(requestKey));
    const unsubscribe = subscribeRoleFitExplanation(requestKey, setEntry);
    ensureRoleFitExplanation({
      role: roleRef.current,
      simulationScopeId,
      language: lang,
    });
    return unsubscribe;
  }, [enabled, requestKey, lang, simulationScopeId]);

  const settled = isRoleFitExplanationSettled(entry);
  return {
    requestKey,
    bullets: Array.isArray(entry?.bullets) ? entry.bullets : [],
    status: entry?.status || (enabled ? 'pending' : 'idle'),
    isSettled: settled,
    isReady: entry?.status === 'ready',
    isLoading: Boolean(enabled && !settled),
  };
}
