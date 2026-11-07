import { describe, expect, it } from "vitest";
import { isNonEmptyString, optionalText, requireName } from "./guards";

describe("isNonEmptyString", () => {
  it("accepts strings with visible content", () => {
    expect(isNonEmptyString("spoor")).toBe(true);
    expect(isNonEmptyString("  padded  ")).toBe(true);
  });

  it("rejects empty or whitespace-only strings", () => {
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString("   ")).toBe(false);
    expect(isNonEmptyString("\t\n")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(42)).toBe(false);
    expect(isNonEmptyString({})).toBe(false);
  });
});

describe("requireName", () => {
  it("trims a name", () => {
    expect(requireName("Thing 1", "  Alex ")).toBe("Alex");
  });

  it("names the record when the name is blank", () => {
    expect(() => requireName("Thing 1", "  ")).toThrow("Thing 1: name is required");
  });
});

describe("optionalText", () => {
  it("trims text and turns blank or missing text into null", () => {
    expect(optionalText(" note ")).toBe("note");
    expect(optionalText("  ")).toBeNull();
    expect(optionalText(null)).toBeNull();
    expect(optionalText(undefined)).toBeNull();
  });
});
