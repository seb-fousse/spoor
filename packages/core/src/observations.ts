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
  sameShape,
  type Value,
  type ValueShape,
  validateValue,
} from "./values";

/**
 * Observations (see docs/data-spec.md § 2. Observations): metrics, their
 * immutable versions, and at most one daily observation per metric and day.
 *
 * Deleting is permanent. Every write runs in one transaction, so a value is
 * validated against the version it is stored with.
 */

/** The writer of values the user entered. Any other writer is automated. */
const MANUAL = "manual";

export interface ObservationMetric {
  id: string;
  name: string;
  description: string | null;
  /** Option key to label, for `enum` and `multi_enum`. Not versioned. */
  optionLabels: Record<string, string>;
  /** The current version. */
  schemaVersion: number;
  createdAt: Instant;
  updatedAt: Instant;
  archivedAt: Instant | null;
}

/** A shape an observation metric can have. */
export type MetricShape = Extract<ValueShape, { valueType: MetricValueType }>;

/** One immutable version of a metric. It is itself the shape, so it can be validated against. */
export type ObservationMetricVersion = MetricShape & {
  id: string;
  metricId: string;
  version: number;
  createdAt: Instant;
};

export interface Observation {
  id: string;
  metricId: string;
  /** The version the value was validated against. */
  metricVersion: number;
  date: LocalDate;
  /** The value type of `metricVersion`. */
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
type VersionRow = Selectable<DB["observation_metric_versions"]>;
type ObservationRow = Selectable<DB["observations"]>;

const VALUE_COLUMNS = ["value_bool", "value_num", "value_enum"] as const;

// ---------------------------------------------------------------------------
// Metrics

/** Creates the metric and its version 1. */
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
    const q = queryBuilder(db);
    await q
      .insertInto("observation_metrics")
      .values({
        id,
        name: requireName(label, input.name),
        description: optionalText(input.description),
        option_labels: JSON.stringify(parseOptionLabels(label, input.optionLabels)),
        schema_version: 1,
        created_at: t,
        updated_at: t,
      })
      .execute();
    await insertVersion(db, id, 1, shape);
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

/** Version `version` of the metric, or `undefined`. */
export async function getMetricVersion(
  db: Database,
  metricId: string,
  version: number,
): Promise<ObservationMetricVersion | undefined> {
  const row = await queryBuilder(db)
    .selectFrom("observation_metric_versions")
    .selectAll()
    .where("metric_id", "=", metricId)
    .where("version", "=", version)
    .executeTakeFirst();
  return row && toVersion(row);
}

/** Every version of the metric, oldest first. */
export async function listMetricVersions(
  db: Database,
  metricId: string,
): Promise<ObservationMetricVersion[]> {
  const rows = await queryBuilder(db)
    .selectFrom("observation_metric_versions")
    .selectAll()
    .where("metric_id", "=", metricId)
    .orderBy("version")
    .execute();
  return rows.map(toVersion);
}

/**
 * Renames, redescribes, or replaces the option labels. None of these
 * reinterpret values, so no version is created.
 */
export async function updateMetric(
  db: Database,
  id: string,
  patch: { name?: string; description?: string | null; optionLabels?: Record<string, string> },
): Promise<ObservationMetric> {
  const label = `Observation metric ${id}`;
  await transaction(db, async () => {
    const metric = await requireMetric(db, id);
    await queryBuilder(db)
      .updateTable("observation_metrics")
      .set({
        name: patch.name === undefined ? metric.name : requireName(label, patch.name),
        description:
          patch.description === undefined ? metric.description : optionalText(patch.description),
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

/**
 * Changes the value type or constraints. A different shape becomes the next
 * version and the metric's `schema_version`; the same shape changes nothing.
 * Existing observations keep the version they were validated against.
 */
export async function reviseMetric(
  db: Database,
  id: string,
  input: { valueType: MetricValueType; constraints?: unknown },
): Promise<ObservationMetric> {
  const shape = parseShape(
    `Observation metric ${id}`,
    METRIC_VALUE_TYPES,
    input.valueType,
    input.constraints,
  );
  await transaction(db, async () => {
    const metric = await requireMetric(db, id);
    const current = await requireVersion(db, id, metric.schemaVersion);
    if (sameShape(current, shape)) return;
    const version = metric.schemaVersion + 1;
    await insertVersion(db, id, version, shape);
    await queryBuilder(db)
      .updateTable("observation_metrics")
      .set({ schema_version: version, updated_at: now() })
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

/** Deletes the metric with its versions and observations. See `previewMetricDeletion`. */
export async function deleteMetric(db: Database, id: string): Promise<void> {
  await transaction(db, async () => {
    await requireMetric(db, id);
    await queryBuilder(db).deleteFrom("observation_metrics").where("id", "=", id).execute();
  });
}

// ---------------------------------------------------------------------------
// Observations

/**
 * Records the metric's value for `date`, validated against its current
 * version: inserts the day's observation, or revises it, moving it
 * to the current version. A `multi_enum` value replaces the selections.
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
    const version = await requireVersion(db, metricId, metric.schemaVersion);
    const existing = await q
      .selectFrom("observations")
      .select(["id", "written_by"])
      .where("metric_id", "=", metricId)
      .where("date", "=", date)
      .executeTakeFirst();
    const id = existing?.id ?? newId();
    // Validated even when skipped, so bad input never passes silently.
    const valid = validateValue(`Observation ${id}`, version, value);
    if (existing && writtenBy !== MANUAL && existing.written_by !== writtenBy) {
      return { id, skipped: true };
    }

    const t = now();
    const content = {
      metric_version: version.version,
      ...(version.valueType === "multi_enum"
        ? { value_bool: null, value_num: null, value_enum: null }
        : encodeValue(version.valueType, valid as boolean | number | string, VALUE_COLUMNS)),
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
    if (version.valueType === "multi_enum" && (valid as string[]).length > 0) {
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

async function insertVersion(db: Database, metricId: string, version: number, shape: ValueShape) {
  await queryBuilder(db)
    .insertInto("observation_metric_versions")
    .values({
      id: newId(),
      metric_id: metricId,
      version,
      value_type: shape.valueType,
      constraints: JSON.stringify(shape.constraints),
      created_at: now(),
    })
    .execute();
}

async function requireMetric(db: Database, id: string): Promise<ObservationMetric> {
  const metric = await getMetric(db, id);
  if (!metric) throw new Error(`Observation metric ${id}: not found`);
  return metric;
}

async function requireVersion(
  db: Database,
  metricId: string,
  version: number,
): Promise<ObservationMetricVersion> {
  const found = await getMetricVersion(db, metricId, version);
  if (!found) throw new Error(`Observation metric ${metricId}: version ${version} not found`);
  return found;
}

function toMetric(row: MetricRow): ObservationMetric {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    optionLabels: parseOptionLabels(`Observation metric ${row.id}`, JSON.parse(row.option_labels)),
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

function toVersion(row: VersionRow): ObservationMetricVersion {
  const shape = parseShape(
    `Observation metric ${row.metric_id}, version ${row.version}`,
    METRIC_VALUE_TYPES,
    row.value_type,
    JSON.parse(row.constraints),
  ) as MetricShape;
  return {
    ...shape,
    id: row.id,
    metricId: row.metric_id,
    version: row.version,
    createdAt: row.created_at,
  };
}

/** The observations in `rows`, with their values decoded by their version. */
async function toObservations(db: Database, rows: ObservationRow[]): Promise<Observation[]> {
  if (rows.length === 0) return [];
  const q = queryBuilder(db);
  const metricIds = [...new Set(rows.map((r) => r.metric_id))];
  const versions = new Map(
    (
      await q
        .selectFrom("observation_metric_versions")
        .selectAll()
        .where("metric_id", "in", metricIds)
        .execute()
    ).map((v) => [`${v.metric_id}/${v.version}`, toVersion(v)]),
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
    const version = versions.get(`${row.metric_id}/${row.metric_version}`) as MetricShape;
    let value: Value;
    if (version.valueType === "multi_enum") {
      const order = version.constraints.options.map((o) => o.key);
      // Keys missing from the version (only possible in corrupt data) sort last.
      const rank = (key: string) => {
        const i = order.indexOf(key);
        return i === -1 ? order.length : i;
      };
      value = (selected.get(row.id) ?? []).sort((a, b) => rank(a) - rank(b));
    } else {
      value = decodeValue(label, version.valueType, row);
    }
    return {
      id: row.id,
      metricId: row.metric_id,
      metricVersion: row.metric_version,
      date: row.date,
      valueType: version.valueType,
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
