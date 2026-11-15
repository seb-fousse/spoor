import type { Database } from "../db/platform";
import { queryBuilder } from "../db/query";
import { valueLabel, valueSubject } from "../definitions/engine";
import { definitionQuery } from "../definitions/plugin";
import type { DefinitionTables } from "../definitions/tables";
import {
  isSpoorError,
  parseStored,
  type SpoorEntity,
  type SpoorErrorDetails,
} from "../lib/spoor-error";
import { OBSERVATION_VALUE_COLUMNS } from "../observations/observations";
import {
  decodeValue,
  FIELD_VALUE_TYPES,
  isMultiValueType,
  METRIC_VALUE_TYPES,
  parseOptionLabels,
  parseShape,
  VALUE_COLUMNS,
  type ValueColumn,
  type ValueColumns,
  type ValueShape,
  type ValueType,
  validateStoredValue,
  valueColumnOf,
} from "../values/values";
import type { CheckProblem } from "./registry";

/**
 * Import's checks that definitions and values are ones core could have written
 * (see docs/data-spec.md § Export and import), as the registry's `check`s. Import
 * runs them in table order, so a table's values are checked after the
 * definitions they are read with.
 *
 * Definitions are parsed as core reads them (`parseShape`, `parseOptionLabels`),
 * so an imported one never reads back as corrupt.
 *
 * Values are checked strictly for what no edit to their definition changes: the
 * value type and the column it is stored in, a field of the record's own type,
 * one thing at most for a `ref`, an enum key that could be an option's, and a
 * reference to a thing of the field's thing type. The foreign key on
 * `value_ref` already refuses a reference to a missing thing, when it is
 * inserted.
 *
 * Constraint violations are allowed. Constraints are edited in place and
 * checked only when a value is written (§ Changing definitions): tightening
 * `min`, `maxLength` or `maxSelected`, or removing an option, leaves the values
 * already stored as they are, and the app keeps showing them. So a valid export
 * can hold values that break the constraints in the same file, and refusing it
 * would refuse the user's own data. Those values import as they are, as
 * `validateStoredValue` allows them. `required` is not checked either, for the
 * same reason.
 *
 * Internal to core: not exported from the barrel.
 */

/** The first observation metric core could not read, if any. */
export async function checkMetrics(db: Database): Promise<CheckProblem | undefined> {
  for (const row of await metricRows(db)) {
    const problem = definitionProblem(
      row,
      "Observation metric",
      "observation_metric",
      METRIC_VALUE_TYPES,
    );
    if (problem) return problem;
  }
  return undefined;
}

/** A check for the first thing or log field core could not read, if any. */
export function checkFields(tables: DefinitionTables) {
  return async (db: Database): Promise<CheckProblem | undefined> => {
    for (const row of await fieldRows(db, tables)) {
      const problem = definitionProblem(
        row,
        tables.fieldKind,
        tables.fieldEntity,
        FIELD_VALUE_TYPES,
      );
      if (problem) return problem;
    }
    return undefined;
  };
}

/** The first observation whose value its metric could not hold, if any. */
export async function checkObservations(db: Database): Promise<CheckProblem | undefined> {
  const shapes = await metricShapes(db);
  const rows = await queryBuilder(db)
    .selectFrom("observations")
    .selectAll()
    .orderBy("id")
    .execute();
  for (const row of rows) {
    const problem = valueProblem(
      row.id,
      `Observation ${row.id}`,
      observationSubject(row.id, row.metric_id),
      shapes.get(row.metric_id) as ValueShape,
      row,
      OBSERVATION_VALUE_COLUMNS,
    );
    if (problem) return problem;
  }
  return undefined;
}

