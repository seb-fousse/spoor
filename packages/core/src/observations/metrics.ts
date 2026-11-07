import type { Selectable } from "kysely";
import type { Database } from "../db/platform";
import { queryBuilder } from "../db/query";
import type { DB } from "../db/schema/tables";
import { transaction } from "../db/transaction";
import { optionalText, requireName } from "../lib/guards";
import { newId } from "../lib/ids";
import { type Instant, now } from "../lib/time";
import {
  METRIC_VALUE_TYPES,
  type MetricValueType,
  parseOptionLabels,
  parseShape,
  type ValueShape,
} from "../values/values";

/**
 * Observation metrics (see docs/data-spec.md § 2. Observations). A metric's value
 * type never changes; its constraints can, and are checked when a value is
 * recorded, so existing observations are not re-validated. Deleting is permanent
 * and takes the metric's observations with it. Every write runs in one transaction.
 */

/** A shape an observation metric can have. */
export type MetricShape = Extract<ValueShape, { valueType: MetricValueType }>;

/** A metric. It is itself its shape, so values can be validated against it. */
export type ObservationMetric = MetricShape & {
  id: string;
  name: string;
  description: string | null;
  /** Option key to label, for `enum` and `multi_enum`. */
  optionLabels: Record<string, string>;
  createdAt: Instant;
  updatedAt: Instant;
  archivedAt: Instant | null;
};

type MetricRow = Selectable<DB["observation_metrics"]>;

// ---------------------------------------------------------------------------
// Metrics

/** Creates a metric. Its value type is fixed from now on. */
export async function createMetric(
  db: Database,
  input: {
    name: string;
    description?: string | null;
    valueType: MetricValueType;
    constraints?: unknown;
    optionLabels?: Record<string, string>;
  },
): Promise<ObservationMetric> {
  const id = newId();
  const label = `Observation metric ${id}`;
  const shape = parseShape(label, METRIC_VALUE_TYPES, input.valueType, input.constraints);
  const t = now();
  await transaction(db, async () => {
    await queryBuilder(db)
      .insertInto("observation_metrics")
      .values({
        id,
        name: requireName(label, input.name),
        description: optionalText(input.description),
        value_type: shape.valueType,
        constraints: JSON.stringify(shape.constraints),
        option_labels: JSON.stringify(parseOptionLabels(label, input.optionLabels)),
        created_at: t,
        updated_at: t,
      })
      .execute();
  });
  return (await getMetric(db, id)) as ObservationMetric;
}

/** The metric with `id`, or `undefined`. */
export async function getMetric(db: Database, id: string): Promise<ObservationMetric | undefined> {
  const row = await queryBuilder(db)
    .selectFrom("observation_metrics")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row && toMetric(row);
}

/** Every metric by name, archived included. */
export async function listMetrics(db: Database): Promise<ObservationMetric[]> {
  const rows = await queryBuilder(db)
    .selectFrom("observation_metrics")
    .selectAll()
    .orderBy("name", (ob) => ob.collate("nocase"))
    .orderBy("id")
    .execute();
  return rows.map(toMetric);
}

/**
 * Renames, redescribes, or replaces the constraints or option labels. The
 * constraints are parsed for the metric's value type, which never changes.
 */
export async function updateMetric(
  db: Database,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    constraints?: unknown;
    optionLabels?: Record<string, string>;
  },
): Promise<ObservationMetric> {
  const label = `Observation metric ${id}`;
  await transaction(db, async () => {
    const metric = await requireMetric(db, id);
    const constraints =
      patch.constraints === undefined
        ? metric.constraints
        : parseShape(label, METRIC_VALUE_TYPES, metric.valueType, patch.constraints).constraints;
    await queryBuilder(db)
      .updateTable("observation_metrics")
      .set({
        name: patch.name === undefined ? metric.name : requireName(label, patch.name),
        description:
          patch.description === undefined ? metric.description : optionalText(patch.description),
        constraints: JSON.stringify(constraints),
        option_labels: JSON.stringify(
          patch.optionLabels === undefined
            ? metric.optionLabels
            : parseOptionLabels(label, patch.optionLabels),
        ),
        updated_at: now(),
      })
      .where("id", "=", id)
      .execute();
  });
  return (await getMetric(db, id)) as ObservationMetric;
}

/** Archives or unarchives. An archived metric's observations stay, but none can be recorded. */
export async function setMetricArchived(
  db: Database,
  id: string,
  archived: boolean,
): Promise<void> {
  await transaction(db, async () => {
    await requireMetric(db, id);
    const t = now();
    await queryBuilder(db)
      .updateTable("observation_metrics")
      .set({ archived_at: archived ? t : null, updated_at: t })
      .where("id", "=", id)
      .execute();
  });
}

/** What `deleteMetric` would delete with the metric, for the user to confirm. */
export async function previewMetricDeletion(
  db: Database,
  id: string,
): Promise<{ observations: number }> {
  await requireMetric(db, id);
  const { n } = await queryBuilder(db)
    .selectFrom("observations")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("metric_id", "=", id)
    .executeTakeFirstOrThrow();
  return { observations: n };
}

/** Deletes the metric with its observations. See `previewMetricDeletion`. */
export async function deleteMetric(db: Database, id: string): Promise<void> {
  await transaction(db, async () => {
    await requireMetric(db, id);
    await queryBuilder(db).deleteFrom("observation_metrics").where("id", "=", id).execute();
  });
}

export async function requireMetric(db: Database, id: string): Promise<ObservationMetric> {
  const metric = await getMetric(db, id);
  if (!metric) throw new Error(`Observation metric ${id}: not found`);
  return metric;
}

export function toMetric(row: MetricRow): ObservationMetric {
  const label = `Observation metric ${row.id}`;
  const shape = parseShape(
    label,
    METRIC_VALUE_TYPES,
    row.value_type,
    JSON.parse(row.constraints),
  ) as MetricShape;
  return {
    ...shape,
    id: row.id,
    name: row.name,
    description: row.description,
    optionLabels: parseOptionLabels(label, JSON.parse(row.option_labels)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}
