import { describe, expect, it } from "vitest";

import {
  createEmptyForm,
  formFromTimer,
  mapServerFieldErrors,
  readableTextColor,
  resourcesFromPicker,
  toTimerPayload,
  validateTimerForm,
} from "./timerForm";

const TIME_ZONE = "America/New_York";
// 2026-11-27 07:00 in New York.
const NOW = new Date("2026-11-27T12:00:00Z");

function validForm(overrides = {}) {
  return {
    ...createEmptyForm(),
    name: "Black Friday",
    startDate: "2026-11-29",
    startTime: "12:00 AM",
    endDate: "2026-11-30",
    endTime: "11:59 PM",
    ...overrides,
  };
}

const validate = (form, context = {}) =>
  validateTimerForm(form, { timeZone: TIME_ZONE, now: NOW, ...context });

describe("validateTimerForm", () => {
  it("accepts a complete form", () => {
    expect(validate(validForm())).toEqual({});
  });

  it("requires a name, end date and end time", () => {
    expect(validate(createEmptyForm())).toEqual({
      name: "nameRequired",
      endDate: "endDateRequired",
      endTime: "endTimeRequired",
    });
  });

  it("allows a blank start, but not half of one", () => {
    expect(validate(validForm({ startDate: "", startTime: "" }))).toEqual({});
    expect(validate(validForm({ startTime: "" }))).toEqual({ startTime: "startTimeRequired" });
    expect(validate(validForm({ startDate: "" }))).toEqual({ startDate: "startDateRequired" });
  });

  it("flags unreadable times", () => {
    expect(validate(validForm({ endTime: "late" }))).toEqual({ endTime: "timeInvalid" });
  });

  it("requires the end to be after the start", () => {
    expect(validate(validForm({ endDate: "2026-11-28" }))).toEqual({ endDate: "endBeforeStart" });
    expect(validate(validForm({ endDate: "2026-11-29", endTime: "12:00 AM" }))).toEqual({
      endTime: "endBeforeStart",
    });
  });

  it("requires the end to be in the future in the shop's time zone", () => {
    // 06:59 in New York is already past at 07:00 New York time.
    expect(
      validate(validForm({ startDate: "", startTime: "", endDate: "2026-11-27", endTime: "6:59" })),
    ).toEqual({ endTime: "endInPast" });
    expect(
      validate(validForm({ startDate: "", startTime: "", endDate: "2026-11-27", endTime: "7:30" })),
    ).toEqual({});
  });

  it("allows an unchanged past end when editing", () => {
    const form = validForm({
      startDate: "2026-11-01",
      startTime: "00:00",
      endDate: "2026-11-02",
      endTime: "00:00",
    });
    expect(validate(form)).toEqual({ endDate: "endInPast" });
    expect(validate(form, { initialEnd: "2026-11-02T00:00" })).toEqual({});
  });

  it("enforces length limits", () => {
    expect(validate(validForm({ name: "x".repeat(81), description: "y".repeat(501) }))).toEqual({
      name: "nameTooLong",
      description: "descriptionTooLong",
    });
  });

  it("requires selections for specific products or collections", () => {
    expect(validate(validForm({ targetType: "products" }))).toEqual({
      resources: "productsRequired",
    });
    expect(validate(validForm({ targetType: "collections" }))).toEqual({
      resources: "collectionsRequired",
    });
  });

  it("validates the color", () => {
    expect(validate(validForm({ color: "#12345" }))).toEqual({ color: "colorInvalid" });
  });
});

describe("toTimerPayload", () => {
  it("converts form state into the API payload", () => {
    const payload = toTimerPayload(
      validForm({
        name: "  Black Friday ",
        color: "#00AA88",
        targetType: "products",
        resources: [{ id: "gid://shopify/Product/1", title: "Board" }],
      }),
    );
    expect(payload).toEqual({
      name: "Black Friday",
      description: "",
      startDate: "2026-11-29",
      startTime: "00:00",
      endDate: "2026-11-30",
      endTime: "23:59",
      color: "#00aa88",
      size: "medium",
      position: "top",
      urgency: "color_pulse",
      target: { type: "products", resourceIds: ["gid://shopify/Product/1"] },
    });
  });

  it("sends a blank start as null and drops selections for all products", () => {
    const payload = toTimerPayload(
      validForm({ startDate: "", startTime: "", resources: [{ id: "x", title: "x" }] }),
    );
    expect(payload.startDate).toBeNull();
    expect(payload.startTime).toBeNull();
    expect(payload.target).toEqual({ type: "all", resourceIds: [] });
  });
});

describe("formFromTimer", () => {
  it("builds editable state from an API timer", () => {
    const timer = {
      name: "Flash sale",
      description: "Today only",
      schedule: {
        startDate: "2026-07-01",
        startTime: "12:00",
        endDate: "2026-07-02",
        endTime: "18:30",
      },
      color: "#ff0000",
      size: "large",
      position: "bottom",
      urgency: "shake",
      target: { type: "collections", resources: [{ id: "c1", title: "Summer" }] },
    };
    expect(formFromTimer(timer, "en-US")).toEqual({
      name: "Flash sale",
      description: "Today only",
      startDate: "2026-07-01",
      startTime: "12:00 PM",
      endDate: "2026-07-02",
      endTime: "6:30 PM",
      color: "#ff0000",
      size: "large",
      position: "bottom",
      urgency: "shake",
      targetType: "collections",
      resources: [{ id: "c1", title: "Summer" }],
    });
  });
});

describe("mapServerFieldErrors", () => {
  it("maps API field paths onto form fields", () => {
    expect(
      mapServerFieldErrors({ "target.resourceIds": "Gone", name: "Required", endTime: "Past" }),
    ).toEqual({ resources: "Gone", name: "Required", endTime: "Past" });
  });
});

describe("resourcesFromPicker", () => {
  it("normalizes products and collections", () => {
    expect(
      resourcesFromPicker(
        [
          {
            id: "gid://shopify/Product/1",
            title: "Board",
            handle: "board",
            images: [{ originalSrc: "https://cdn/board.png", altText: "A board" }],
          },
          { id: "gid://shopify/Product/2", title: "Wax", handle: "wax", images: [] },
        ],
        "products",
      ),
    ).toEqual([
      {
        id: "gid://shopify/Product/1",
        title: "Board",
        handle: "board",
        imageUrl: "https://cdn/board.png",
        imageAlt: "A board",
      },
      { id: "gid://shopify/Product/2", title: "Wax", handle: "wax", imageUrl: null, imageAlt: "" },
    ]);

    expect(
      resourcesFromPicker(
        [{ id: "c1", title: "Sale", handle: "sale", image: { originalSrc: "https://cdn/s.png" } }],
        "collections",
      ),
    ).toEqual([
      { id: "c1", title: "Sale", handle: "sale", imageUrl: "https://cdn/s.png", imageAlt: "" },
    ]);
  });
});

describe("readableTextColor", () => {
  it("picks white on dark colors and near-black on light colors", () => {
    expect(readableTextColor("#000000")).toBe("#ffffff");
    expect(readableTextColor("#008060")).toBe("#ffffff");
    expect(readableTextColor("#ffffff")).toBe("#1a1a1a");
    expect(readableTextColor("#ffd700")).toBe("#1a1a1a");
  });
});
