/**
 * Example: a pure module's test. Illustrates docs/conventions/testing.md.
 * No environment comment, so it runs in plain Node: there is nothing to render.
 */
import { describe, expect, it } from "vitest";
import { longestStreak } from "./longestStreak";

describe("longestStreak", () => {
  it("is 0 with no days", () => {
    expect(longestStreak([])).toBe(0);
  });

  it("counts the longest run, in any order and with repeats", () => {
    expect(
      longestStreak(["2026-11-09", "2026-11-03", "2026-11-10", "2026-11-09", "2026-11-11"]),
    ).toBe(3);
  });

  it("runs across a month's end", () => {
    expect(longestStreak(["2026-10-31", "2026-11-01"])).toBe(2);
  });
});
