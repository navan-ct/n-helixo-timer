import { act, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { mockFetch, renderWithProviders, setFieldValue } from "../../test/render";

import { TimerFormModal } from "./TimerFormModal";

const TIME_ZONE = "America/New_York";

function renderModal(props = {}) {
  const onClose = vi.fn();
  const utils = renderWithProviders(
    <TimerFormModal open formKey={1} timeZone={TIME_ZONE} onClose={onClose} {...props} />,
  );
  const modal = utils.container.querySelector("s-modal");
  const field = (name) => modal.querySelector(`[data-field="${name}"]`);
  const primaryAction = () => modal.querySelector('[slot="primary-action"]');
  return { ...utils, modal, field, primaryAction, onClose };
}

async function fillValidForm(field) {
  await act(async () => {
    setFieldValue(field("name"), "Black Friday Sale");
    setFieldValue(field("endDate"), "2099-11-30", "change");
    setFieldValue(field("endTime"), "11:59 pm");
  });
}

describe("TimerFormModal", () => {
  it("renders an empty create form", () => {
    const { modal, field, primaryAction } = renderModal();

    expect(modal).toHaveAttribute("heading", "Create new timer");
    expect(field("name")).toHaveAttribute("label", "Timer name");
    expect(field("name")).toHaveAttribute("required");
    expect(field("name")).toHaveAttribute("value", "");
    expect(primaryAction()).toHaveTextContent("Create timer");
    expect(screen.getByText(/Times are in your store’s time zone/)).toHaveTextContent(
      "America/New_York",
    );
  });

  it("shows field errors instead of submitting an invalid form", async () => {
    const fetchMock = mockFetch(() => [201, {}]);
    const { modal, field, primaryAction } = renderModal();

    await act(async () => primaryAction().click());

    expect(field("name")).toHaveAttribute("error", "Enter a timer name.");
    expect(field("endDate")).toHaveAttribute("error", "Enter an end date.");
    expect(field("endTime")).toHaveAttribute("error", "Enter an end time.");
    expect(modal.querySelector("s-banner")).toHaveAttribute(
      "heading",
      "Fix 3 errors to save this timer",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("clears an error once the field is fixed", async () => {
    const { field, primaryAction } = renderModal();
    await act(async () => primaryAction().click());

    await act(async () => setFieldValue(field("name"), "Flash sale"));

    expect(field("name")).not.toHaveAttribute("error");
  });

  it("normalizes typed times when the field loses focus", async () => {
    const { field } = renderModal();
    await act(async () => setFieldValue(field("endTime"), "2130"));
    await act(async () => {
      field("endTime").dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    // Once a value is typed, React updates the element's `value` property.
    expect(field("endTime").value).toBe("9:30 PM");
  });

  it("creates a timer and closes", async () => {
    const fetchMock = mockFetch(() => [201, { timer: { id: "t1" } }]);
    const { field, primaryAction, onClose } = renderModal();

    await fillValidForm(field);
    await act(async () => primaryAction().click());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/timers");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      name: "Black Friday Sale",
      description: "",
      startDate: null,
      startTime: null,
      endDate: "2099-11-30",
      endTime: "23:59",
      color: "#008060",
      size: "medium",
      urgency: "color_pulse",
      target: { type: "all", resourceIds: [] },
    });
    expect(window.shopify.toast.show).toHaveBeenCalledWith("Timer created");
  });

  it("shows server validation errors on the matching fields", async () => {
    mockFetch(() => [
      422,
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "Some fields need your attention.",
          fields: { endTime: "End must be in the future." },
        },
      },
    ]);
    const { field, primaryAction, onClose } = renderModal();

    await fillValidForm(field);
    await act(async () => primaryAction().click());

    await waitFor(() =>
      expect(field("endTime")).toHaveAttribute("error", "End must be in the future."),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("shows a banner when saving fails for another reason", async () => {
    mockFetch(() => [
      502,
      { error: { code: "SHOPIFY_REQUEST_FAILED", message: "Shopify is unavailable." } },
    ]);
    const { modal, field, primaryAction } = renderModal();

    await fillValidForm(field);
    await act(async () => primaryAction().click());

    await waitFor(() =>
      expect(modal.querySelector("s-banner")).toHaveAttribute("heading", "Shopify is unavailable."),
    );
  });

  it("selects specific products with the resource picker", async () => {
    window.shopify.resourcePicker.mockResolvedValue([
      {
        id: "gid://shopify/Product/1",
        title: "Snowboard",
        handle: "snowboard",
        images: [{ originalSrc: "https://cdn/board.png", altText: "" }],
      },
    ]);
    const fetchMock = mockFetch(() => [201, { timer: { id: "t1" } }]);
    const { modal, field, primaryAction } = renderModal();

    const choiceList = modal.querySelector("s-choice-list");
    await act(async () => {
      choiceList.values = ["products"];
      choiceList.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const browse = [...modal.querySelectorAll("s-button")].find(
      (button) => button.textContent === "Browse",
    );
    await act(async () => browse.click());

    expect(window.shopify.resourcePicker).toHaveBeenCalledWith(
      expect.objectContaining({ type: "product", action: "select", multiple: 100 }),
    );
    expect(await screen.findByText("Snowboard")).toBeInTheDocument();
    expect(screen.getByText("1 product selected")).toBeInTheDocument();

    await fillValidForm(field);
    await act(async () => primaryAction().click());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).target).toEqual({
      type: "products",
      resourceIds: ["gid://shopify/Product/1"],
    });
  });

  it("requires a selection when targeting specific collections", async () => {
    const { modal, field, primaryAction } = renderModal();
    const choiceList = modal.querySelector("s-choice-list");
    await act(async () => {
      choiceList.values = ["collections"];
      choiceList.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await fillValidForm(field);
    await act(async () => primaryAction().click());

    expect(modal.querySelector("s-search-field")).toHaveAttribute(
      "error",
      "Select at least one collection.",
    );
  });

  it("prefills the form when editing and saves with PUT", async () => {
    const timer = {
      id: "t9",
      name: "Summer sale",
      description: "Up to 30% off",
      schedule: {
        startDate: "2099-06-01",
        startTime: "09:00",
        endDate: "2099-06-30",
        endTime: "18:00",
      },
      color: "#ff6600",
      size: "large",
      urgency: "shake",
      target: { type: "all", resources: [] },
    };
    const fetchMock = mockFetch(() => [200, { timer }]);
    const { modal, field, primaryAction } = renderModal({ timer });

    expect(modal).toHaveAttribute("heading", "Edit timer");
    expect(field("name")).toHaveAttribute("value", "Summer sale");
    expect(field("startTime")).toHaveAttribute("value", "9:00 AM");
    expect(primaryAction()).toHaveTextContent("Save");

    await act(async () => primaryAction().click());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/timers/t9");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toMatchObject({
      name: "Summer sale",
      startTime: "09:00",
      endTime: "18:00",
      size: "large",
      urgency: "shake",
    });
    expect(JSON.parse(init.body)).not.toHaveProperty("position");
  });
});
