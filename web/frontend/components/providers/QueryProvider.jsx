import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

/**
 * Sets up the React Query client.
 * @see https://tanstack.com/query/latest/docs/framework/react/reference/QueryClientProvider
 */
export function QueryProvider({ children }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Retry transient failures, but not client errors such as 4xx responses.
            retry: (failureCount, error) =>
              failureCount < 2 && !(error?.status >= 400 && error?.status < 500),
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
