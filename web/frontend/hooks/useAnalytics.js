import { useQuery } from "@tanstack/react-query";

import { analyticsApi } from "../utils/api";

export const analyticsQueryKey = ["analytics"];

/**
 * The home page's analytics. Impressions arrive continuously (the server
 * writes them in batches every few seconds), so they're refreshed every minute.
 */
export function useAnalytics() {
  return useQuery({
    queryKey: analyticsQueryKey,
    queryFn: ({ signal }) => analyticsApi.summary({ signal }),
    refetchInterval: 60_000,
  });
}
