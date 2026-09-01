import { useEffect, useRef } from 'react';
import { useQuery } from 'react-query';
import { baseUILanguage } from './useProfileQueries';

/**
 * Occupation search against GET /api/occupations/search.
 * @param {string} query – raw user input (caller should debounce)
 * @param {{ enabled?: boolean, limit?: number, domain?: string|null }} [options]
 *   `domain` – English taxonomy label (e.g. "Software"); filters CareerPath.domain
 */
export function useOccupationSearch(query, options = {}) {
  const { enabled = true, limit = 20, domain = null } = options;
  const lang = baseUILanguage();
  const trimmed = (query ?? '').toString().trim();
  const domainFilter = typeof domain === 'string' && domain.trim() ? domain.trim() : null;
  const canSearch = trimmed.length >= 2 || Boolean(domainFilter);
  const useUnlimitedDomainBrowse = Boolean(domainFilter) && trimmed.length < 2;

  // Drop stale rows when a filter is cleared/changed so results match the active fields.
  const prevDomainRef = useRef(domainFilter || '');
  const prevQueryRef = useRef(trimmed);
  const domainChanged = prevDomainRef.current !== (domainFilter || '');
  const queryCleared = prevQueryRef.current.length >= 2 && trimmed.length < 2;
  useEffect(() => {
    prevDomainRef.current = domainFilter || '';
    prevQueryRef.current = trimmed;
  }, [domainFilter, trimmed]);

  return useQuery(
    ['occupations', 'search', trimmed, lang, useUnlimitedDomainBrowse ? 'all' : limit, domainFilter || ''],
    async () => {
      const qs = new URLSearchParams({ lang });
      if (!useUnlimitedDomainBrowse) qs.set('limit', String(limit));
      if (trimmed.length >= 2) qs.set('q', trimmed);
      if (domainFilter) qs.set('domain', domainFilter);

      const res = await fetch(`/api/occupations/search?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Search failed');
      }
      return data.results || [];
    },
    {
      enabled: enabled && canSearch,
      staleTime: 30_000,
      keepPreviousData: canSearch && !domainChanged && !queryCleared,
    }
  );
}

/**
 * Full occupation/role lookup against GET /api/occupations/lookup.
 * @param {{
 *   escoId?: string|null,
 *   careerPathId?: string|null,
 *   enabled?: boolean,
 * }} [options]
 */
export function useOccupationLookupQuery(options = {}) {
  const { escoId = null, careerPathId = null, enabled = true } = options;
  const lang = baseUILanguage();
  const esco = typeof escoId === 'string' && escoId.trim() ? escoId.trim() : '';
  const pathId =
    typeof careerPathId === 'string' && careerPathId.trim() ? careerPathId.trim() : '';
  const canLookup = Boolean(esco || pathId);

  return useQuery(
    ['occupations', 'lookup', esco || pathId, lang],
    async () => {
      const qs = new URLSearchParams({ lang });
      if (esco) qs.set('escoId', esco);
      else qs.set('careerPathId', pathId);

      const res = await fetch(`/api/occupations/lookup?${qs.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success || !data.occupation) {
        throw new Error(data.error || 'Role lookup failed');
      }
      return { ...data.occupation, _localizedLang: lang };
    },
    {
      enabled: enabled && canLookup,
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    }
  );
}
