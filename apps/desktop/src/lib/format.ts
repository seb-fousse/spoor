import type { Instant, LocalDate } from "@spoor/core";

// Building a formatter is far slower than using one, and pages format on every render.
const formatters = new Map<string, Intl.DateTimeFormat>();

/** A shared `Intl.DateTimeFormat` for `options`, built once per locale and options. */
export function dateFormat(
  options: Intl.DateTimeFormatOptions,
  locale?: string,
): Intl.DateTimeFormat {
  const key = `${locale ?? ""}|${JSON.stringify(options)}`;
  let found = formatters.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(locale, options);
    formatters.set(key, found);
  }
  return found;
}

// A LocalDate parses as UTC midnight, so formatting in UTC gives back the same date.
const DAY = {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
} as const;
const SHORT_DAY = { timeZone: "UTC", weekday: "short", day: "numeric" } as const;
const MONTH = { timeZone: "UTC", month: "long", year: "numeric" } as const;
const SHORT_MONTH = { timeZone: "UTC", month: "short", year: "numeric" } as const;

/** `date` with a short weekday, such as "Mon, 9 Nov 2026". */
export function formatDay(date: LocalDate, locale?: string): string {
  return dateFormat(DAY, locale).format(Date.parse(date));
}

/** `date` as a weekday and day of the month, such as "Mon 9", for column headers. */
export function formatShortDay(date: LocalDate, locale?: string): string {
  return dateFormat(SHORT_DAY, locale).format(Date.parse(date));
}

/**
 * The months `from` to `to` fall in, with the year: the full name within one month, such as
 * "November 2026", or short names across two, such as "Oct – Nov 2026".
 */
export function formatMonthRange(from: LocalDate, to: LocalDate, locale?: string): string {
  // A LocalDate is "YYYY-MM-DD", so its first seven characters are its year and month.
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return dateFormat(sameMonth ? MONTH : SHORT_MONTH, locale).formatRange(
    Date.parse(from),
    Date.parse(to),
  );
}

/** `instant` as a 24-hour wall-clock time in `timeZone`, such as "09:30". */
export function formatClockTime(instant: Instant, timeZone: string, locale?: string): string {
  return dateFormat(
    { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" },
    locale,
  ).format(instant);
}
