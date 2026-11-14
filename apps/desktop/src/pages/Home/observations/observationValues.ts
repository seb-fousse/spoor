import type { MetricDay, ObservationMetric } from "@spoor/core";

/**
 * The rules the rail's observation cards apply before recording, so a click
 * never sends core a value it would refuse.
 */

/** A number metric's constraints: its range, precision and unit. */
export type NumberConstraints = Extract<ObservationMetric, { valueType: "number" }>["constraints"];
type MultiEnumConstraints = Extract<ObservationMetric, { valueType: "multi_enum" }>["constraints"];

/** How many of the day's metrics have a value. */
export function countRecorded(items: readonly MetricDay[]): { recorded: number; total: number } {
  return {
    recorded: items.filter((item) => item.observation !== null).length,
    total: items.length,
  };
}

/** `x` rounded down or up (`round` is Math.floor or Math.ceil) to `precision` decimals. */
function roundTo(x: number, precision: number, round: (n: number) => number): number {
  const factor = 10 ** precision;
  // toFixed first, so 1.2 * 10 = 12.000000000000002 doesn't ceil to 13.
  return Number((round(Number((x * factor).toFixed(6))) / factor).toFixed(precision));
}

/**
 * `value` as the metric allows it: clamped to min and max, rounded to the
 * metric's precision. Rounding never leaves the range: a bound that is finer
 * than the precision gets the nearest allowed value inside it.
 */
export function normalizeNumber(value: number, { min, max, precision }: NumberConstraints): number {
  let n = value;
  if (min !== undefined) n = Math.max(n, min);
  if (max !== undefined) n = Math.min(n, max);
  if (precision === undefined) return n;
  // toFixed is also how core checks precision, so the result always passes.
  const rounded = Number(n.toFixed(precision));
  if (max !== undefined && rounded > max) return roundTo(max, precision, Math.floor);
  if (min !== undefined && rounded < min) return roundTo(min, precision, Math.ceil);
  return rounded;
}

/**
 * The value a stepper click records: `by` from the current value, or from 0
 * (brought into range) when the day has none yet.
 */
export function stepNumber(
  current: number | null,
  by: number,
  constraints: NumberConstraints,
): number {
  const from = current ?? normalizeNumber(0, constraints);
  return normalizeNumber(from + by, constraints);
}

/** `selected` with `key` added or removed, in option order. */
export function toggleOption(
  selected: readonly string[],
  key: string,
  { options }: MultiEnumConstraints,
): string[] {
  const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
  return options.map((o) => o.key).filter((k) => next.includes(k));
}

/** Whether `selected` has as many options as the metric needs, so it can be recorded. */
export function meetsMinimum(selected: readonly string[], { minSelected }: MultiEnumConstraints) {
  return selected.length >= (minSelected ?? 0);
}

/** Whether no more options can be picked. */
export function atMaximum(selected: readonly string[], { maxSelected }: MultiEnumConstraints) {
  return maxSelected !== undefined && selected.length >= maxSelected;
}
