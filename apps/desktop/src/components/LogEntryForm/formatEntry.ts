import { dateFormat } from "@lib/format";
import { type LogEntry, type LogField, optionLabel, type Precision, type Value } from "@spoor/core";

const PRECISION_FORMATS: Record<Precision, Intl.DateTimeFormatOptions> = {
  instant: { dateStyle: "medium", timeStyle: "short" },
  day: { dateStyle: "medium" },
  month: { year: "numeric", month: "short" },
  year: { year: "numeric" },
};

/** The entry's time, showing only the part its precision knows. */
export function formatTime(entry: LogEntry): string {
  const { occurredAt, precision, timeZone } = entry.resolved;
  const formatter = dateFormat({ ...PRECISION_FORMATS[precision], timeZone });
  const format = (instant: number) => formatter.format(instant);
  return entry.endedAt === null
    ? format(occurredAt)
    : `${format(occurredAt)} → ${format(entry.endedAt)}`;
}

interface ValueContext {
  /** Names the things a ref points to. */
  titles: Map<string, string>;
  /** The zone a datetime shows in. */
  timeZone: string;
  locale?: string;
}

/** An entry's value for `field` as text. */
function formatValue(field: LogField, value: Value, context: ValueContext): string {
  const { titles, timeZone, locale } = context;
  switch (field.shape.valueType) {
    case "boolean":
      return value ? "yes" : "no";
    case "enum":
      return optionLabel(field.optionLabels, value as string);
    case "datetime":
      return dateFormat({ ...PRECISION_FORMATS.instant, timeZone }, locale).format(value as number);
    case "ref":
      return titles.get(value as string) ?? (value as string);
    case "multi_ref":
      return (value as string[]).map((id) => titles.get(id) ?? id).join(", ");
    default:
      return String(value);
  }
}

/**
 * The entry's field values as "Name: value" parts, for the fields it has a value for.
 * `titles` names the things a ref points to. Datetime values show in `timeZone`, the
 * `time_zone` setting.
 */
export function describeValues(
  fields: LogField[],
  entry: LogEntry,
  titles: Map<string, string>,
  timeZone: string,
  locale?: string,
): string {
  const context = { titles, timeZone, locale };
  return fields
    .filter((f) => f.id in entry.values)
    .map((f) => `${f.name}: ${formatValue(f, entry.values[f.id], context)}`)
    .join(" · ");
}
