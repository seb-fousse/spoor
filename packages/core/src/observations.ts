import type { Selectable } from "kysely";
import { isNonEmptyString, optionalText, requireName } from "./guards";
import { newId } from "./ids";
import type { Database } from "./platform/index";
import { queryBuilder } from "./query";
import type { DB } from "./schema/tables";
import { type Instant, isLocalDate, type LocalDate, now } from "./time";
import { transaction } from "./transaction";
import {
  decodeValue,
  encodeValue,
  METRIC_VALUE_TYPES,
  type MetricValueType,
  parseOptionLabels,
  parseShape,
  type Value,
  type ValueShape,
  validateValue,
} from "./values";

/**
 * Observations (see docs/data-spec.md § 2. Observations): metrics, and at most
 * one daily observation per metric and day.
 *
 * A metric's value type never changes; its constraints can, and are checked
 * when a value is recorded, so existing observations are not re-validated.
 * Deleting is permanent. Every write runs in one transaction.
 */

/** The writer of values the user entered. Any other writer is automated. */
const MANUAL = "manual";

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

export interface Observation {
  id: string;
  metricId: string;
  date: LocalDate;
  /** The value type of its metric. */
  valueType: MetricValueType;
  /** Option keys for `multi_enum`, in option order; `[]` is "nothing selected". */
  value: Value;
  source: string;
  externalId: string | null;
  writtenBy: string;
  writtenAt: Instant;
  createdAt: Instant;
  updatedAt: Instant;
}

/** What `recordObservation` did. */
export interface RecordObservationResult {
  /** The observation for the metric and day, as it now is. */
  observation: Observation;
  /** True if an automated writer left another writer's value in place. */
  skipped: boolean;
}

type MetricRow = Selectable<DB["observation_metrics"]>;
type ObservationRow = Selectable<DB["observations"]>;

const VALUE_COLUMNS = ["value_bool", "value_num", "value_enum"] as const;

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

// ---------------------------------------------------------------------------
// Observations

/**
 * Records the metric's value for `date`, validated against the metric: inserts
 * the day's observation, or revises it. A `multi_enum` value replaces the
 * selections.
 *
 * `writtenBy` (default `manual`) is the writer. The user always wins: an
 * automated writer leaves alone a value another writer set, returning
 * `skipped`. `source` (default: the writer) and `externalId` are set only when
 * the observation is created, and never change.
 */
export async function recordObservation(
  db: Database,
  metricId: string,
  date: LocalDate,
  value: Value,
  options: { writtenBy?: string; source?: string; externalId?: string | null } = {},
): Promise<RecordObservationResult> {
  const writtenBy = options.writtenBy ?? MANUAL;
  const source = options.source ?? writtenBy;
  const externalId = options.externalId ?? null;
  const metricLabel = `Observation metric ${metricId}`;
  const identifier = (field: string, id: string | null) => {
    if (id !== null && (!isNonEmptyString(id) || id !== id.trim())) {
      throw new Error(`${metricLabel}: invalid ${field} ${JSON.stringify(id)}`);
    }
  };
  identifier("writer", writtenBy);
  identifier("source", source);
  identifier("external id", externalId);
  if (!isLocalDate(date)) throw new Error(`${metricLabel}: invalid date ${JSON.stringify(date)}`);

  const { id, skipped } = await transaction(db, async () => {
    const q = queryBuilder(db);
    const metric = await requireMetric(db, metricId);
    if (metric.archivedAt !== null) throw new Error(`${metricLabel}: archived`);
    const existing = await q
      .selectFrom("observations")
      .select(["id", "written_by"])
      .where("metric_id", "=", metricId)
      .where("date", "=", date)
      .executeTakeFirst();
    const id = existing?.id ?? newId();
    // Validated even when skipped, so bad input never passes silently.
    const valid = validateValue(`Observation ${id}`, metric, value);
    if (existing && writtenBy !== MANUAL && existing.written_by !== writtenBy) {
      return { id, skipped: true };
    }

    const t = now();
    const content = {
      ...(metric.valueType === "multi_enum"
        ? { value_bool: null, value_num: null, value_enum: null }
        : encodeValue(metric.valueType, valid as boolean | number | string, VALUE_COLUMNS)),
      written_by: writtenBy,
      written_at: t,
      updated_at: t,
    };
    if (existing) {
      await q.updateTable("observations").set(content).where("id", "=", id).execute();
      await q.deleteFrom("observation_selections").where("observation_id", "=", id).execute();
    } else {
      if (externalId !== null) {
        const clash = await q
          .selectFrom("observations")
          .select("id")
          .where("source", "=", source)
          .where("external_id", "=", externalId)
          .executeTakeFirst();
        if (clash) {
          throw new Error(
            `Observation ${clash.id}: already has external id ${JSON.stringify(externalId)} from ${source}`,
          );
        }
      }
      await q
        .insertInto("observations")
        .values({
          id,
          metric_id: metricId,
          date,
          source,
          external_id: externalId,
          created_at: t,
          ...content,
        })
        .execute();
    }
    if (metric.valueType === "multi_enum" && (valid as string[]).length > 0) {
      await q
        .insertInto("observation_selections")
        .values(
          (valid as string[]).map((key) => ({ id: newId(), observation_id: id, option_key: key })),
        )
        .execute();
    }
    return { id, skipped: false };
  });
  return { observation: (await getObservation(db, id)) as Observation, skipped };
}