/** The first selection of an observation that its metric could not hold, if any. */
export async function checkSelections(db: Database): Promise<CheckProblem | undefined> {
  const shapes = await metricShapes(db);
  const rows = await queryBuilder(db)
    .selectFrom("observation_selections as s")
    .innerJoin("observations as o", "o.id", "s.observation_id")
    .select(["s.id", "s.observation_id", "s.option_key", "o.metric_id"])
    .orderBy("s.id")
    .execute();
  for (const row of rows) {
    const label = `Observation ${row.observation_id}`;
    const details = observationSubject(row.observation_id, row.metric_id);
    const shape = shapes.get(row.metric_id) as ValueShape;
    if (shape.valueType !== "multi_enum") {
      return {
        message: `${label}: a ${shape.valueType} value has no selections`,
        rowId: row.id,
        details: { ...details, rule: "type" },
      };
    }
    // One selection at a time, to name it: the database keeps them unique.
    const problem = problemOf(row.id, "option_key", () =>
      validateStoredValue(label, shape, [row.option_key], details),
    );
    if (problem) return problem;
  }
  return undefined;
}

/**
 * A check for the first thing or log field value its field could not hold, if
 * any. A `multi_ref` stores one row per thing, each checked on its own.
 */
export function checkFieldValues(tables: DefinitionTables) {
  return async (db: Database): Promise<CheckProblem | undefined> => {
    const q = definitionQuery(db, tables);
    const fields = new Map(
      (await fieldRows(db, tables)).map((row) => [
        row.id,
        {
          typeId: row.def_type_id,
          shape: shapeOf(row, tables.fieldKind, tables.fieldEntity, FIELD_VALUE_TYPES),
        },
      ]),
    );
    const typeOf = new Map(
      (await q.selectFrom("def_records").select(["id", "def_type_id"]).execute()).map((r) => [
        r.id,
        r.def_type_id,
      ]),
    );
    const thingTypeOf = new Map(
      (await queryBuilder(db).selectFrom("things").select(["id", "thing_type_id"]).execute()).map(
        (t) => [t.id, t.thing_type_id],
      ),
    );
    const refs = new Set<string>();
    for (const row of await q.selectFrom("def_values").selectAll().orderBy("id").execute()) {
      const recordId = row.def_record_id;
      const label = valueLabel(tables, recordId, row.field_id);
      const details = valueSubject(tables, recordId, row.field_id);
      // The foreign keys make sure the field and the record exist.
      const field = fields.get(row.field_id) as { typeId: string; shape: ValueShape };
      const typeId = typeOf.get(recordId);
      if (field.typeId !== typeId) {
        return {
          message: `${label}: not a field of ${tables.typeKind.toLowerCase()} ${typeId}`,
          rowId: row.id,
          column: "field_id",
          details,
        };
      }
      const problem = valueProblem(row.id, label, details, field.shape, row, VALUE_COLUMNS);
      if (problem) return problem;

      const { shape } = field;
      if (shape.valueType !== "ref" && shape.valueType !== "multi_ref") continue;
      const refProblem = (message: string): CheckProblem => ({
        message: `${label}: ${message}`,
        rowId: row.id,
        column: "value_ref",
        details: { ...details, rule: "type" },
      });
      const thingId = row.value_ref as string;
      if (thingTypeOf.get(thingId) !== shape.constraints.thingTypeId) {
        return refProblem(`thing ${thingId} is not of thing type ${shape.constraints.thingTypeId}`);
      }
      if (shape.valueType === "ref") {
        const key = `${recordId} ${row.field_id}`;
        if (refs.has(key)) return refProblem("a ref value holds one thing");
        refs.add(key);
      }
    }
    return undefined;
  };
}

// ---------------------------------------------------------------------------
// Internals

interface DefinitionRow {
  id: string;
  value_type: string;
  constraints: string;
  option_labels: string;
}

function metricRows(db: Database) {
  return queryBuilder(db)
    .selectFrom("observation_metrics")
    .select(["id", "value_type", "constraints", "option_labels"])
    .orderBy("id")
    .execute();
}

