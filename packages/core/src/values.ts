import { isUuid } from "./ids";
import { type Instant, instantToIso, isInstant, isLocalDate, type LocalDate } from "./time";

/**
 * Typed values, their shapes, and how they are stored (see docs/data-spec.md
 * § Enum options, § Versioning, § Storage). Shared by observation metrics and
 * log and thing fields.
 *
 * A **shape** is a value type plus its constraints: exactly what a version
 * record fixes. Changing a shape creates a new version; `sameShape` says when
 * nothing changed. Option labels are not part of the shape and are not
 * versioned, so they can outlive the options of the current version.
 *
 * Storage conventions for the migrations that use this module:
 * - `constraints` and `option_labels` are definition config, not values, so
 *   they are JSON `TEXT` with `CHECK (json_valid(...))`. Store
 *   `JSON.stringify(shape.constraints)`: shapes are canonical, so the text
 *   survives an export round trip unchanged.
 * - A value is stored in the typed `value_*` column of its type, with
 *   `CHECK ((value_bool IS NOT NULL) + (value_num IS NOT NULL) + ... <= 1)` over
 *   the columns the table has. `multi_enum` and `multi_ref` are stored as one
 *   row per selected key or referenced thing by their callers.
 *
 * Errors name the record and field through the `label` argument, such as
 * `"Log entry <id>, field <id>"`.
 */

export const VALUE_TYPES = [
  "boolean",
  "number",
  "enum",
  "multi_enum",
  "text",
  "date",
  "datetime",
  "ref",
  "multi_ref",
] as const;

export type ValueType = (typeof VALUE_TYPES)[number];

/** Value types an observation metric can have. */
export const METRIC_VALUE_TYPES = [
  "boolean",
  "number",
  "enum",
  "multi_enum",
] as const satisfies readonly ValueType[];

/** Value types a log or thing field can have. */
export const FIELD_VALUE_TYPES = [
  "boolean",
  "number",
  "enum",
  "text",
  "date",
  "datetime",
  "ref",
  "multi_ref",
] as const satisfies readonly ValueType[];

export type MetricValueType = (typeof METRIC_VALUE_TYPES)[number];
export type FieldValueType = (typeof FIELD_VALUE_TYPES)[number];

/** Types whose value is a set, stored as one row per member. */
export type MultiValueType = "multi_enum" | "multi_ref";
/** Types whose value fits in one `value_*` column. */
export type SingleValueType = Exclude<ValueType, MultiValueType>;

export function isMultiValueType(valueType: ValueType): valueType is MultiValueType {
  return valueType === "multi_enum" || valueType === "multi_ref";
}

/** One option of an `enum` or `multi_enum`. */
export interface EnumOption {
  /** Stored on records. Never reused for another meaning. */
  key: string;
  /** Display position. */
  order: number;
  /** Optional ordinal value, so analysis can treat the enum as a scale. */
  score?: number;
}

export interface NumberConstraints {
  unit?: string;
  min?: number;
  max?: number;
  /** Maximum decimal places. */
  precision?: number;
}

export interface EnumConstraints {
  /** Sorted by `order`. */
  options: EnumOption[];
}

export interface MultiEnumConstraints extends EnumConstraints {
  minSelected?: number;
  maxSelected?: number;
}

export interface TextConstraints {
  minLength?: number;
  maxLength?: number;
}

export interface DateConstraints {
  min?: LocalDate;
  max?: LocalDate;
}

export interface RefConstraints {
  /** The thing type every referenced thing must have. */
  thingTypeId: string;
}

type NoConstraints = Record<string, never>;

/** A value type with its constraints: what one version record fixes. */
export type ValueShape =
  | { valueType: "boolean"; constraints: NoConstraints }
  | { valueType: "number"; constraints: NumberConstraints }
  | { valueType: "enum"; constraints: EnumConstraints }
  | { valueType: "multi_enum"; constraints: MultiEnumConstraints }
  | { valueType: "text"; constraints: TextConstraints }
  | { valueType: "date"; constraints: DateConstraints }
  | { valueType: "datetime"; constraints: NoConstraints }
  | { valueType: "ref"; constraints: RefConstraints }
  | { valueType: "multi_ref"; constraints: RefConstraints };

