/** Small, dependency-free helpers shared across core. */

/** True only for a string with at least one non-whitespace character. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** `name` trimmed; throws `"<label>: name is required"` if it is blank. */
export function requireName(label: string, name: string): string {
  if (!isNonEmptyString(name)) throw new Error(`${label}: name is required`);
  return name.trim();
}

/** `text` trimmed, or `null` if it is missing or blank. */
export function optionalText(text: string | null | undefined): string | null {
  return isNonEmptyString(text) ? text.trim() : null;
}
