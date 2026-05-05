import { baseUILanguage } from '../hooks/useProfileQueries';

/**
 * `?lang=` for `/api/profile/*` so `req.resolvedLanguage` matches the UI (e.g. which slot to save a string in).
 * Delegates to `baseUILanguage()` so it stays aligned with React Query profile keys.
 * @returns {string} e.g. `lang=de` (no leading `?`)
 */
export function getProfileApiLangQuery() {
  return `lang=${encodeURIComponent(baseUILanguage())}`;
}
