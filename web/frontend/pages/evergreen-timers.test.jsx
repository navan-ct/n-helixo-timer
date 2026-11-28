import { act, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mockFetch, renderWithProviders, setFieldValue } from "../test/render";

import EvergreenTimersPage from "./evergreen-timers";

function apiTimer(overrides = {}) {
  return {
    id: "e1",
    type: "evergreen",
    name: "Welcome offer",
    description: "10% off your first order",
    durationMinutes: 24 * 60 + 90,
    color: "#2c6ecb",
    size: "medium",
    urgency: "color_pulse",
    target: { type: "all", resources: [] },
    status: "active",
    impressions: 8732,
    ...overrides,
  };
}

function listResponse(timers) {
  return {
    timers,
    pageInfo: {
      page: 1,
      pageSize: 20,
      total: timers.length,
      hasPreviousPage: false,
      hasNextPage: false,
    },
  };
}

describe("EvergreenTimersPage", () => {
  it("lists evergreen timers with their duration instead of a schedule", async () => {
    const fetchMock = mockFetch(() => [200, listResponse([apiTimer()])]);
    const { container } = renderWithProviders(<EvergreenTimersPage />);

    expect(await screen.findByText("Welcome offer")).toBeInTheDocument();
    expect(container.querySelector("s-page")).toHaveAttribute("heading", "Evergreen Timers");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/timers?type=evergreen&sort=created_desc&page=1",
      expect.anything(),
    );

    const table = within(container.querySelector("s-table"));
    expect(table.getByText("1 day, 1 hour, 30 minutes")).toBeInTheDocument();
    expect(table.getByText("All products")).toBeInTheDocument();
    const headers = [...container.querySelectorAll("s-table-header")].map((h) => h.textContent);
    expect(headers).toEqual(["Timer", "Applies to", "Duration", "Impressions", "Actions"]);
    expect(table.getByText("8,732")).toBeInTheDocument();
    // Every evergreen timer is running, so there's no status to show or filter by.
    expect(container.querySelector("s-badge")).toBeNull();
    expect(container.querySelectorAll('[slot="filters"] s-select')).toHaveLength(1);
  });

  it("offers sorting by duration", async () => {
    const fetchMock = mockFetch(() => [200, listResponse([apiTimer()])]);
    const { container } = renderWithProviders(<EvergreenTimersPage />);
    await screen.findByText("Welcome offer");

    const sortSelect = container.querySelector('[slot="filters"] s-select');
    const options = [...sortSelect.querySelectorAll("s-option")].map((o) => o.textContent);
    expect(options).toEqual([
      "Newest first",
      "Duration (shortest)",
      "Duration (longest)",
      "Name (A–Z)",
      "Name (Z–A)",
    ]);

    await act(async () => setFieldValue(sortSelect, "duration_asc", "change"));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/timers?type=evergreen&sort=duration_asc&page=1",
        expect.anything(),
      ),
    );
  });

  it("shows an evergreen empty state before any timers exist", async () => {
    mockFetch(() => [200, listResponse([])]);
    const { container } = renderWithProviders(<EvergreenTimersPage />);

    await waitFor(() =>
      expect(container.querySelector("s-empty-state")).toHaveAttribute(
        "heading",
        "No evergreen timers yet",
      ),
    );
    expect(container.querySelector('s-empty-state > s-icon[slot="graphic"]')).toHaveAttribute(
      "type",
      "clock",
    );
  });

  it("creates evergreen timers from the page", async () => {
    mockFetch(() => [200, listResponse([apiTimer()])]);
    const { container } = renderWithProviders(<EvergreenTimersPage />);
    await screen.findByText("Welcome offer");

    await act(async () => container.querySelector('s-page > [slot="primary-action"]').click());

    const modal = container.querySelector("#timer-form-modal");
    expect(modal).toHaveAttribute("heading", "Create evergreen timer");
    expect(modal.querySelector('[data-field="durationHours"]')).not.toBeNull();
    expect(modal.querySelector('[data-field="endDate"]')).toBeNull();
  });

  it("edits a timer in the evergreen form", async () => {
    mockFetch(() => [200, listResponse([apiTimer()])]);
    const { container } = renderWithProviders(<EvergreenTimersPage />);

    await act(async () => (await screen.findByText("Welcome offer")).click());

    const modal = container.querySelector("#timer-form-modal");
    expect(modal).toHaveAttribute("heading", "Edit evergreen timer");
    expect(modal.querySelector('[data-field="durationDays"]')).toHaveAttribute("value", "1");
    expect(modal.querySelector('[data-field="durationHours"]')).toHaveAttribute("value", "1");
    expect(modal.querySelector('[data-field="durationMinutes"]')).toHaveAttribute("value", "30");
  });
});
