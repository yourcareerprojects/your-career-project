import { useQuery } from 'react-query';
import { baseUILanguage } from './useProfileQueries';

/**
 * Debounced occupation search against GET /api/occupations/search.
 * @param {string} query – raw user input (caller should debounce)
 * @param {{ enabled?: boolean, limit?: number }} [options]
 */
export function useOccupationSearch(query, options = {}) {
  const { enabled = true, limit = 20 } = options;
  const lang = baseUILanguage();
  const trimmed = (query ?? '').toString().trim();
  const canSearch = trimmed.length >= 2;

  return useQuery(
    ['occupations', 'search', trimmed, lang, limit],
    async () => {
      const qs = new URLSearchParams({
        q: trimmed,
        limit: String(limit),
        lang,
      });
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
      keepPreviousData: true,
    }
  );
}
