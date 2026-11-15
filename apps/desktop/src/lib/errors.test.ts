import { SpoorError, type SpoorErrorCode, type SpoorErrorDetails } from "@spoor/core";
import { describe, expect, it } from "vitest";
import { describeError, UNEXPECTED_ERROR } from "./errors";

const ID = "0b7f3c1e-5d2a-4e9f-8c61-2a7d9e4b1f03";

function described(code: SpoorErrorCode, details: SpoorErrorDetails = {}) {
  return describeError(new SpoorError(code, `Record ${ID}: for developers`, details));
}

describe("describeError", () => {
  it("never shows the developer message or an id", () => {
    const codes: SpoorErrorCode[] = [
      "invalid",
      "conflict",
      "archived",
      "newer_version",
      "not_found",
      "internal",
    ];
    for (const code of codes) {
      const { title, message } = described(code, { entity: "thing", id: ID, fieldId: ID });
      expect(`${title} ${message}`).not.toContain(ID);
      expect(message).not.toContain("for developers");
    }
  });

  describe("invalid", () => {
    it("is expected, and asks to check the input", () => {
      expect(described("invalid")).toEqual({
        message: "That isn't valid. Check what you entered and try again.",
        expected: true,
      });
    });

    it("names an input property users know", () => {
      expect(described("invalid", { field: "name" }).message).toBe(
        "That name isn't valid. Check it and try again.",
      );
      expect(described("invalid", { field: "occurredAt" }).message).toBe(
        "That isn't valid. Check what you entered and try again.",
      );
    });

    it("words each rule a field's value can break, with its limit", () => {
      const cases: [SpoorErrorDetails, string][] = [
        [{ rule: "required" }, "A required value is missing."],
        [{ rule: "type" }, "A value isn't the right kind for its field."],
        [{ rule: "option" }, "A value isn't one of its field's options."],
        [{ rule: "unique" }, "The same option is chosen twice."],
        [{ rule: "range" }, "A date must be between the years 0 and 9999."],
        [{ rule: "min", limit: 3 }, "A value must be at least 3."],
        [{ rule: "max", limit: "2026-12-31" }, "A value must be at most 2026-12-31."],
        [{ rule: "precision", limit: 1 }, "A value can have at most 1 decimal place."],
        [{ rule: "precision", limit: 2 }, "A value can have at most 2 decimal places."],
        [{ rule: "minLength", limit: 2 }, "A value must be at least 2 characters long."],
        [{ rule: "maxLength", limit: 1 }, "A value must be at most 1 character long."],
        [{ rule: "minSelected", limit: 1 }, "Choose at least 1 option."],
        [{ rule: "maxSelected", limit: 3 }, "Choose at most 3 options."],
      ];
      for (const [details, message] of cases) {
        expect(described("invalid", { fieldId: ID, ...details }).message).toBe(message);
      }
    });

    it("says where an import file is wrong", () => {
      expect(described("invalid", { path: "timelines[0].name" }).message).toBe(
        "The file can't be imported: timelines[0].name isn't valid.",
      );
    });
  });

  describe("conflict", () => {
    it("is expected, and generic without details", () => {
      expect(described("conflict")).toEqual({
        message: "That clashes with something already saved.",
        expected: true,
      });
    });

    it("says a name or external id is taken", () => {
      expect(described("conflict", { entity: "log_field", id: ID, field: "name" }).message).toBe(
        "That name is already used. Choose another.",
      );
      expect(described("conflict", { entity: "thing", field: "externalId" }).message).toBe(
        "That external id is already used. Choose another.",
      );
    });

    it("words a block that overlaps another, or starts while one is ongoing", () => {
      expect(described("conflict", { entity: "timeline_interval", id: ID }).message).toBe(
        "That would overlap another block on this timeline.",
      );
      expect(
        described("conflict", { entity: "timeline_interval", id: ID, field: "at" }).message,
      ).toBe("A block is already ongoing on this timeline.");
    });

    it("words a timeline that can't become exclusive, and a thing's second category", () => {
      expect(described("conflict", { entity: "timeline", field: "exclusive" }).message).toBe(
        "This timeline has overlapping blocks, so it can't be made exclusive.",
      );
      expect(described("conflict", { entity: "timeline_category", field: "thingId" }).message).toBe(
        "That thing already has a category on this timeline.",
      );
    });
  });

  it("archived: is expected, and names the kind of record", () => {
    expect(described("archived", { entity: "timeline", id: ID })).toEqual({
      message: "This timeline is archived, so it can't be changed.",
      expected: true,
    });
    expect(described("archived").message).toBe(
      "Something this needs is archived, so it can't be changed.",
    );
  });

  it("newer_version: is expected, and asks to update Spoor", () => {
    expect(described("newer_version", { version: 3, supported: 2 })).toEqual({
      title: "Update Spoor",
      message: "This data was saved by a newer version of Spoor. Update Spoor to open it.",
      expected: true,
    });
  });

  it("not_found: is not expected, and names the kind of record", () => {
    expect(described("not_found", { entity: "timeline_interval", id: ID })).toEqual({
      title: "Not found",
      message: "This block no longer exists. It may have been deleted.",
      expected: false,
    });
    expect(described("not_found").message).toBe(
      "Something this needs no longer exists. It may have been deleted.",
    );
  });

  it("internal: is a bug, so something went wrong", () => {
    expect(described("internal", { entity: "thing", id: ID })).toEqual(UNEXPECTED_ERROR);
    expect(UNEXPECTED_ERROR).toMatchObject({ title: "Something went wrong", expected: false });
  });

  it("anything that isn't a SpoorError: something went wrong", () => {
    expect(describeError(new Error(`SQLITE_CONSTRAINT: thing ${ID}`))).toEqual(UNEXPECTED_ERROR);
    expect(describeError("no such table: things")).toEqual(UNEXPECTED_ERROR);
    expect(describeError(undefined)).toEqual(UNEXPECTED_ERROR);
  });
});
