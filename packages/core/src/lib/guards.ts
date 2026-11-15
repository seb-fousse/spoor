/** Small helpers shared across core. */

import { SpoorError, type SpoorErrorDetails } from "./spoor-error";

/** True only for a string with at least one non-whitespace character. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * `name` trimmed. If it is blank, throws `invalid` `"<label>: name is required"`,
 * with `details` (the record named, `entity` and `id`) and `field: "name"`.
 */
export function requireName(label: string, name: string, details: SpoorErrorDetails = {}): string {
  if (!isNonEmptyString(name)) {
    throw new SpoorError("invalid", `${label}: name is required`, { ...details, field: "name" });
  }
  return name.trim();
}

/** `text` trimmed, or `null` if it is missing or blank. */
export function optionalText(text: string | null | undefined): string | null {
  return isNonEmptyString(text) ? text.trim() : null;
}
