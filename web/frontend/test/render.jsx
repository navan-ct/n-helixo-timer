import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";

/** Renders `ui` with the providers the app uses. */
export function renderWithProviders(ui) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <MemoryRouter>
        <QueryClientProvider client={client}>{ui}</QueryClientProvider>
      </MemoryRouter>,
    ),
  };
}

/** Sets a Polaris field's value and dispatches the event React listens for. */
export function setFieldValue(element, value, eventType = "input") {
  element.value = value;
  element.dispatchEvent(new Event(eventType, { bubbles: true }));
}

/** Mocks `fetch` with a handler that receives (url, init) and returns [status, body]. */
export function mockFetch(handler) {
  const fetchMock = vi.fn(async (url, init = {}) => {
    const [status, body] = await handler(String(url), init);
    return new Response(status === 204 ? null : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
