import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mockFetch, renderWithProviders, setFieldValue } from "../test/render";

import TimersPage from "./index";

function apiTimer(overrides = {}) {
  return {
    id: "t1",
    name: "Black Friday Sale",
    description: "50% off all products",
    startsAt: "2026-11-29T05:00:00.000Z",
    endsAt: "2026-12-01T04:59:00.000Z",
    timezone: "America/New_York",
    schedule: {
      startDate: "2026-11-29",
      startTime: "00:00",
      endDate: "2026-11-30",
      endTime: "23:59",
    },
    color: "#008060",
    size: "medium",
    position: "top",
    urgency: "color_pulse",
    target: { type: "products", resources: [{ id: "p1", title: "Snowboard" }] },
    status: "scheduled",
    ...overrides,
  };
}

function listResponse(timers, pageInfo = {}) {
  return {
    timers,
    pageInfo: {
      page: 1,
      pageSize: 20,
      total: timers.length,
      hasPreviousPage: false,
      hasNextPage: false,
      ...pageInfo,
    },
    timezone: "America/New_York",
  };
}

describe("TimersPage", () => {
  it("lists timers with their status, targets and schedule", async () => {
    mockFetch(() => [200, listResponse([apiTimer()])]);
    const { container } = renderWithProviders(<TimersPage />);

    expect(await screen.findByText("Black Friday Sale")).toBeInTheDocument();
    expect(container.querySelector("s-badge")).toHaveTextContent("Scheduled");
    expect(container.querySelector("s-badge")).toHaveAttribute("tone", "info");
    expect(screen.getByText("1 product")).toBeInTheDocument();
    expect(screen.getByText("Nov 29, 2026, 12:00 AM")).toBeInTheDocument();
    expect(screen.getByText("Nov 30, 2026, 11:59 PM")).toBeInTheDocument();
  });

  it("shows an empty state before any timers exist", async () => {
    mockFetch(() => [200, listResponse([])]);
    const { container } = renderWithProviders(<TimersPage />);

    await waitFor(() =>
      expect(container.querySelector("s-empty-state")).toHaveAttribute(
        "heading",
        "Create your first countdown timer",
      ),
    );
    expect(container.querySelector("s-table")).toBeNull();
  });

  it("sends search, filter and sort to the API", async () => {
    const fetchMock = mockFetch(() => [200, listResponse([apiTimer()])]);
    const { container } = renderWithProviders(<TimersPage />);
    await screen.findByText("Black Friday Sale");

    const [statusSelect, sortSelect] = container.querySelectorAll('[slot="filters"] s-select');
    await act(async () => {
      setFieldValue(container.querySelector("s-search-field"), "friday");
      setFieldValue(statusSelect, "scheduled", "change");
      setFieldValue(sortSelect, "name_asc", "change");
    });

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/timers?query=friday&status=scheduled&sort=name_asc&page=1",
        expect.anything(),
      ),
    );
  });

  it("explains when filters match nothing", async () => {
    mockFetch((url) => [200, listResponse(url.includes("query=") ? [] : [apiTimer()])]);
    const { container } = renderWithProviders(<TimersPage />);
    await screen.findByText("Black Friday Sale");

    await act(async () => setFieldValue(container.querySelector("s-search-field"), "nothing"));

    expect(await screen.findByText("No timers found")).toBeInTheDocument();
    expect(screen.getByText("Clear search and filters")).toBeInTheDocument();
  });

  it("pages through results", async () => {
    const fetchMock = mockFetch((url) => [
      200,
      listResponse([apiTimer()], { total: 25, hasNextPage: !url.includes("page=2") }),
    ]);
    const { container } = renderWithProviders(<TimersPage />);
    await screen.findByText("Black Friday Sale");

    const table = container.querySelector("s-table");
    expect(table).toHaveAttribute("hasNextPage");
    await act(async () => table.dispatchEvent(new Event("nextpage")));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/timers?status=all&sort=created_desc&page=2",
        expect.anything(),
      ),
    );
  });

  it("shows an error banner with a retry when loading fails", async () => {
    mockFetch(() => [500, { error: { message: "Database unavailable" } }]);
    renderWithProviders(<TimersPage />);

    expect(await screen.findByText("Database unavailable")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it("deletes a timer after confirmation", async () => {
    let deleted = false;
    const fetchMock = mockFetch((url, init) => {
      if (init.method === "DELETE") {
        deleted = true;
        return [204];
      }
      return [200, listResponse(deleted ? [] : [apiTimer()])];
    });
    const { container } = renderWithProviders(<TimersPage />);
    await screen.findByText("Black Friday Sale");

    const deleteAction = [...container.querySelectorAll("s-menu s-button")].find(
      (button) => button.textContent === "Delete",
    );
    await act(async () => deleteAction.click());

    const confirmModal = container.querySelector("#delete-timer-modal");
    expect(confirmModal).toHaveTextContent("“Black Friday Sale” will stop showing on your store.");

    await act(async () => confirmModal.querySelector('[slot="primary-action"]').click());

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/timers/t1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() => expect(window.shopify.toast.show).toHaveBeenCalledWith("Timer deleted"));
  });
});