function fieldRows(db: Database, tables: DefinitionTables) {
  return definitionQuery(db, tables)
    .selectFrom("def_fields")
    .select(["id", "def_type_id", "value_type", "constraints", "option_labels"])
    .orderBy("id")
    .execute();
}

/** The definition's shape, checking its option labels too. Throws `invalid`. */
function readDefinition(
  row: DefinitionRow,
  kind: string,
  entity: SpoorEntity,
  allowed: readonly ValueType[],
): ValueShape {
  const label = `${kind} ${row.id}`;
  const subject: SpoorErrorDetails = { entity, id: row.id };
  const shape = parseShape(label, allowed, row.value_type, JSON.parse(row.constraints), subject);
  parseOptionLabels(label, JSON.parse(row.option_labels), subject);
  return shape;
}

/** The input property `readDefinition` names in `details.field`, as its column. */
const DEFINITION_COLUMNS: Readonly<Record<string, string>> = {
  valueType: "value_type",
  constraints: "constraints",
  optionLabels: "option_labels",
};

function definitionProblem(
  row: DefinitionRow,
  kind: string,
  entity: SpoorEntity,
  allowed: readonly ValueType[],
): CheckProblem | undefined {
  const problem = problemOf(row.id, undefined, () => readDefinition(row, kind, entity, allowed));
  return problem && { ...problem, column: DEFINITION_COLUMNS[problem.details?.field ?? ""] };
}

/**
 * The shape of a definition its table's `check` has already accepted: the
 * checks of definitions run before those of their values.
 */
function shapeOf(
  row: DefinitionRow,
  kind: string,
  entity: SpoorEntity,
  allowed: readonly ValueType[],
): ValueShape {
  return parseStored(() => readDefinition(row, kind, entity, allowed));
}

async function metricShapes(db: Database): Promise<Map<string, ValueShape>> {
  return new Map(
    (await metricRows(db)).map((row) => [
      row.id,
      shapeOf(row, "Observation metric", "observation_metric", METRIC_VALUE_TYPES),
    ]),
  );
}

function observationSubject(id: string, metricId: string): SpoorErrorDetails {
  return { entity: "observation", id, field: "value", metricId };
}

/**
 * What is wrong with the value `row` stores in its `columns` for `shape`, or
 * `undefined`: exactly the column of the value type must be set, none for a
 * `multi_enum`, whose keys are rows of their own, and its value must pass
 * `validateStoredValue`. A `multi_ref` row holds one member.
 */
function valueProblem(
  rowId: string,
  label: string,
  details: SpoorErrorDetails,
  shape: ValueShape,
  row: Partial<ValueColumns>,
  columns: readonly ValueColumn[],
): CheckProblem | undefined {
  const { valueType } = shape;
  const expected =
    valueType === "multi_enum"
      ? undefined
      : isMultiValueType(valueType)
        ? "value_ref"
        : valueColumnOf(valueType);
  // The database's CHECK allows one column at most.
  const set = columns.find((c) => row[c] !== null && row[c] !== undefined);
  if (set !== expected) {
    return {
      message: `${label}: a ${valueType} value is stored in ${expected ?? "no value column"}`,
      rowId,
      column: set ?? expected,
      details: { ...details, rule: "type" },
    };
  }
  if (expected === undefined) return undefined;
  const value = isMultiValueType(valueType) ? [row.value_ref] : decodeValue(label, valueType, row);
  return problemOf(rowId, expected, () => validateStoredValue(label, shape, value, details));
}

/** `run`'s `invalid` error as the problem with `rowId`'s `column`, or `undefined` if it passes. */
function problemOf(
  rowId: string,
  column: string | undefined,
  run: () => unknown,
): CheckProblem | undefined {
  try {
    run();
    return undefined;
  } catch (error) {
    if (!isSpoorError(error) || error.code !== "invalid") throw error;
    return { message: error.message, rowId, column, details: error.details };
  }
}
