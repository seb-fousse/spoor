/**
 * Example: a pure module. Illustrates docs/conventions/react.md and
 * docs/conventions/testing.md.
 *
 * Logic lives in plain functions like this one, with no React, so a test calls it
 * directly, in Node, without rendering anything. A hook or component then only
 * wires it up. Dates are core's `LocalDate`s and are stepped with core's helpers.
 */
import { addDays, compareLocalDates, type LocalDate } from "@spoor/core";

/** The most consecutive calendar days among `days`, in any order and with repeats. 0 for none. */
export function longestStreak(days: readonly LocalDate[]): number {
  const sorted = [...new Set(days)].sort(compareLocalDates);
  let longest = 0;
  let current = 0;
  let previous: LocalDate | undefined;
  for (const day of sorted) {
    current = previous !== undefined && addDays(previous, 1) === day ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = day;
  }
  return longest;
}
