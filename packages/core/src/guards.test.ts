import { describe, expect, it } from "vitest";
import { isNonEmptyString } from "./guards";

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
