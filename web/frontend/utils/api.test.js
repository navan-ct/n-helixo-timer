import { describe, expect, it, vi } from "vitest";

import { mockFetch } from "../test/render";

import { ApiError, timersApi } from "./api";

describe("timersApi", () => {
  it("builds list query strings, skipping empty values", async () => {
    const fetchMock = mockFetch(() => [200, { timers: [] }]);
    await timersApi.list({ query: "", status: "active", sort: "name_asc", page: 2 });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/timers?status=active&sort=name_asc&page=2",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("sends JSON bodies", async () => {
    const fetchMock = mockFetch(() => [201, { timer: { id: "1" } }]);
    await expect(timersApi.create({ name: "Sale" })).resolves.toEqual({ timer: { id: "1" } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Sale" }),
    });
  });

  it("returns null for 204 responses", async () => {
    mockFetch(() => [204]);
    await expect(timersApi.remove("abc")).resolves.toBeNull();
  });

  it("raises ApiError with the server's details", async () => {
    mockFetch(() => [
      422,
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Some fields need your attention.",
          fields: { name: "Enter a timer name." },
          requestId: "req-1",
        },
      },
    ]);
    const error = await timersApi.update("abc", {}).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 422,
      code: "VALIDATION_FAILED",
      message: "Some fields need your attention.",
      fields: { name: "Enter a timer name." },
      requestId: "req-1",
    });
  });

  it("raises a friendly ApiError for network failures and unreadable responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(timersApi.list({})).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>", { status: 502 })));
    await expect(timersApi.list({})).rejects.toMatchObject({
      status: 502,
      message: "Something went wrong. Try again.",
    });
  });
});
