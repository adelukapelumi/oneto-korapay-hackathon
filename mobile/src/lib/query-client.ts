import { QueryClient } from "@tanstack/react-query";

// Conservative defaults for a mobile app on flaky networks.
// - retry: 1 means we don't hammer the server on permanent errors.
// - staleTime: 30s means we don't refetch on every screen focus.
// - refetchOnWindowFocus is irrelevant on RN but explicit-off is clearer.
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
