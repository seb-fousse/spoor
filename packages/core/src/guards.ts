/**
 * Small, dependency-free helpers shared across core.
 *
 * This file currently holds a single trivial function. Its real job today is to
 * prove the type-check / lint / test pipeline works end to end. Real validation
 * (with Zod) and the data model arrive with the first feature, not in the scaffold.
 */

/** True only for a string with at least one non-whitespace character. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