/**
 * A value as core passes it around:
 * - `boolean`: boolean. `number`: finite number. `datetime`: an `Instant`.
 * - `enum`: the option key. `text`: any string, including `""`.
 * - `date`: `YYYY-MM-DD`. `ref`: the thing's id.
 * - `multi_enum`: option keys. `multi_ref`: thing ids. Neither repeats a member;
 *   an empty `multi_ref` stores no rows, so it reads back as missing.
 */
export type SingleValue = boolean | number | string;
export type Value = SingleValue | string[];

// ---------------------------------------------------------------------------
// Shapes

/**
 * The shape for `valueType` and `constraints` as read from input, a version
 * record, or an import, in canonical form: known keys only, in a fixed order,
 * options sorted by `order`. Throws, naming `label`, if `valueType` is not in
 * `allowed` or the constraints are invalid. Unknown constraint keys are
 * refused rather than dropped.
 */
export function parseShape(
  label: string,
  allowed: readonly ValueType[],
  valueType: unknown,
  constraints: unknown,
): ValueShape {
  if (!allowed.includes(valueType as ValueType)) {
    throw new Error(`${label}: value type must be one of ${allowed.join(", ")}`);
  }
  const type = valueType as ValueType;
  const raw = constraints ?? {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label}: constraints must be an object`);
  }
  const c = raw as Record<string, unknown>;
  const fail = (problem: string): never => {
    throw new Error(`${label}: ${problem}`);
  };
  const only = (...keys: string[]) => {
    for (const key of Object.keys(c)) {
      if (!keys.includes(key)) fail(`unknown ${type} constraint ${JSON.stringify(key)}`);
    }
  };
  const count = (key: string): number | undefined => {
    const n = c[key];
    if (n === undefined) return undefined;
    return Number.isSafeInteger(n) && (n as number) >= 0
      ? (n as number)
      : fail(`${key} must be a whole number of at least 0`);
  };
  const ordered = <T extends number | string>(
    key: string,
    min: T | undefined,
    max: T | undefined,
  ) => {
    if (min !== undefined && max !== undefined && min > max) {
      fail(`min${key} must not be greater than max${key}`);
    }
  };

  switch (type) {
    case "boolean":
    case "datetime":
      only();
      return { valueType: type, constraints: {} };

    case "number": {
      only("unit", "min", "max", "precision");
      const finite = (key: string) => {
        const n = c[key];
        if (n === undefined) return undefined;
        return typeof n === "number" && Number.isFinite(n) ? n : fail(`${key} must be a number`);
      };
      if (c.unit !== undefined && (typeof c.unit !== "string" || c.unit.trim() === "")) {
        fail("unit must be a non-empty string");
      }
      const min = finite("min");
      const max = finite("max");
      const precision = count("precision");
      ordered("", min, max);
      if (precision !== undefined && precision > 15) fail("precision must be at most 15");
      return {
        valueType: type,
        constraints: compact({ unit: (c.unit as string | undefined)?.trim(), min, max, precision }),
      };
    }

    case "enum":
    case "multi_enum": {
      if (type === "enum") only("options");
      else only("options", "minSelected", "maxSelected");
      const options = parseOptions(fail, c.options);
      if (type === "enum") return { valueType: type, constraints: { options } };
      const minSelected = count("minSelected");
      const maxSelected = count("maxSelected");
      ordered("Selected", minSelected, maxSelected);
      if (minSelected !== undefined && minSelected > options.length) {
        fail("minSelected must not exceed the number of options");
      }
      return { valueType: type, constraints: compact({ options, minSelected, maxSelected }) };
    }

    case "text": {
      only("minLength", "maxLength");
      const minLength = count("minLength");
      const maxLength = count("maxLength");
      ordered("Length", minLength, maxLength);
      return { valueType: type, constraints: compact({ minLength, maxLength }) };
    }

    case "date": {
      only("min", "max");
      for (const key of ["min", "max"]) {
        if (c[key] !== undefined && !isLocalDate(c[key])) fail(`${key} must be a YYYY-MM-DD date`);
      }
      const min = c.min as LocalDate | undefined;
      const max = c.max as LocalDate | undefined;
      ordered("", min, max);
      return { valueType: type, constraints: compact({ min, max }) };
    }

    case "ref":
    case "multi_ref":
      only("thingTypeId");
      if (!isUuid(c.thingTypeId)) fail("thingTypeId must be a lowercase UUID");
      return { valueType: type, constraints: { thingTypeId: c.thingTypeId as string } };
  }
}

function parseOptions(fail: (problem: string) => never, raw: unknown): EnumOption[] {
  if (!Array.isArray(raw) || raw.length === 0) fail("options must be a non-empty array");
  const options = (raw as unknown[]).map((o, i): EnumOption => {
    if (typeof o !== "object" || o === null || Array.isArray(o)) {
      return fail(`options[${i}] must be an object`);
    }
    const { key, order, score, ...rest } = o as Record<string, unknown>;
    const unknown = Object.keys(rest)[0];
    if (unknown !== undefined) fail(`options[${i}]: unknown field ${JSON.stringify(unknown)}`);
    if (typeof key !== "string" || key.trim() === "" || key !== key.trim()) {
      fail(`options[${i}]: key must be a non-empty string without surrounding spaces`);
    }
    if (!Number.isSafeInteger(order)) fail(`options[${i}]: order must be an integer`);
    if (score !== undefined && (typeof score !== "number" || !Number.isFinite(score))) {
      fail(`options[${i}]: score must be a number`);
    }
    return compact({ key: key as string, order: order as number, score: score as number });
  });
  const keys = new Set(options.map((o) => o.key));
  if (keys.size !== options.length) fail("option keys must be unique");
  if (new Set(options.map((o) => o.order)).size !== options.length) {
    fail("option orders must be unique");
  }
  return options.sort((a, b) => a.order - b.order);
}

/** `obj` without its `undefined` properties, keeping key order. */
function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

/** Whether two canonical shapes are identical, so a change between them needs no new version. */
export function sameShape(a: ValueShape, b: ValueShape): boolean {
  return (
    a.valueType === b.valueType && JSON.stringify(a.constraints) === JSON.stringify(b.constraints)
  );
}

/**
 * Option labels as read from input, a definition record, or an import: option
 * key to non-empty label. Not checked against any version's options, since
 * labels are not versioned and older versions' keys keep their labels.
 */
export function parseOptionLabels(label: string, raw: unknown): Record<string, string> {
  const labels = raw ?? {};
  if (typeof labels !== "object" || Array.isArray(labels)) {
    throw new Error(`${label}: option labels must be an object`);
  }
  const result: Record<string, string> = {};
  for (const [key, text] of Object.entries(labels)) {
    if (typeof text !== "string" || text.trim() === "") {
      throw new Error(
        `${label}: label for option ${JSON.stringify(key)} must be a non-empty string`,
      );
    }
    result[key] = text.trim();
  }
  return result;
}

/** The label to show for option `key`: its label, or the key itself. */
export function optionLabel(labels: Readonly<Record<string, string>>, key: string): string {
  return labels[key] ?? key;
}

// ---------------------------------------------------------------------------
// Values

/**
 * `value` if it is valid for `shape`, or throws naming `label`. Invalid values
 * are refused, never coerced. Whether a `ref` target exists and has the right
 * thing type needs the database, so callers check that.
 */
export function validateValue(label: string, shape: ValueShape, value: unknown): Value {
  const fail = (problem: string): never => {
    throw new Error(`${label}: ${problem}`);
  };
  const keyOf = (options: readonly EnumOption[], key: unknown) =>
    typeof key === "string" && options.some((o) => o.key === key)
      ? key
      : fail(`${JSON.stringify(key)} is not an option`);
  const members = (v: unknown): string[] => {
    if (!Array.isArray(v)) return fail("must be an array");
    if (new Set(v).size !== v.length) fail("must not repeat a member");
    return v;
  };

  switch (shape.valueType) {
    case "boolean":
      return typeof value === "boolean" ? value : fail("must be true or false");

    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return fail("must be a number");
      const { min, max, precision } = shape.constraints;
      if (min !== undefined && value < min) fail(`must be at least ${min}`);
      if (max !== undefined && value > max) fail(`must be at most ${max}`);
      if (precision !== undefined && Number(value.toFixed(precision)) !== value) {
        fail(`must have at most ${precision} decimal places`);
      }
      return value;
    }

    case "enum":
      return keyOf(shape.constraints.options, value);

    case "multi_enum": {
      const keys = members(value);
      for (const key of keys) keyOf(shape.constraints.options, key);
      const { minSelected, maxSelected } = shape.constraints;
      if (minSelected !== undefined && keys.length < minSelected) {
        fail(`must select at least ${minSelected}`);
      }
      if (maxSelected !== undefined && keys.length > maxSelected) {
        fail(`must select at most ${maxSelected}`);
      }
      return keys;
    }

    case "text": {
      if (typeof value !== "string") return fail("must be a string");
      const { minLength, maxLength } = shape.constraints;
      if (minLength !== undefined && value.length < minLength) {
        fail(`must be at least ${minLength} characters`);
      }
      if (maxLength !== undefined && value.length > maxLength) {
        fail(`must be at most ${maxLength} characters`);
      }
      return value;
    }

    case "date": {
      if (!isLocalDate(value)) return fail("must be a YYYY-MM-DD date");
      const { min, max } = shape.constraints;
      if (min !== undefined && value < min) fail(`must be on or after ${min}`);
      if (max !== undefined && value > max) fail(`must be on or before ${max}`);
      return value;
    }

    case "datetime":
      if (!isInstant(value)) return fail("must be an instant in epoch milliseconds");
      try {
        instantToIso(value);
      } catch {
        fail("must be between years 0000 and 9999");
      }
      return value;

    case "ref":
      return isUuid(value) ? value : fail("must be a thing id");

    case "multi_ref": {
      const ids = members(value);
      for (const id of ids) if (!isUuid(id)) fail(`${JSON.stringify(id)} is not a thing id`);
      return ids;
    }
  }
}

// ---------------------------------------------------------------------------
// Storage

/** The typed value columns, as SQLite returns them. */
export interface ValueColumns {
  /** 0 or 1. */
  value_bool: number | null;
  value_num: number | null;
  value_enum: string | null;
  value_text: string | null;
  /** `YYYY-MM-DD`. */
  value_date: string | null;
  /** Epoch milliseconds, UTC. */
  value_instant: Instant | null;
  /** A thing id. Also each `multi_ref` row's member. */
  value_ref: string | null;
}

export type ValueColumn = keyof ValueColumns;

export const VALUE_COLUMNS = [
  "value_bool",
  "value_num",
  "value_enum",
  "value_text",
  "value_date",
  "value_instant",
  "value_ref",
] as const satisfies readonly ValueColumn[];

const COLUMN_OF: Record<SingleValueType, ValueColumn> = {
  boolean: "value_bool",
  number: "value_num",
  enum: "value_enum",
  text: "value_text",
  date: "value_date",
  datetime: "value_instant",
  ref: "value_ref",
};

/** The column a single value of `valueType` is stored in. */
export function valueColumnOf(valueType: SingleValueType): ValueColumn {
  return COLUMN_OF[valueType];
}

/**
 * The columns `columns` (default: all seven) for a validated `value`: its own
 * column set, every other one `null`, so writing the result also clears a value
 * stored under another type. Pass a table's own columns when it has fewer,
 * such as observations.
 */
export function encodeValue<C extends ValueColumn = ValueColumn>(
  valueType: SingleValueType,
  value: SingleValue,
  columns: readonly C[] = VALUE_COLUMNS as readonly ValueColumn[] as readonly C[],
): Pick<ValueColumns, C> {
  const column = COLUMN_OF[valueType];
  if (!(columns as readonly ValueColumn[]).includes(column)) {
    throw new Error(`No ${column} column for a ${valueType} value`);
  }
  const encoded = Object.fromEntries(columns.map((c) => [c, null])) as Record<C, unknown>;
  encoded[column as C] = valueType === "boolean" ? Number(value) : value;
  return encoded as Pick<ValueColumns, C>;
}

/**
 * The single value of `valueType` stored in `row`. Throws, naming `label`, if
 * its column is empty, which for a live record means the data is corrupt.
 */
export function decodeValue(
  label: string,
  valueType: SingleValueType,
  row: Partial<ValueColumns>,
): SingleValue {
  const stored = row[COLUMN_OF[valueType]];
  if (stored === null || stored === undefined) {
    throw new Error(`${label}: no ${valueType} value stored`);
  }
  return valueType === "boolean" ? stored === 1 : stored;
}
