/**
 * Instants and calendar dates, as stored (see docs/data-spec.md § Storage).
 *
 * An instant is an integer count of milliseconds since the Unix epoch, UTC. A local date
 * is a `YYYY-MM-DD` string with no time zone attached. Export writes instants in one
 * exact ISO 8601 form, and import accepts only that form, so a round trip is lossless.
 */

/** Milliseconds since 1970-01-01T00:00:00.000Z. */
export type Instant = number;

/** A calendar date, `YYYY-MM-DD`. */
export type LocalDate = string;

const DAY_MS = 86_400_000;
// The span where `toISOString` yields a 4-digit year: 0000-01-01 to 9999-12-31.
const MIN_INSTANT = -62_167_219_200_000;
const MAX_INSTANT = 253_402_300_799_999;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The current instant. */
export function now(): Instant {
  return Date.now();
}

/** True for a safe integer, the only shape an instant is stored in. */
export function isInstant(value: unknown): value is Instant {
  return Number.isSafeInteger(value);
}

/**
 * Formats an instant as `YYYY-MM-DDTHH:mm:ss.sssZ`.
 * Throws for a non-instant or one outside years 0000-9999.
 */
export function instantToIso(instant: Instant): string {
  if (!isInstant(instant) || instant < MIN_INSTANT || instant > MAX_INSTANT) {
    throw new Error(`Not a representable instant: ${instant}`);
  }
  return new Date(instant).toISOString();
}

/**
 * Parses exactly `YYYY-MM-DDTHH:mm:ss.sssZ`. Offsets, missing milliseconds and
 * impossible dates or times (2026-02-30, 24:00) throw, naming the offending value.
 */
export function isoToInstant(iso: string): Instant {
  const ms = ISO_PATTERN.test(iso) ? Date.parse(iso) : Number.NaN;
  // The round trip rejects anything `Date.parse` normalises, such as 24:00 or Feb 30.
  if (Number.isNaN(ms) || instantToIso(ms) !== iso) {
    throw new Error(
      `Not an ISO 8601 UTC instant (YYYY-MM-DDTHH:mm:ss.sssZ): ${JSON.stringify(iso)}`,
    );
  }
  return ms;
}

/** True for a `YYYY-MM-DD` string naming a real calendar date. */
export function isLocalDate(value: unknown): value is LocalDate {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  // Date-only ISO strings parse as UTC midnight; the round trip rejects rollovers.
  const ms = Date.parse(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

/** The date `days` calendar days after `date` (before it, if negative). */
export function addDays(date: LocalDate, days: number): LocalDate {
  if (!isLocalDate(date)) throw new Error(`Not a YYYY-MM-DD date: ${JSON.stringify(date)}`);
  if (!Number.isSafeInteger(days)) throw new Error(`Not a whole number of days: ${days}`);
  // UTC has no DST, so every day is exactly DAY_MS long.
  return instantToIso(Date.parse(date) + days * DAY_MS).slice(0, 10);
}

/**
 * Orders two valid local dates: -1 if `a` is earlier, 0 if equal, 1 if later.
 * Usable directly as an `Array.prototype.sort` comparator.
 */
export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  // Fixed-width YYYY-MM-DD sorts lexicographically in calendar order.
  return a < b ? -1 : a > b ? 1 : 0;
}
