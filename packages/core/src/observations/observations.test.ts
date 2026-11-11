import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/platform";
import { migrate } from "../db/schema/migrate";
import { createInMemoryDatabase } from "../testing/in-memory-database";
import {
  createMetric,
  deleteMetric,
  getMetric,
  listMetrics,
  type ObservationMetric,
  previewMetricDeletion,
  setMetricArchived,
  updateMetric,
} from "./metrics";
import {
  countDayObservations,
  deleteObservation,
  getObservation,
  listDayObservations,
  listObservations,
  recordObservation,
} from "./observations";

const MOOD = {
  options: [
    { key: "low", order: 1, score: 1 },
    { key: "ok", order: 2, score: 3 },
    { key: "high", order: 3, score: 5 },
  ],
};
const SYMPTOMS = {
  options: [
    { key: "headache", order: 1 },
    { key: "cough", order: 2 },
    { key: "fever", order: 3 },
  ],
  maxSelected: 2,
};

describe("observations", () => {
  let db: Database & { close(): void };

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await migrate(db);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  const water = () =>
    createMetric(db, { name: "Water", valueType: "number", constraints: { min: 0, max: 20 } });
  const symptoms = () =>
    createMetric(db, { name: "Symptoms", valueType: "multi_enum", constraints: SYMPTOMS });

  /** Records `value` and returns the observation, failing if it was skipped. */
  const record = async (
    metric: ObservationMetric,
    date: string,
    value: Parameters<typeof recordObservation>[3],
    options?: Parameters<typeof recordObservation>[4],
  ) => (await recordObservation(db, metric.id, date, value, options)).observation;

  const rows = (sql: string, params: unknown[] = []) => db.query(sql, params);

  describe("metric", () => {
    it("creates, trimming text and canonicalising the shape", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const metric = await createMetric(db, {
        name: " Mood ",
        description: " ",
        valueType: "enum",
        constraints: { options: [...MOOD.options].reverse() },
        optionLabels: { low: " Low " },
      });
      expect(metric).toEqual({
        id: expect.any(String),
        name: "Mood",
        description: null,
        valueType: "enum",
        constraints: MOOD,
        optionLabels: { low: "Low" },
        createdAt: 1_000,
        updatedAt: 1_000,
        archivedAt: null,
      });
      expect(await getMetric(db, metric.id)).toEqual(metric);
    });

    it.each([
      ["a blank name", { name: " ", valueType: "boolean" }, /name is required/],
      ["a field-only type", { name: "x", valueType: "text" }, /value type must be one of/],
      ["an enum without options", { name: "x", valueType: "enum" }, /options must be/],
      ["unknown constraints", { name: "x", valueType: "number", constraints: { step: 1 } }, /step/],
      ["a blank label", { name: "x", valueType: "boolean", optionLabels: { a: "" } }, /label/],
    ])("refuses %s, naming the metric and writing nothing", async (_, input, message) => {
      await expect(createMetric(db, input as never)).rejects.toThrow(
        new RegExp(`^Observation metric [0-9a-f-]{36}: .*${message.source}`),
      );
      expect(await rows("SELECT * FROM observation_metrics")).toEqual([]);
    });

    it("lists metrics by name, archived included", async () => {
      const b = await createMetric(db, { name: "b", valueType: "boolean" });
      const a = await createMetric(db, { name: "A", valueType: "boolean" });
      await setMetricArchived(db, b.id, true);
      expect((await listMetrics(db)).map((m) => m.name)).toEqual(["A", "b"]);
      await deleteMetric(db, a.id);
      expect((await listMetrics(db)).map((m) => m.name)).toEqual(["b"]);
    });

    it("renames and relabels", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const { id } = await createMetric(db, {
        name: "Mood",
        description: "daily",
        valueType: "enum",
        constraints: MOOD,
      });
      vi.setSystemTime(2_000);
      const updated = await updateMetric(db, id, { name: "Feeling", optionLabels: { ok: "Fine" } });
      expect(updated).toMatchObject({
        name: "Feeling",
        description: "daily",
        optionLabels: { ok: "Fine" },
        updatedAt: 2_000,
      });
      await expect(updateMetric(db, id, { optionLabels: { ok: " " } })).rejects.toThrow(
        `Observation metric ${id}: label for option "ok" must be a non-empty string`,
      );
    });

    it("archives and unarchives", async () => {
      const { id } = await water();
      await setMetricArchived(db, id, true);
      expect((await getMetric(db, id))?.archivedAt).toEqual(expect.any(Number));
      await setMetricArchived(db, id, false);
      expect((await getMetric(db, id))?.archivedAt).toBeNull();
    });

    it("refuses changes to a deleted metric", async () => {
      const { id } = await water();
      await deleteMetric(db, id);
      await expect(updateMetric(db, id, { name: "x" })).rejects.toThrow(/not found/);
      await expect(setMetricArchived(db, id, true)).rejects.toThrow(/not found/);
      await expect(deleteMetric(db, id)).rejects.toThrow(/not found/);
    });
  });

  describe("constraints", () => {
    it("change in place, checked on the next value but not on stored ones", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const metric = await water();
      const old = await record(metric, "2026-10-19", 2.5);
      vi.setSystemTime(2_000);
      const updated = await updateMetric(db, metric.id, { constraints: { min: 5, max: 20 } });
      expect(updated).toMatchObject({
        valueType: "number",
        constraints: { min: 5, max: 20 },
        updatedAt: 2_000,
      });
      expect(await getObservation(db, old.id)).toEqual(old);
      await expect(record(metric, "2026-10-20", 3)).rejects.toThrow(/must be at least 5/);
      await expect(record(metric, "2026-10-19", 3)).rejects.toThrow(
        `Observation ${old.id}: must be at least 5`,
      );
      expect((await record(metric, "2026-10-19", 6)).id).toBe(old.id);
    });

    it("are parsed for the metric's value type, which never changes", async () => {
      const metric = await water();
      await expect(
        updateMetric(db, metric.id, { constraints: { min: 2, max: 1 } }),
      ).rejects.toThrow(`Observation metric ${metric.id}: min must not be greater than max`);
      await expect(updateMetric(db, metric.id, { constraints: MOOD })).rejects.toThrow(/options/);
      expect(await getMetric(db, metric.id)).toEqual(metric);
    });

    it("keep a removed option's stored keys, sorted last", async () => {
      const metric = await symptoms();
      const created = await record(metric, "2026-10-19", ["cough", "headache"]);
      await updateMetric(db, metric.id, {
        constraints: { ...SYMPTOMS, options: SYMPTOMS.options.filter((o) => o.key !== "headache") },
      });
      expect((await getObservation(db, created.id))?.value).toEqual(["cough", "headache"]);
    });
  });

  describe("observation", () => {
    it("records a manual value", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const metric = await water();
      const result = await recordObservation(db, metric.id, "2026-10-19", 3);
      expect(result).toEqual({
        skipped: false,
        observation: {
          id: expect.any(String),
          metricId: metric.id,
          date: "2026-10-19",
          valueType: "number",
          value: 3,
          source: "manual",
          externalId: null,
          writtenBy: "manual",
          writtenAt: 1_000,
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      });
      expect(await getObservation(db, result.observation.id)).toEqual(result.observation);
    });

    it.each([
      ["boolean", undefined, false],
      ["boolean", undefined, true],
      ["number", { precision: 2 }, -1.25],
      ["enum", MOOD, "high"],
    ] as const)("records a %s value (%s)", async (valueType, constraints, value) => {
      const metric = await createMetric(db, { name: "m", valueType, constraints });
      expect((await record(metric, "2026-10-19", value)).value).toEqual(value);
    });

    it("records multi_enum selections in option order, and none as recorded", async () => {
      const metric = await symptoms();
      const some = await record(metric, "2026-10-19", ["fever", "headache"]);
      const none = await record(metric, "2026-10-20", []);
      expect(some.value).toEqual(["headache", "fever"]);
      expect(none.value).toEqual([]);
      expect((await listObservations(db, metric.id)).map((o) => o.value)).toEqual([
        [],
        ["headache", "fever"],
      ]);
      expect(await rows("SELECT option_key FROM observation_selections ORDER BY 1")).toEqual([
        { option_key: "fever" },
        { option_key: "headache" },
      ]);
    });

    it("replaces the selections when revised", async () => {
      const metric = await symptoms();
      const first = await record(metric, "2026-10-19", ["fever", "headache"]);
      expect(await record(metric, "2026-10-19", ["cough"])).toMatchObject({
        id: first.id,
        value: ["cough"],
      });
      expect((await record(metric, "2026-10-19", [])).value).toEqual([]);
      expect(await rows("SELECT * FROM observation_selections")).toEqual([]);
    });

    it("revises the day's one live observation", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(1_000);
      const metric = await water();
      const first = await record(metric, "2026-10-19", 3);
      vi.setSystemTime(2_000);
      const revised = await record(metric, "2026-10-19", 4);
      expect(revised).toEqual({ ...first, value: 4, writtenAt: 2_000, updatedAt: 2_000 });
      expect(await listObservations(db, metric.id)).toEqual([revised]);
    });

    it.each([
      ["a value out of bounds", "number", 21, /must be at most 20/],
      ["a value of the wrong type", "number", "3", /must be a number/],
      ["an unknown option", "multi_enum", ["rash"], /"rash" is not an option/],
      [
        "too many selections",
        "multi_enum",
        ["fever", "cough", "headache"],
        /must select at most 2/,
      ],
      ["a repeated selection", "multi_enum", ["fever", "fever"], /must not repeat/],
    ] as const)("refuses %s, naming the observation", async (_, type, value, message) => {
      const metric = type === "number" ? await water() : await symptoms();
      await expect(record(metric, "2026-10-19", value as never)).rejects.toThrow(
        new RegExp(`^Observation [0-9a-f-]{36}: ${message.source}`),
      );
      expect(await rows("SELECT * FROM observations")).toEqual([]);
    });

    it("names the existing observation when a revision is invalid, changing nothing", async () => {
      const metric = await water();
      const first = await record(metric, "2026-10-19", 3);
      await expect(record(metric, "2026-10-19", -1)).rejects.toThrow(
        `Observation ${first.id}: must be at least 0`,
      );
      expect(await getObservation(db, first.id)).toEqual(first);
    });

    it.each([
      ["an invalid date", "2026-02-30", {}, /invalid date "2026-02-30"/],
      ["a blank writer", "2026-10-19", { writtenBy: " " }, /invalid writer/],
      ["a padded source", "2026-10-19", { source: " import" }, /invalid source/],
      ["a blank external id", "2026-10-19", { externalId: "" }, /invalid external id/],
    ])("refuses %s", async (_, date, options, message) => {
      const metric = await water();
      await expect(record(metric, date, 1, options)).rejects.toThrow(
        new RegExp(`^Observation metric ${metric.id}: ${message.source}`),
      );
    });

    it("refuses an archived or deleted metric", async () => {
      const archived = await water();
      await setMetricArchived(db, archived.id, true);
      await expect(record(archived, "2026-10-19", 1)).rejects.toThrow(
        `Observation metric ${archived.id}: archived`,
      );
      const deleted = await water();
      await deleteMetric(db, deleted.id);
      await expect(record(deleted, "2026-10-19", 1)).rejects.toThrow(/not found/);
      await expect(recordObservation(db, "nope", "2026-10-19", 1)).rejects.toThrow(/not found/);
    });

    it("lists latest day first, between inclusive bounds", async () => {
      const metric = await water();
      for (const [date, cups] of [
        ["2026-10-19", 1],
        ["2026-10-21", 3],
        ["2026-10-20", 2],
      ] as const) {
        await record(metric, date, cups);
      }
      await record(await water(), "2026-10-20", 9);
      const values = async (options = {}) =>
        (await listObservations(db, metric.id, options)).map((o) => o.value);
      expect(await values()).toEqual([3, 2, 1]);
      expect(await values({ from: "2026-10-20" })).toEqual([3, 2]);
      expect(await values({ from: "2026-10-20", to: "2026-10-20" })).toEqual([2]);
      expect(await values({ to: "2026-10-19" })).toEqual([1]);
      await expect(listObservations(db, metric.id, { from: "20/10/2026" })).rejects.toThrow(
        /invalid from date/,
      );
    });

    it("has no default: an unrecorded day has no observation", async () => {
      const metric = await createMetric(db, { name: "Teeth", valueType: "boolean" });
      await record(metric, "2026-10-19", false);
      expect(await listObservations(db, metric.id, { from: "2026-10-20" })).toEqual([]);
    });
  });

  describe("provenance", () => {
    const healthkit = { writtenBy: "healthkit" };

    it("records an automated value with the writer as its source", async () => {
      const metric = await water();
      const result = await recordObservation(db, metric.id, "2026-10-19", 3, {
        ...healthkit,
        externalId: "hk-1",
      });
      expect(result).toMatchObject({
        skipped: false,
        observation: { source: "healthkit", externalId: "hk-1", writtenBy: "healthkit" },
      });
      const imported = await record(metric, "2026-10-20", 1, { writtenBy: "import", source: "x" });
      expect(imported).toMatchObject({ source: "x", writtenBy: "import" });
    });

    it("lets an automated writer overwrite its own value", async () => {
      const metric = await water();
      await record(metric, "2026-10-19", 3, healthkit);
      expect(await recordObservation(db, metric.id, "2026-10-19", 4, healthkit)).toMatchObject({
        skipped: false,
        observation: { value: 4, writtenBy: "healthkit" },
      });
    });

    it.each([
      ["the user", undefined],
      ["another automated writer", { writtenBy: "plugin:fit" }],
    ])("skips a value written by %s, changing nothing", async (_, first) => {
      const metric = await water();
      const kept = await record(metric, "2026-10-19", 3, first);
      expect(await recordObservation(db, metric.id, "2026-10-19", 4, healthkit)).toEqual({
        skipped: true,
        observation: kept,
      });
      expect(await getObservation(db, kept.id)).toEqual(kept);
    });

    it("still refuses an invalid value it would skip", async () => {
      const metric = await water();
      await record(metric, "2026-10-19", 3);
      await expect(record(metric, "2026-10-19", -4, healthkit)).rejects.toThrow(/at least 0/);
    });

    it("lets the user overwrite any value, keeping source and external id", async () => {
      const metric = await water();
      const automated = await record(metric, "2026-10-19", 3, { ...healthkit, externalId: "a" });
      const manual = await record(metric, "2026-10-19", 4);
      expect(manual).toMatchObject({
        id: automated.id,
        value: 4,
        writtenBy: "manual",
        source: "healthkit",
        externalId: "a",
      });
      // Even its own source cannot reclaim it, and a revision never changes the external id.
      expect(await recordObservation(db, metric.id, "2026-10-19", 5, healthkit)).toMatchObject({
        skipped: true,
      });
      await record(metric, "2026-10-19", 6, { externalId: "b" });
      expect((await getObservation(db, automated.id))?.externalId).toBe("a");
    });

    it("keeps external ids unique per source", async () => {
      const metric = await water();
      const first = await record(metric, "2026-10-19", 3, { ...healthkit, externalId: "a" });
      await expect(
        record(metric, "2026-10-20", 3, { ...healthkit, externalId: "a" }),
      ).rejects.toThrow(`Observation ${first.id}: already has external id "a" from healthkit`);
      await record(metric, "2026-10-20", 3, { writtenBy: "import", externalId: "a" });
    });
  });

  describe("delete", () => {
    it("deletes an observation with its selections", async () => {
      const metric = await symptoms();
      const created = await record(metric, "2026-10-19", ["cough"]);
      await deleteObservation(db, created.id);

      expect(await listObservations(db, metric.id)).toEqual([]);
      expect(await rows("SELECT * FROM observation_selections")).toEqual([]);
      await expect(deleteObservation(db, created.id)).rejects.toThrow(
        `Observation ${created.id}: not found`,
      );
    });

    it("frees the day for a new observation", async () => {
      const metric = await water();
      const old = await record(metric, "2026-10-19", 3);
      await deleteObservation(db, old.id);
      const fresh = await record(metric, "2026-10-19", 4);
      expect(fresh.id).not.toBe(old.id);
    });

    it("previews, then deletes a metric with its observations", async () => {
      const metric = await water();
      await record(metric, "2026-10-19", 1);
      await record(metric, "2026-10-20", 2);
      const other = await water();
      await record(other, "2026-10-19", 1);

      expect(await previewMetricDeletion(db, metric.id)).toEqual({ observations: 2 });
      await deleteMetric(db, metric.id);
      expect(await listMetrics(db)).toEqual([other]);
      expect(await rows("SELECT metric_id FROM observations")).toEqual([{ metric_id: other.id }]);
    });
  });

  describe("schema", () => {
    const insert = (columns: Record<string, unknown>) => {
      const row = {
        id: "x",
        date: "2026-10-19",
        source: "manual",
        written_by: "manual",
        written_at: 0,
        created_at: 0,
        updated_at: 0,
        ...columns,
      };
      const names = Object.keys(row);
      return db.execute(
        `INSERT INTO observations (${names.join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
        Object.values(row),
      );
    };

    it("allows one observation per metric and day", async () => {
      const metric = await water();
      await record(metric, "2026-10-19", 1);
      await expect(insert({ metric_id: metric.id, value_num: 2 })).rejects.toThrow(/UNIQUE/);
    });

    it("references an existing metric", async () => {
      await expect(insert({ metric_id: "nope" })).rejects.toThrow(/FOREIGN KEY/);
    });

    it.each([
      ["two values", { value_num: 1, value_enum: "a" }, /CHECK/],
      ["no date", { date: null }, /NOT NULL/],
      ["no writer", { written_by: null }, /NOT NULL/],
      ["a non-boolean value_bool", { value_bool: 2 }, /CHECK/],
    ])("refuses %s", async (_, columns, error) => {
      const metric = await water();
      await expect(insert({ metric_id: metric.id, ...columns })).rejects.toThrow(error);
    });
  });

  describe("day observations", () => {
    it("pairs every active metric with its value on the day", async () => {
      const w = await water();
      const s = await symptoms();
      const archived = await createMetric(db, { name: "Old", valueType: "boolean" });
      await record(archived, "2026-10-19", true);
      await setMetricArchived(db, archived.id, true);
      const rec = await record(w, "2026-10-19", 3);
      await record(w, "2026-10-18", 5);
      const sym = await record(s, "2026-10-19", ["headache", "fever"]);
      const day = await listDayObservations(db, "2026-10-19");
      const order = (await listMetrics(db)).filter((m) => m.archivedAt === null).map((m) => m.id);
      expect(day.map((d) => d.metric.id)).toEqual(order);
      expect(day.find((d) => d.metric.id === w.id)?.observation).toEqual(rec);
      expect(day.find((d) => d.metric.id === s.id)?.observation?.value).toEqual(sym.value);
    });

    it("gives null for an unrecorded metric", async () => {
      const w = await water();
      expect(await listDayObservations(db, "2026-10-19")).toEqual([
        { metric: w, observation: null },
      ]);
      await expect(listDayObservations(db, "2026-13-01")).rejects.toThrow(/date/);
    });
  });

  describe("day observation counts", () => {
    it("counts each day's recorded active metrics, out of all active metrics", async () => {
      const w = await water();
      const s = await symptoms();
      const archived = await createMetric(db, { name: "Old", valueType: "boolean" });
      await record(archived, "2026-10-18", true);
      await setMetricArchived(db, archived.id, true);
      await record(w, "2026-10-18", 3);
      await record(s, "2026-10-18", []);
      await record(w, "2026-10-20", 1);
      // Outside the range.
      await record(w, "2026-10-17", 1);
      await record(s, "2026-10-21", ["cough"]);
      expect(await countDayObservations(db, "2026-10-18", "2026-10-20")).toEqual([
        { date: "2026-10-18", recorded: 2, total: 2 },
        { date: "2026-10-19", recorded: 0, total: 2 },
        { date: "2026-10-20", recorded: 1, total: 2 },
      ]);
    });

    it("agrees with listDayObservations for each day", async () => {
      const w = await water();
      const s = await symptoms();
      await record(w, "2026-10-19", 3);
      await record(s, "2026-10-20", ["fever"]);
      for (const { date, recorded, total } of await countDayObservations(
        db,
        "2026-10-18",
        "2026-10-21",
      )) {
        const day = await listDayObservations(db, date);
        expect(recorded).toBe(day.filter((d) => d.observation !== null).length);
        expect(total).toBe(day.length);
      }
    });

    it("gives zero totals with no metrics, and one entry for a one-day range", async () => {
      expect(await countDayObservations(db, "2026-10-19", "2026-10-19")).toEqual([
        { date: "2026-10-19", recorded: 0, total: 0 },
      ]);
    });

    it("rejects invalid dates and reversed ranges", async () => {
      await expect(countDayObservations(db, "2026-13-01", "2026-10-19")).rejects.toThrow(/date/);
      await expect(countDayObservations(db, "2026-10-19", "nope")).rejects.toThrow(/date/);
      await expect(countDayObservations(db, "2026-10-20", "2026-10-19")).rejects.toThrow(
        /before it starts/,
      );
    });
  });
});
