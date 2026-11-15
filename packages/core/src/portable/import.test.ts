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

  function intervalStartingAt(startAt: string): Record<string, unknown> {
    const interval = rows(doc, "timelineIntervals").find((i) => i.startAt === startAt);
    if (!interval) throw new Error(`fixture has no interval starting at ${startAt}`);
    return interval;
  }
});
