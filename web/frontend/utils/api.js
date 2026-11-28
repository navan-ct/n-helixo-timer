/**
 * Minimal JSON client for the app's backend. App Bridge patches `fetch` in the
 * embedded admin to attach a session token to same-origin requests.
 */

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status, or 0 when the request never reached the server
   * @param {{ code?: string, message?: string, fields?: Record<string, string>, requestId?: string }} [details]
   */
  constructor(status, details = {}) {
    super(details.message || "Something went wrong. Please try again.");
    this.name = "ApiError";
    this.status = status;
    this.code = details.code ?? "UNKNOWN_ERROR";
    this.fields = details.fields ?? {};
    this.requestId = details.requestId;
  }
}

async function request(path, { method = "GET", body, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method,
      signal,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    throw new ApiError(0, {
      code: "NETWORK_ERROR",
      message: "Couldn’t reach the server. Check your connection and try again.",
    });
  }

  if (response.status === 204) return null;

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, data?.error);
  }
  return data;
}

export const timersApi = {
  /** @param {{ query?: string, status?: string, sort?: string, page?: number }} params */
  list(params, { signal } = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== "") search.set(key, String(value));
    }
    const qs = search.toString();
    return request(`/api/timers${qs ? `?${qs}` : ""}`, { signal });
  },
  create(payload) {
    return request("/api/timers", { method: "POST", body: payload });
  },
  update(id, payload) {
    return request(`/api/timers/${encodeURIComponent(id)}`, { method: "PUT", body: payload });
  },
  remove(id) {
    return request(`/api/timers/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

export const analyticsApi = {
  /** Impressions, timer counts and the Timer block's status, for the home page. */
  summary({ signal } = {}) {
    return request("/api/analytics", { signal });
  },
};
