import { describe, expect, it } from "vitest";

import { ValidationError } from "../lib/errors.js";
import { timerPayload } from "../test/helpers.js";

import {
  isObjectId,
  listQuerySchema,
  parseOrThrow,
  sanitizeText,
  timerInputSchema,
} from "./timer.validation.js";

function fieldErrors(input) {
  try {
    parseOrThrow(timerInputSchema, input);
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error.fields;
  }
  throw new Error("Expected validation to fail");
}

describe("sanitizeText", () => {
  it("strips HTML tags but keeps comparison operators", () => {
    expect(sanitizeText('<b>Big</b> <img src=x onerror="alert(1)">sale')).toBe("Big sale");
    expect(sanitizeText("Save 5 < 10 > 3")).toBe("Save 5 < 10 > 3");
    expect(sanitizeText("<script>alert(1)</script>Hi")).toBe("alert(1)Hi");
  });

  it("removes control, zero-width and bidi-override characters", () => {
    expect(sanitizeText("Fl\u200Bash\u0007 \u202Esale")).toBe("Flash sale");
  });

  it("collapses whitespace on single-line text", () => {
    expect(sanitizeText("  Black \n\t Friday  ")).toBe("Black Friday");
  });

  it("keeps line breaks in multiline text but limits blank lines", () => {
    expect(sanitizeText(" Line one  \r\n\r\n\r\n\r\n  line   two ", { multiline: true })).toBe(
      "Line one\n\nline two",
    );
  });

  it("normalizes Unicode to NFC", () => {
    expect(sanitizeText("Cafe\u0301")).toBe("Caf\u00e9");
  });
});

describe("timerInputSchema", () => {
  it("accepts a complete payload and normalizes it", () => {
    const parsed = parseOrThrow(
      timerInputSchema,
      timerPayload({ name: "  <i>Flash</i>   sale ", color: "#00AA88" }),
    );
    expect(parsed).toMatchObject({ name: "Flash sale", color: "#00aa88" });
  });

  it("treats a blank start as 'start immediately'", () => {
    const parsed = parseOrThrow(timerInputSchema, timerPayload({ startDate: "", startTime: "" }));
    expect(parsed.startDate).toBeNull();
    expect(parsed.startTime).toBeNull();
  });

  it("defaults the description to an empty string", () => {
    const { description: _description, ...payload } = timerPayload();
    expect(parseOrThrow(timerInputSchema, payload).description).toBe("");
  });

  it("requires a name, end date and end time", () => {
    const fields = fieldErrors(timerPayload({ name: "   ", endDate: undefined, endTime: "" }));
    expect(fields).toMatchObject({
      name: "Enter a timer name.",
      endDate: "Enter an end date.",
      endTime: "Enter a time in 24-hour HH:MM format.",
    });
  });

  it("rejects a name that is only markup", () => {
    expect(fieldErrors(timerPayload({ name: "<b></b>" })).name).toBe("Enter a timer name.");
  });

  it("enforces length limits after sanitizing", () => {
    const fields = fieldErrors(
      timerPayload({ name: "x".repeat(81), description: "y".repeat(501) }),
    );
    expect(fields.name).toMatch(/80 characters/);
    expect(fields.description).toMatch(/500 characters/);
  });

  it("requires start date and time together", () => {
    expect(fieldErrors(timerPayload({ startTime: "" })).startTime).toBe("Enter a start time.");
    expect(fieldErrors(timerPayload({ startDate: null })).startDate).toBe("Enter a start date.");
  });

  it("rejects impossible dates and malformed times", () => {
    const fields = fieldErrors(timerPayload({ endDate: "2026-02-30", startTime: "24:00" }));
    expect(fields.endDate).toBe("Enter a valid date.");
    expect(fields.startTime).toMatch(/HH:MM/);
  });

  it("rejects the retired position setting", () => {
    expect(fieldErrors(timerPayload({ position: "top" }))).toEqual({
      _root: "Unknown field: position.",
    });
  });

  it("rejects unknown enum values and bad colors", () => {
    const fields = fieldErrors(timerPayload({ size: "huge", urgency: "siren", color: "red" }));
    expect(Object.keys(fields)).toEqual(expect.arrayContaining(["size", "urgency", "color"]));
  });

  it("rejects unknown fields so clients can't set server-owned data", () => {
    expect(fieldErrors({ ...timerPayload(), shop: "evil.myshopify.com" })._root).toBe(
      "Unknown field: shop.",
    );
  });

  it("rejects operator objects in place of strings (NoSQL injection)", () => {
    expect(fieldErrors(timerPayload({ name: { $gt: "" } })).name).toBe("Enter a timer name.");
  });

  describe("target", () => {
    it("requires selections for specific products or collections", () => {
      expect(
        fieldErrors(timerPayload({ target: { type: "products", resourceIds: [] } }))[
          "target.resourceIds"
        ],
      ).toBe("Select at least one product.");
      expect(
        fieldErrors(timerPayload({ target: { type: "collections", resourceIds: [] } }))[
          "target.resourceIds"
        ],
      ).toBe("Select at least one collection.");
    });

    it("rejects IDs of the wrong resource type", () => {
      const fields = fieldErrors(
        timerPayload({
          target: { type: "products", resourceIds: ["gid://shopify/Collection/1"] },
        }),
      );
      expect(fields["target.resourceIds"]).toMatch(/must be Shopify products/);
    });

    it("rejects selections when the timer applies to all products", () => {
      const fields = fieldErrors(
        timerPayload({ target: { type: "all", resourceIds: ["gid://shopify/Product/1"] } }),
      );
      expect(fields["target.resourceIds"]).toMatch(/all products/);
    });

    it("de-duplicates IDs and caps the number of selections", () => {
      const id = "gid://shopify/Product/1";
      const parsed = parseOrThrow(
        timerInputSchema,
        timerPayload({ target: { type: "products", resourceIds: [id, id] } }),
      );
      expect(parsed.target.resourceIds).toEqual([id]);

      const tooMany = Array.from({ length: 101 }, (_, i) => `gid://shopify/Product/${i + 1}`);
      expect(
        fieldErrors(timerPayload({ target: { type: "products", resourceIds: tooMany } }))[
          "target.resourceIds"
        ],
      ).toMatch(/up to 100/);
    });
  });
});

describe("listQuerySchema", () => {
  it("applies defaults", () => {
    expect(parseOrThrow(listQuerySchema, {})).toEqual({
      query: "",
      status: "all",
      sort: "created_desc",
      page: 1,
    });
  });

  it("coerces the page number and trims the query", () => {
    expect(parseOrThrow(listQuerySchema, { page: "3", query: "  sale " })).toMatchObject({
      page: 3,
      query: "sale",
    });
  });

  it("rejects unknown values and nested objects", () => {
    expect(() => parseOrThrow(listQuerySchema, { sort: "price" })).toThrow(ValidationError);
    expect(() => parseOrThrow(listQuerySchema, { page: "0" })).toThrow(ValidationError);
    expect(() => parseOrThrow(listQuerySchema, { query: { $ne: "" } })).toThrow(ValidationError);
  });
});

describe("isObjectId", () => {
  it("accepts 24-character hex strings only", () => {
    expect(isObjectId("65a1f0c2b4d3e2a1f0c2b4d3")).toBe(true);
    expect(isObjectId("not-an-id")).toBe(false);
    expect(isObjectId({ $ne: null })).toBe(false);
  });
});
