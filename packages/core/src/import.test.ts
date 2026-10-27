import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportData } from "./export";
import { importData, importJson } from "./import";
import type { Database } from "./platform/index";
import { migrate } from "./schema/migrate";
import { createInMemoryDatabase } from "./testing/in-memory-database";
import { dumpAll, populate } from "./testing/sample-data";

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

  /** Asserts `doc` is refused with `message` and that nothing was written. */
  const refused = async (message: string | RegExp) => {
    await expect(importData(db, doc)).rejects.toThrow(message);
    expect(await empty()).toBe(true);
  };

  it("refuses a database that already has data, leaving it untouched", async () => {
    await importData(db, doc);
    const before = await dumpAll(db);
    await expect(importData(db, doc)).rejects.toThrow(/empty database, but \w+ already has rows/);
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
    // A merged thing references its survivor: list it first and the survivor last.
    const things = rows(doc, "things");
    const duplicate = things.find((t) => t.mergedIntoId !== null);
    const survivor = things.find((t) => t.id === duplicate?.mergedIntoId);
    expect(survivor).toBeDefined();
    doc.things = [duplicate, ...things.filter((t) => t !== duplicate && t !== survivor), survivor];
    await importData(db, doc);
    expect(await dumpAll(db)).toEqual(await dumpAll(source));
  });

  it("refuses a newer format version", async () => {
    doc.schemaVersion = 2;
    await refused(/newer version of Spoor/);
  });

  it("refuses text that is not JSON", async () => {
    await expect(importJson(db, "{nope")).rejects.toThrow(/not valid JSON/);
  });

  it.each([
    ["not an object", [] as never, /must be a JSON object/],
    ["a bad schemaVersion", { schemaVersion: "1" } as never, /schemaVersion/],
  ])("refuses a document that is %s", async (_, bad, message) => {
    await expect(importData(db, bad)).rejects.toThrow(message);
  });

  it("refuses an unknown top-level field", async () => {
    doc.surprise = [];
    await refused(/unknown field "surprise"/);
  });

  it("refuses a table that is not an array", async () => {
    doc.timelines = {} as never;
    await refused(/timelines must be an array/);
  });

  it("names the record and field of invalid data", async () => {
    const interval = rows(doc, "timelineIntervals")[1];
    if (interval) interval.startAt = "2026-10-20 08:00";
    await refused(
      new RegExp(`timelineIntervals\\[1\\] \\(id ${interval?.id}\\): startAt must be an ISO 8601`),
    );
  });

  it.each([
    ["a wrong type", "name", 5, /timelines\[0\] .*: name must be a string/],
    ["a null in a required field", "name", null, /name must not be null/],
    ["a non-UUID id", "id", "not-a-uuid", /id must be a lowercase UUID/],
    ["a non-boolean flag", "exclusive", 1, /exclusive must be true or false/],
    ["an unknown field", "colour", "red", /unknown field "colour"/],
  ])("refuses %s", async (_, field, value, message) => {
    const timeline = rows(doc, "timelines")[0];
    if (timeline) timeline[field] = value;
    await refused(message);
  });

  it("refuses a missing field", async () => {
    const timeline = rows(doc, "timelines")[0];
    if (timeline) delete timeline.archivedAt;
    await refused(/archivedAt is missing/);
  });

  it("rolls everything back when the database rejects a record", async () => {
    // An interval whose category does not exist violates a foreign key.
    const interval = rows(doc, "timelineIntervals")[0];
    if (interval) interval.categoryId = "01900000-0000-7000-8000-0000000000ff";
    await refused(/timelineIntervals\[0\]/);
  });

  it("rolls back when a constraint is violated", async () => {
    // Trashed without a deletion id breaks the CHECK on the timeline.
    const timeline = rows(doc, "timelines")[0];
    if (timeline) timeline.deletedAt = "2026-10-20T08:00:00.000Z";
    await refused(/timelines\[0\]/);
  });
});