/** The observation with `id`, or `undefined`. */
export async function getObservation(db: Database, id: string): Promise<Observation | undefined> {
  const row = await queryBuilder(db)
    .selectFrom("observations")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirst();
  return row && (await toObservations(db, [row]))[0];
}

/**
 * The metric's observations, latest day first, optionally only those from
 * `from` to `to` inclusive.
 */
export async function listObservations(
  db: Database,
  metricId: string,
  options: { from?: LocalDate; to?: LocalDate } = {},
): Promise<Observation[]> {
  let query = queryBuilder(db)
    .selectFrom("observations")
    .selectAll()
    .where("metric_id", "=", metricId);
  for (const [bound, op] of [
    ["from", ">="],
    ["to", "<="],
  ] as const) {
    const date = options[bound];
    if (date === undefined) continue;
    if (!isLocalDate(date)) {
      throw new Error(
        `Observation metric ${metricId}: invalid ${bound} date ${JSON.stringify(date)}`,
      );
    }
    query = query.where("date", op, date);
  }
  return toObservations(db, await query.orderBy("date", "desc").execute());
}

/** An active metric and its observation on one day, `null` when unrecorded. */
export interface MetricDay {
  metric: ObservationMetric;
  observation: Observation | null;
}

/** Every non-archived metric, in `listMetrics` order, with its observation on `date`. */
export async function listDayObservations(db: Database, date: LocalDate): Promise<MetricDay[]> {
  if (!isLocalDate(date)) throw new Error(`Invalid date ${JSON.stringify(date)}`);
  const metrics = (await listMetrics(db)).filter((m) => m.archivedAt === null);
  if (metrics.length === 0) return [];
  const rows = await queryBuilder(db)
    .selectFrom("observations")
    .selectAll()
    .where("date", "=", date)
    .where(
      "metric_id",
      "in",
      metrics.map((m) => m.id),
    )
    .execute();
  const byMetric = new Map((await toObservations(db, rows)).map((o) => [o.metricId, o]));
  return metrics.map((metric) => ({ metric, observation: byMetric.get(metric.id) ?? null }));
}

/** Deletes the observation. */
export async function deleteObservation(db: Database, id: string): Promise<void> {
  await transaction(db, async () => {
    const q = queryBuilder(db);
    const found = await q
      .selectFrom("observations")
      .select("id")
      .where("id", "=", id)
      .executeTakeFirst();
    if (!found) throw new Error(`Observation ${id}: not found`);
    await q.deleteFrom("observations").where("id", "=", id).execute();
  });
}

// ---------------------------------------------------------------------------
// Internals

async function requireMetric(db: Database, id: string): Promise<ObservationMetric> {
  const metric = await getMetric(db, id);
  if (!metric) throw new Error(`Observation metric ${id}: not found`);
  return metric;
}

function toMetric(row: MetricRow): ObservationMetric {
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

/** The observations in `rows`, with their values decoded by their metric's type. */
async function toObservations(db: Database, rows: ObservationRow[]): Promise<Observation[]> {
  if (rows.length === 0) return [];
  const q = queryBuilder(db);
  const metricIds = [...new Set(rows.map((r) => r.metric_id))];
  const metrics = new Map(
    (
      await q.selectFrom("observation_metrics").selectAll().where("id", "in", metricIds).execute()
    ).map((m) => [m.id, toMetric(m)]),
  );
  const selected = new Map<string, string[]>();
  for (const s of await q
    .selectFrom("observation_selections")
    .select(["observation_id", "option_key"])
    .where(
      "observation_id",
      "in",
      rows.map((r) => r.id),
    )
    .orderBy("option_key")
    .execute()) {
    selected.set(s.observation_id, [...(selected.get(s.observation_id) ?? []), s.option_key]);
  }

  return rows.map((row) => {
    const label = `Observation ${row.id}`;
    const metric = metrics.get(row.metric_id) as ObservationMetric;
    let value: Value;
    if (metric.valueType === "multi_enum") {
      const order = metric.constraints.options.map((o) => o.key);
      // Keys of options removed since sort last.
      const rank = (key: string) => {
        const i = order.indexOf(key);
        return i === -1 ? order.length : i;
      };
      value = (selected.get(row.id) ?? []).sort((a, b) => rank(a) - rank(b));
    } else {
      value = decodeValue(label, metric.valueType, row);
    }
    return {
      id: row.id,
      metricId: row.metric_id,
      date: row.date,
      valueType: metric.valueType,
      value,
      source: row.source,
      externalId: row.external_id,
      writtenBy: row.written_by,
      writtenAt: row.written_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  });
}
