import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../db/platform";
import { migrate } from "../db/schema/migrate";
import type { SpoorErrorCode, SpoorErrorDetails } from "../lib/spoor-error";
import { expectSpoorError } from "../testing/expect-spoor-error";
import { createInMemoryDatabase } from "../testing/in-memory-database";
import { dumpAll, populate } from "../testing/sample-data";
import { exportData } from "./export";
import { importData, importJson } from "./import";

type Doc = Record<string, unknown>;

const rows = (doc: Doc, key: string) => doc[key] as Array<Record<string, unknown>>;

describe("importData", () => {
  let source: Database & { close(): void };
  let db: Database & { close(): void };
  let doc: Doc;

  beforeEach(async () => {
    source = createInMemoryDatabase();
    db = createInMemoryDatabase();
    await migrate(source);
    await migrate(db);
    await populate(source);
    doc = JSON.parse(JSON.stringify(await exportData(source)));
  });

  afterEach(() => {
    source.close();
    db.close();
  });

  const empty = async () => {
    const dump = await dumpAll(db);
    return Object.values(dump).every((rows) => rows.length === 0);
  };

  /** Asserts `doc` is refused as `invalid` (or `code`) with `details`, and that nothing was written. */
  const refused = async (details: SpoorErrorDetails, code: SpoorErrorCode = "invalid") => {
    const error = await expectSpoorError(importData(db, doc), code, details);
    expect(await empty()).toBe(true);
    return error;
  };

  it("refuses a database that already has data, leaving it untouched", async () => {
    await importData(db, doc);
    const before = await dumpAll(db);
    await expectSpoorError(importData(db, doc), "conflict");
    expect(await dumpAll(db)).toEqual(before);
  });

  it("overwrites settings written before the import", async () => {
    await db.execute(
      "INSERT INTO settings (key, value, updated_at) VALUES ('time_zone', '\"UTC\"', 1)",
    );
    await importData(db, doc);
    expect((await dumpAll(db)).settings).toEqual((await dumpAll(source)).settings);
  });

  it("treats a missing table as empty, so an older export still imports", async () => {
    delete doc.timelineIntervals;
    await importData(db, doc);
    expect((await dumpAll(db)).timeline_intervals).toEqual([]);
  });

  it("inserts a self-referencing row after the row it references", async () => {
    // A child entry references its parent: list it first and the parent last.
    const entries = rows(doc, "logEntries");
    const child = entries.find((e) => e.parentEntryId !== null);
    const parent = entries.find((e) => e.id === child?.parentEntryId);
    expect(parent).toBeDefined();
    doc.logEntries = [child, ...entries.filter((e) => e !== child && e !== parent), parent];
    await importData(db, doc);
    expect(await dumpAll(db)).toEqual(await dumpAll(source));
  });

  it("imports fields that refer to their own type, or to a type later in the file", async () => {
    // Person's Parent refers to Person, Movie's Director to Person: list Person last.
    const fields = rows(doc, "thingFields");
    const own = (f: Record<string, unknown>) =>
      (f.constraints as { thingTypeId?: string }).thingTypeId === f.thingTypeId;
    expect(fields.some((f) => f.valueType === "ref" && own(f))).toBe(true);
    doc.thingTypes = [...rows(doc, "thingTypes")].reverse();
    doc.thingFields = [...fields].reverse();
    doc.things = [...rows(doc, "things")].reverse();
    await importData(db, doc);
    expect(await dumpAll(db)).toEqual(await dumpAll(source));
  });

  it("refuses a newer format version", async () => {
    doc.schemaVersion = 2;
    await refused({ version: 2, supported: 1 }, "newer_version");
  });

  it("refuses text that is not JSON", async () => {
    const error = await expectSpoorError(importJson(db, "{nope"), "invalid");
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it.each([
    ["not an object", [] as never, {}],
    ["a bad schemaVersion", { schemaVersion: "1" } as never, { path: "schemaVersion" }],
  ])("refuses a document that is %s", async (_, bad, details) => {
    await expectSpoorError(importData(db, bad), "invalid", details);
  });

  it("refuses an unknown top-level field", async () => {
    doc.surprise = [];
    await refused({ path: "surprise" });
  });

  it("refuses a table that is not an array", async () => {
    doc.timelines = {} as never;
    await refused({ path: "timelines" });
  });

  it("names the record and field of invalid data", async () => {
    const interval = rows(doc, "timelineIntervals")[1];
    if (interval) interval.startAt = "2026-10-20 08:00";
    await refused({ path: "timelineIntervals[1].startAt" });
  });

  it.each([
    ["a wrong type", "name", 5],
    ["a null in a required field", "name", null],
    ["a non-UUID id", "id", "not-a-uuid"],
    ["a non-boolean flag", "exclusive", 1],
    ["an unknown field", "colour", "red"],
    ["a blank name", "name", "   "],
    ["an untrimmed name", "name", " Work"],
    ["an empty description", "description", ""],
  ])("refuses %s, naming where it is", async (_, field, value) => {
    const timeline = rows(doc, "timelines")[0];
    if (timeline) timeline[field] = value;
    await refused({ path: `timelines[0].${field}` });
  });

  it("refuses a non-number in a real column", async () => {
    const i = rows(doc, "observations").findIndex((o) => o.valueNum !== null);
    rows(doc, "observations")[i].valueNum = "7.5";
    await refused({ path: `observations[${i}].valueNum` });
  });

  it("refuses a missing field", async () => {
    const timeline = rows(doc, "timelines")[0];
    if (timeline) delete timeline.archivedAt;
    await refused({ path: "timelines[0].archivedAt" });
  });

  it("rolls everything back when the database rejects a record", async () => {
    // An interval whose category does not exist violates a foreign key.
    const interval = rows(doc, "timelineIntervals")[0];
    if (interval) interval.categoryId = "01900000-0000-7000-8000-0000000000ff";
    const error = await refused({ path: "timelineIntervals[0]" });
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("rolls back when a constraint is violated", async () => {
    // Ending when it starts breaks the CHECK on the interval.
    const interval = rows(doc, "timelineIntervals")[0];
    if (interval) interval.endAt = interval.startAt;
    await refused({ path: "timelineIntervals[0]" });
  });

  it("refuses an interval in a time zone the platform does not know", async () => {
    const work = intervalStartingAt("2026-10-20T08:00:00.000Z");
    work.timeZone = "Mars/Olympus";
    await refused({
      path: `timelineIntervals[${rows(doc, "timelineIntervals").indexOf(work)}].timeZone`,
    });
  });

  describe("the overlap rule", () => {
    // On "Activities" (exclusive): Sleep 00:00-08:00, Work 08:00-12:00, and an
    // ongoing Work from 15:00, all on 2026-10-20 UTC.
    const activities = () => {
      const timeline = rows(doc, "timelines").find((t) => t.name === "Activities");
      if (!timeline) throw new Error("fixture has no Activities timeline");
      return timeline;
    };
    const OVERLAP = { path: "timelineIntervals" };

    it("refuses intervals that overlap on an exclusive timeline", async () => {
      intervalStartingAt("2026-10-20T00:00:00.000Z").endAt = "2026-10-20T09:00:00.000Z";
      await refused(OVERLAP);
    });

    it("refuses intervals of one category that overlap on a non-exclusive timeline", async () => {
      activities().exclusive = false;
      intervalStartingAt("2026-10-20T08:00:00.000Z").endAt = "2026-10-20T16:00:00.000Z";
      await refused(OVERLAP);
    });

    it("accepts intervals of different categories that overlap on a non-exclusive timeline", async () => {
      activities().exclusive = false;
      intervalStartingAt("2026-10-20T00:00:00.000Z").endAt = "2026-10-20T09:00:00.000Z";
      await expect(importData(db, doc)).resolves.toBeUndefined();
    });
  });

  describe("definitions and values", () => {
    const BOGUS_THING = "01900000-0000-7000-8000-0000000000fe";

    /** The row of `key` whose `field` is `value`, and its index. */
    const find = (key: string, field: string, value: unknown) => {
      const index = rows(doc, key).findIndex((r) => r[field] === value);
      if (index === -1) throw new Error(`fixture has no ${key} with ${field} ${value}`);
      return { index, row: rows(doc, key)[index] };
    };
    const metric = (name: string) => find("observationMetrics", "name", name);
    const observation = (metricName: string, date: string) => {
      const metricId = metric(metricName).row.id;
      const index = rows(doc, "observations").findIndex(
        (o) => o.metricId === metricId && o.date === date,
      );
      return { index, row: rows(doc, "observations")[index], metricId };
    };
    /** The first value of the field named `name` in `fieldsKey`, from `valuesKey`. */
    const fieldValue = (fieldsKey: string, valuesKey: string, name: string) => {
      const field = find(fieldsKey, "name", name).row;
      return { ...find(valuesKey, "fieldId", field.id), fieldId: field.id as string };
    };
    const thingValue = (name: string) => fieldValue("thingFields", "thingFieldValues", name);
    const logValue = (name: string) => fieldValue("logFields", "logFieldValues", name);

    describe("refuses definitions core would not read", () => {
      it("constraints that are invalid", async () => {
        const { index, row } = metric("Water");
        row.constraints = { min: 5, max: 1 };
        await refused({
          path: `observationMetrics[${index}].constraints`,
          entity: "observation_metric",
          id: row.id as string,
          field: "constraints",
          constraint: "min",
        });
      });

      it("constraints of another value type", async () => {
        const { index, row } = find("thingFields", "name", "Year");
        row.constraints = { maxLength: 4 };
        await refused({
          path: `thingFields[${index}].constraints`,
          entity: "thing_field",
          id: row.id as string,
          field: "constraints",
          constraint: "maxLength",
        });
      });

      it("option labels that are not text", async () => {
        const { index, row } = find("logFields", "name", "Format");
        row.optionLabels = { cinema: 1 };
        await refused({
          path: `logFields[${index}].optionLabels`,
          entity: "log_field",
          id: row.id as string,
          field: "optionLabels",
        });
      });
    });

    describe("refuses a value of the wrong type", () => {
      it("in another value column", async () => {
        const { index, row, fieldId } = thingValue("Year");
        row.valueNum = null;
        row.valueText = "1979";
        await refused({
          path: `thingFieldValues[${index}].valueText`,
          entity: "thing",
          id: row.thingId as string,
          field: "values",
          fieldId,
          rule: "type",
        });
      });

      it("that its column holds, but the type does not", async () => {
        const { index, row, fieldId } = logValue("Released");
        row.valueDate = "1979-5-25";
        await refused({
          path: `logFieldValues[${index}].valueDate`,
          entity: "log_entry",
          id: row.logEntryId as string,
          field: "values",
          fieldId,
          rule: "type",
        });
      });

      it("for an observation", async () => {
        const { index, row, metricId } = observation("Water", "2026-10-20");
        row.valueNum = null;
        row.valueBool = true;
        await refused({
          path: `observations[${index}].valueBool`,
          entity: "observation",
          id: row.id as string,
          field: "value",
          metricId: metricId as string,
          rule: "type",
        });
      });

      it("of a field of another type", async () => {
        const { index, row } = thingValue("Year");
        row.fieldId = find("thingFields", "name", "Friends").row.id;
        await refused({
          path: `thingFieldValues[${index}].fieldId`,
          entity: "thing",
          id: row.thingId as string,
          fieldId: row.fieldId as string,
        });
      });
    });

    it("refuses an enum value that no option could have as its key", async () => {
      const { index, row, metricId } = observation("Mood", "2026-10-20");
      row.valueEnum = " high";
      await refused({
        path: `observations[${index}].valueEnum`,
        entity: "observation",
        id: row.id as string,
        metricId: metricId as string,
        rule: "option",
      });
    });

    describe("refuses a bad multi_enum selection", () => {
      const selection = () => {
        const { row, metricId } = observation("Symptoms", "2026-10-20");
        const index = rows(doc, "observationSelections").findIndex(
          (s) => s.observationId === row.id,
        );
        return { index, row: rows(doc, "observationSelections")[index], metricId };
      };

      it("whose key no option could have", async () => {
        const { index, row, metricId } = selection();
        row.optionKey = "";
        await refused({
          path: `observationSelections[${index}].optionKey`,
          entity: "observation",
          id: row.observationId as string,
          metricId: metricId as string,
          rule: "option",
        });
      });

      it("of an observation whose metric is not multi_enum", async () => {
        const { index, row } = selection();
        const mood = observation("Mood", "2026-10-20");
        row.observationId = mood.row.id;
        await refused({
          path: `observationSelections[${index}]`,
          entity: "observation",
          id: mood.row.id as string,
          metricId: mood.metricId as string,
          rule: "type",
        });
      });

      it("next to a value column a multi_enum observation does not set", async () => {
        const { index, row, metricId } = observation("Symptoms", "2026-10-20");
        row.valueEnum = "fever";
        await refused({
          path: `observations[${index}].valueEnum`,
          entity: "observation",
          id: row.id as string,
          metricId: metricId as string,
          rule: "type",
        });
      });
    });

    describe("refuses a bad reference", () => {
      it("to a thing that does not exist, by the foreign key", async () => {
        const { index, row } = logValue("Movie");
        row.valueRef = BOGUS_THING;
        await refused({ path: `logFieldValues[${index}]` });
      });

      it("to a thing of another thing type", async () => {
        const { index, row, fieldId } = logValue("Movie");
        row.valueRef = find("thingFieldValues", "valueText", "Sam").row.thingId;
        await refused({
          path: `logFieldValues[${index}].valueRef`,
          entity: "log_entry",
          id: row.logEntryId as string,
          field: "values",
          fieldId,
          rule: "type",
        });
      });

      it("a second thing for a ref field", async () => {
        const { row, fieldId } = thingValue("Director");
        const values = rows(doc, "thingFieldValues");
        const sam = find("thingFieldValues", "valueText", "Sam").row.thingId;
        values.push({ ...row, id: "f0000000-0000-7000-8000-0000000000ff", valueRef: sam });
        await refused({
          path: `thingFieldValues[${values.length - 1}].valueRef`,
          entity: "thing",
          id: row.thingId as string,
          fieldId,
          rule: "type",
        });
      });
    });

    it("imports values that break constraints tightened since they were written", async () => {
      // The app checks constraints only on write: tightening one leaves stored values alone.
      metric("Water").row.constraints = { unit: "cups", min: 10, max: 11, precision: 0 };
      metric("Symptoms").row.constraints = {
        options: [{ key: "cough", order: 1 }],
        minSelected: 1,
        maxSelected: 1,
      };
      find("thingFields", "name", "Name").row.constraints = { maxLength: 2 };
      find("logFields", "name", "Rating").row.constraints = { min: 4.75, max: 5, precision: 0 };
      await importData(db, doc);
      const imported = await dumpAll(db);
      const written = await dumpAll(source);
      for (const table of [
        "observations",
        "observation_selections",
        "thing_field_values",
        "log_field_values",
      ]) {
        expect(imported[table], table).toEqual(written[table]);
      }
    });

    it("imports the key of an option removed since, as the app keeps it", async () => {
      const { row } = find("thingFields", "name", "Format");
      row.constraints = { options: [{ key: "tv", order: 2 }] };
      await importData(db, doc);
      expect((await dumpAll(db)).thing_field_values).toEqual(
        (await dumpAll(source)).thing_field_values,
      );
    });
  });

  function intervalStartingAt(startAt: string): Record<string, unknown> {
    const interval = rows(doc, "timelineIntervals").find((i) => i.startAt === startAt);
    if (!interval) throw new Error(`fixture has no interval starting at ${startAt}`);
    return interval;
  }
});
