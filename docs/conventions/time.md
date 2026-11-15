# Time

How the app holds, counts and shows dates and times.

## Instants and calendar dates are core's types

- **An instant is an `Instant`**: a number of milliseconds since the Unix epoch, in UTC.
- **A calendar date is a `LocalDate`**: a `YYYY-MM-DD` string with no time zone.

Both come from core's [`lib/time.ts`](../../packages/core/src/lib/time.ts), as do the helpers
that step and compare them: `now`, `addDays` and `compareLocalDates`. Core's
[`lib/days.ts`](../../packages/core/src/lib/days.ts) turns one into the other in a zone:
`dayOf`, `startOfDay`, `dayRange` and `daysSpanned`. Use these rather than `Date` arithmetic.
Outside the POC pages, no app code calls `new Date`.

**Why:** they're the types core stores (see [data-spec.md](../data-spec.md)), and a date with
no zone can't shift by a day when it's read in another zone.

- **Source:** core's [`lib/time.ts`](../../packages/core/src/lib/time.ts)
- **Lint:** none
- **Example:** [`pages/Home/homeDays.ts`](../../apps/desktop/src/pages/Home/homeDays.ts)
  steps dates with `addDays`

## Days are counted in the `time_zone` setting

The app counts its days in the zone the `time_zone` setting names, which
[`useTimeZone`](../../apps/desktop/src/data/settings.ts) reads. Pass it on:

- `useToday(timeZone)` gives today in that zone. `HomeStateProvider` passes the setting, so
  Home's today is the setting's today.
- The grid's intervals are read from `startOfDay(first, timeZone)` to the start of the day after
  the last.
- Until the setting loads, `useToday` falls back to the device's zone. The grid waits for the
  setting.

**Why:** a day's data has to be the same day wherever the device is.

- **Source:** the doc comment on [`hooks/useToday.ts`](../../apps/desktop/src/hooks/useToday.ts)
- **Lint:** none
- **Example:** [`pages/Home/HomeState.tsx`](../../apps/desktop/src/pages/Home/HomeState.tsx)

## Format only through `lib/format`

Every date and time the app shows is formatted through
[`lib/format.ts`](../../apps/desktop/src/lib/format.ts), outside the POC pages:

- **For a `LocalDate`:** `formatDay` ("Mon, 9 Nov 2026"), `formatShortDay` ("Mon 9") and
  `formatDayRange` ("5 – 9 Nov 2026"). A `LocalDate` parses as UTC midnight, so they format in
  UTC and give back the same date.
- **For an `Instant`:** `formatClockTime(instant, timeZone)`, which always takes its zone.
- **For a new format:** add a function there, built on `dateFormat(options)`, which builds each
  `Intl.DateTimeFormat` once and shares it. Building a formatter is far slower than using one.

An instant is formatted in an explicit zone, never the device's. That's the setting's zone, or a
record's own: a log entry's time is shown in the zone it was recorded in
(`formatTime` in [`LogEntryForm/formatEntry.ts`](../../apps/desktop/src/components/LogEntryForm/formatEntry.ts)),
and its datetime values in the setting's zone.

Parsing isn't covered yet. `LogEntryForm` parses a datetime field's input with `dayjs`, in the
device's zone, so a value can show in a different zone from the one it was typed in.

**Why:** `toLocaleString()` and its kind use the device's zone, not the setting's. Home's log
rail once showed datetime values in the wrong zone that way.

- **Source:** [#146](https://github.com/seb-fousse/spoor/issues/146), rule 4
- **Lint:** rule 4 reports `toLocaleString`, `toLocaleDateString`, `toLocaleTimeString`
  (plain and `?.` calls) and `Intl.DateTimeFormat`, with or without `new`, outside
  `lib/format.ts` and tests
- **Example:** [`pages/Home/RightHeader.tsx`](../../apps/desktop/src/pages/Home/RightHeader.tsx)
  shows its day with `formatDay`
