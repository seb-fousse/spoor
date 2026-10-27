import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportData, exportJson } from "./export";
import type { Database } from "./platform/index";
import { TABLES } from "./portable";
import { migrate } from "./schema/migrate";
import { createInMemoryDatabase } from "./testing/in-memory-database";
import { populate } from "./testing/sample-data";

describe("exportData", () => {
  let db: Database & { close(): void };

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await migrate(db);
  });

  afterEach(() => {
    db.close();
  });

  it("exports every table as an empty array from an empty database", async () => {
    const doc = await exportData(db);
    expect(doc.schemaVersion).toBe(1);
    for (const { key } of TABLES) expect(doc[key], key).toEqual([]);
  });

  it("is deterministic apart from exportedAt", async () => {
    await populate(db);
    const a = await exportData(db);
    const b = await exportData(db);
    expect({ ...a, exportedAt: "" }).toEqual({ ...b, exportedAt: "" });
  });

  it("writes instants as ISO 8601 UTC and booleans as booleans", async () => {
    await populate(db);
    const [timeline] = (await exportData(db)).timelines ?? [];
    expect(timeline?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(typeof timeline?.exclusive).toBe("boolean");
  });

  it("writes JSON text that parses back to the document", async () => {
    await populate(db);
    const text = await exportJson(db);
    expect(JSON.parse(text).schemaVersion).toBe(1);
  });
});
