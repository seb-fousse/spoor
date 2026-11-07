import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "../db/platform";
import { migrate } from "../db/schema/migrate";
import { createInMemoryDatabase } from "../testing/in-memory-database";
import { dumpAll, populate } from "../testing/sample-data";
import { exportData, exportJson } from "./export";
import { importData, importJson } from "./import";

// Export then import must reproduce the database exactly. Silent loss here is the
// worst bug a data tracker can have, so every slice extends `populate` to cover its tables.
describe("export/import round trip", () => {
  let source: Database & { close(): void };
  let target: Database & { close(): void };

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.UTC(2026, 9, 27, 20));
    source = createInMemoryDatabase();
    target = createInMemoryDatabase();
    await migrate(source);
    await migrate(target);
    await populate(source);
  });

  afterEach(() => {
    source.close();
    target.close();
    vi.useRealTimers();
  });

  it("populates a row of every table, so the test means something", async () => {
    for (const [table, rows] of Object.entries(await dumpAll(source))) {
      expect(rows.length, table).toBeGreaterThan(0);
    }
  });

  it("restores every table exactly", async () => {
    await importData(target, await exportData(source));
    expect(await dumpAll(target)).toEqual(await dumpAll(source));
  });

  it("restores exactly through JSON text", async () => {
    await importJson(target, await exportJson(source));
    expect(await dumpAll(target)).toEqual(await dumpAll(source));
  });

  it("exports the restored database identically", async () => {
    await importData(target, await exportData(source));
    vi.setSystemTime(Date.UTC(2026, 9, 28));
    const again = await exportData(target);
    expect(again).toEqual({ ...(await exportData(source)), exportedAt: again.exportedAt });
  });

  it("exports archived records", async () => {
    const doc = await exportData(source);
    expect((doc.timelineCategories ?? []).some((c) => c.archivedAt !== null)).toBe(true);
  });

  it("exports log entries with children and every precision", async () => {
    const entries = (await exportData(source)).logEntries ?? [];
    expect(entries.some((e) => e.parentEntryId !== null && e.occurredAt === null)).toBe(true);
    expect(new Set(entries.map((e) => e.precision))).toEqual(
      new Set(["instant", "day", "month", "year", null]),
    );
  });

  it("exports in the documented shape", async () => {
    const doc = await exportData(source);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.exportedAt).toBe("2026-10-27T20:00:00.000Z");
    expect(doc.settings?.find((s) => s.key === "time_zone")?.value).toBe("Europe/Paris");
    expect(doc.timelines?.[0]).toMatchObject({ exclusive: expect.any(Boolean) });
  });

  it("exports observations with typed values", async () => {
    const doc = await exportData(source);
    const observations = doc.observations ?? [];
    expect(observations.map((o) => o.valueNum).filter((n) => n !== null)).toContain(7.5);
    expect(observations.some((o) => o.valueBool === false)).toBe(true);
    expect(observations.some((o) => o.writtenBy === "healthkit")).toBe(true);
    expect(doc.observationMetrics?.find((m) => m.name === "Water")?.constraints).toEqual({
      unit: "cups",
      min: 0,
      precision: 1,
    });
    expect(doc.observationMetrics?.find((m) => m.name === "Mood")?.optionLabels).toEqual({
      low: "Low",
      high: "High",
    });
  });
});
