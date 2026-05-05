import { QueryClient } from 'react-query';

/**
 * Shared QueryClient for the SPA. Imported imperatively (e.g. AuthContext) for clear/invalidate.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false
    }
  }
});
