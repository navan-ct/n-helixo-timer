import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { timersApi } from "../utils/api";

import { analyticsQueryKey } from "./useAnalytics";

export const timersQueryKey = (params) => ["timers", params];

/** Timer changes show in the lists and in the home page's counts. */
function invalidateTimerData(queryClient) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["timers"] }),
    queryClient.invalidateQueries({ queryKey: analyticsQueryKey }),
  ]);
}

/** @param {{ query: string, status: string, sort: string, page: number }} params */
export function useTimerList(params) {
  return useQuery({
    queryKey: timersQueryKey(params),
    queryFn: ({ signal }) => timersApi.list(params, { signal }),
    placeholderData: keepPreviousData,
    // Statuses depend on the current time and impressions keep coming in, so
    // refresh them periodically.
    refetchInterval: 60_000,
  });
}

/** Creates a timer, or updates one when `id` is passed. */
export function useSaveTimer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }) =>
      id ? timersApi.update(id, payload) : timersApi.create(payload),
    onSuccess: () => invalidateTimerData(queryClient),
  });
}

export function useDeleteTimer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id) => timersApi.remove(id),
    onSuccess: () => invalidateTimerData(queryClient),
  });
}
