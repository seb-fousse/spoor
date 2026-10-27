/**
 * Days and time zones (see `docs/data-spec.md`, "Days and time zones").
 *
 * A day runs from 00:00 to 00:00 of the next date in a time zone (an IANA ID).
 * Every interval and log entry stores the zone in force when it was created and
 * is assigned to days in that zone, so these helpers always take the zone
 * explicitly instead of reading the current setting.
 *
 * Instants are epoch milliseconds (UTC); dates are `YYYY-MM-DD`. Only
 * `Intl.DateTimeFormat` is used: `Temporal` is not available everywhere we run.
 */

/** How much of a log entry's `occurred_at` is known. */
export type Precision = "instant" | "day" | "month" | "year";

const HOUR = 3_600_000;
// Formatters for validated zones, by ID. Building one is far slower than using it.
const formatters = new Map<string, Intl.DateTimeFormat>();
const WALL_CLOCK: Intl.DateTimeFormatOptions = {
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
};

/**
 * True for an IANA time zone ID the platform knows, such as `Europe/Paris`.
 *
 * Aliases (`Asia/Calcutta`, `Etc/UTC`) are accepted: engines disagree on which
 * spelling is canonical (V8 returns `Asia/Calcutta`, others `Asia/Kolkata`), so
 * requiring one would reject zones another device stored. Offsets (`+05:00`)
 * are rejected because they are not IANA IDs, and so are miscased IDs (`utc`,
 * `europe/paris`), which no engine produces and which would give one zone
 * several spellings in stored data.
 */
export function isTimeZone(id: unknown): id is string {
  if (typeof id !== "string") return false;
  if (formatters.has(id)) return true;
  if (/^[+-]/.test(id)) return false;
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-US", { ...WALL_CLOCK, timeZone: id });
  } catch {
    return false;
  }
  const resolved = format.resolvedOptions().timeZone;
  if (resolved !== id && resolved.toLowerCase() === id.toLowerCase()) return false;
  formatters.set(id, format);
  return true;
}

/** The device's current time zone, or `UTC` if the platform reports none usable. */
export function systemTimeZone(): string {
  const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isTimeZone(zone) ? zone : "UTC";
}

/** The local date of `instant` in `timeZone`. */
export function dayOf(instant: number, timeZone: string): string {
  const [year, month, day] = wallClock(instant, timeZone);
  return formatDate(year, month, day);
}

/**
 * The first instant of `date` in `timeZone`.
 *
 * Usually local 00:00, but where a DST change skips midnight (America/Santiago,
 * America/Havana) it is the first local time that exists, such as 01:00. Where
 * a whole date is skipped (Pacific/Apia, 2011-12-30) it is the start of the next
 * date that exists, so that day is empty.
 */
export function startOfDay(date: string, timeZone: string): number {
  const [year, month, day] = parseDate(date);
  const midnight = utcFromParts(year, month, day);
  // Fast path: guess with the offset at the guess. Correct unless the offset
  // changes right around midnight.
  let guess = midnight - offsetAt(midnight, timeZone);
  guess = midnight - offsetAt(guess, timeZone);
  if (isStartOf(guess, date, timeZone)) return guess;
  // Midnight fell in a gap (DST or a skipped date): binary-search for the first instant whose local
  // date reaches `date`. No offset is a day or more, so ±48 h brackets it.
  let before = midnight - 48 * HOUR;
  let after = midnight + 48 * HOUR;
  while (after - before > 1) {
    const mid = Math.floor((before + after) / 2);
    if (dayOf(mid, timeZone) >= date) after = mid;
    else before = mid;
  }
  return after;
}

/** The half-open range `[start, end)` of `date` in `timeZone`; 23 or 25 hours long around DST. */
export function dayRange(date: string, timeZone: string): [start: number, end: number] {
  return [startOfDay(date, timeZone), startOfDay(nextDate(date), timeZone)];
}

