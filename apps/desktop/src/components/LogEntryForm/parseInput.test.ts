import dayjs from "dayjs";
import { describe, expect, it } from "vitest";
import { parseInput } from "./parseInput";

describe("parseInput", () => {
  it("reads booleans from their select values", () => {
    expect(parseInput("boolean", "true")).toBe(true);
    expect(parseInput("boolean", "false")).toBe(false);
  });

  it("reads numbers from text", () => {
    expect(parseInput("number", "12.5")).toBe(12.5);
  });

  it("reads a datetime picker value as device-local time", () => {
    expect(parseInput("datetime", "2026-03-04 05:06:07")).toBe(
      dayjs("2026-03-04 05:06:07").valueOf(),
    );
  });

  it("passes other inputs through, including multi-ref lists", () => {
    expect(parseInput("text", "hello")).toBe("hello");
    expect(parseInput("enum", "a")).toBe("a");
    expect(parseInput("multi_ref", ["x", "y"])).toEqual(["x", "y"]);
  });
});
