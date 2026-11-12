import { type LogEntry, type LogField, optionLabel, type Precision, type Value } from "@spoor/core";

/** The entry's time, showing only the part its precision knows. */
export function formatTime(entry: LogEntry): string {
  const { occurredAt, precision, timeZone } = entry.resolved;
  const options: Record<Precision, Intl.DateTimeFormatOptions> = {
    instant: { dateStyle: "medium", timeStyle: "short" },
    day: { dateStyle: "medium" },
    month: { year: "numeric", month: "short" },
    year: { year: "numeric" },
  };
  const format = (instant: number) =>
    new Date(instant).toLocaleString(undefined, { ...options[precision], timeZone });
  return entry.endedAt === null
    ? format(occurredAt)
    : `${format(occurredAt)} → ${format(entry.endedAt)}`;
}

/** An entry's value for `field` as text; `titles` names the things a ref points to. */
export function formatValue(field: LogField, value: Value, titles: Map<string, string>): string {
  switch (field.shape.valueType) {
    case "boolean":
      return value ? "yes" : "no";
    case "enum":
      return optionLabel(field.optionLabels, value as string);
    case "datetime":
      return new Date(value as number).toLocaleString();
    case "ref":
      return titles.get(value as string) ?? (value as string);
    case "multi_ref":
      return (value as string[]).map((id) => titles.get(id) ?? id).join(", ");
    default:
      return String(value);
  }
}

/** The entry's field values as "Name: value" parts, for the fields it has a value for. */
export function describeValues(
  fields: LogField[],
  entry: LogEntry,
  titles: Map<string, string>,
): string {
  return fields
    .filter((f) => f.id in entry.values)
    .map((f) => `${f.name}: ${formatValue(f, entry.values[f.id], titles)}`)
    .join(" · ");
}