/**
 * The dates the half-open interval `[startAt, endAt)` touches in `timeZone`, in
 * order. An interval ending exactly at midnight does not touch the next day; a
 * zero-length interval touches the day it sits in.
 */
export function daysSpanned(startAt: number, endAt: number, timeZone: string): string[] {
  if (endAt < startAt) {
    throw new Error(`Interval ends before it starts: [${startAt}, ${endAt})`);
  }
  const last = dayOf(endAt > startAt ? endAt - 1 : endAt, timeZone);
  const days: string[] = [];
  for (let day = dayOf(startAt, timeZone); day <= last; ) {
    days.push(day);
    // Step via the next day's start so dates a zone skipped are left out.
    day = dayOf(startOfDay(nextDate(day), timeZone), timeZone);
  }
  return days;
}

/** `instant` truncated to the start of its day, month, or year in `timeZone`. */
export function truncateToPrecision(
  instant: number,
  precision: Precision,
  timeZone: string,
): number {
  const day = dayOf(instant, timeZone);
  switch (precision) {
    case "instant":
      return instant;
    case "day":
      return startOfDay(day, timeZone);
    case "month":
      return startOfDay(`${day.slice(0, 7)}-01`, timeZone);
    case "year":
      return startOfDay(`${day.slice(0, 4)}-01-01`, timeZone);
    default:
      throw new Error(`Unknown precision: ${String(precision)}`);
  }
}

/** The day a log entry belongs to, or `null` for `month` and `year` precision. */
export function dayOfEntry(
  occurredAt: number,
  precision: Precision,
  timeZone: string,
): string | null {
  const day = dayOf(occurredAt, timeZone);
  return precision === "instant" || precision === "day" ? day : null;
}

/** The cached wall-clock formatter for `timeZone`; throws if the zone is invalid. */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const format = isTimeZone(timeZone) && formatters.get(timeZone);
  if (!format) throw new Error(`Invalid time zone: ${JSON.stringify(timeZone)}`);
  return format;
}

/** Local `[year, month, day, hour, minute, second]` of `instant` in `timeZone`. */
function wallClock(instant: number, timeZone: string): number[] {
  if (Number.isNaN(new Date(instant).getTime())) throw new Error(`Invalid instant: ${instant}`);
  const parts = formatterFor(timeZone).formatToParts(instant);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return [part("year"), part("month"), part("day"), part("hour"), part("minute"), part("second")];
}

/** The zone's UTC offset at `instant`, in milliseconds (local minus UTC). */
function offsetAt(instant: number, timeZone: string): number {
  const second = Math.floor(instant / 1000) * 1000;
  const [year, month, day, hour, minute, sec] = wallClock(second, timeZone);
  return utcFromParts(year, month, day, hour, minute, sec) - second;
}

function isStartOf(instant: number, date: string, timeZone: string): boolean {
  return dayOf(instant, timeZone) === date && dayOf(instant - 1, timeZone) < date;
}

/** Like `Date.UTC`, without its mapping of years 0–99 to 1900–1999. */
function utcFromParts(year: number, month: number, day: number, h = 0, m = 0, s = 0): number {
  const date = new Date(Date.UTC(2000, 0, 1, h, m, s));
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

function civilDate(utc: number): [year: number, month: number, day: number] {
  const date = new Date(utc);
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
}

function nextDate(date: string): string {
  const [year, month, day] = parseDate(date);
  return formatDate(...civilDate(utcFromParts(year, month, day + 1)));
}

function parseDate(date: string): [year: number, month: number, day: number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const parts: [number, number, number] = [
    Number(match?.[1]),
    Number(match?.[2]),
    Number(match?.[3]),
  ];
  if (!match || parts[0] < 1 || formatDate(...civilDate(utcFromParts(...parts))) !== date) {
    throw new Error(`Invalid date (expected YYYY-MM-DD): ${JSON.stringify(date)}`);
  }
  return parts;
}

function formatDate(year: number, month: number, day: number): string {
  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}
