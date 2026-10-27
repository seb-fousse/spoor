import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { systemTimeZone } from "./days";
import type { Database } from "./platform/index";
import { migrate } from "./schema/migrate";
import { getSetting, getTimeZone, setSetting, setTimeZone } from "./settings";
import { createInMemoryDatabase } from "./testing/in-memory-database";

describe("settings", () => {
  let db: Database & { close(): void };

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await migrate(db);
  });

  afterEach(() => {
    db.close();
    vi.useRealTimers();
  });

  const row = async (key: string) =>
    (
      await db.query<{ value: string; updated_at: number }>(
        "SELECT value, updated_at FROM settings WHERE key = ?",
        [key],
      )
    )[0];

  it("returns undefined for a key never set", async () => {
    expect(await getSetting(db, "missing")).toBeUndefined();
  });

  it.each([
    ["string", "Europe/Paris"],
    ["number", 42],
    ["boolean", false],
    ["null", null],
    ["array", ["a", "b"]],
    ["object", { plugin: "x", granted: ["read"] }],
  ])("round-trips a %s value", async (_, value) => {
    await setSetting(db, "k", value);
    expect(await getSetting(db, "k")).toEqual(value);
  });

  it("replaces the value and bumps updated_at", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    await setSetting(db, "k", 1);
    vi.setSystemTime(2_000);
    await setSetting(db, "k", 2);

    expect(await row("k")).toEqual({ value: "2", updated_at: 2_000 });
    expect(await db.query("SELECT key FROM settings")).toHaveLength(1);
  });

  it("rejects values that are not JSON", async () => {
    await expect(setSetting(db, "k", undefined)).rejects.toThrow('Setting "k"');
    await expect(setSetting(db, "k", () => {})).rejects.toThrow('Setting "k"');
  });

  it("refuses invalid JSON written directly", async () => {
    await expect(
      db.execute("INSERT INTO settings (key, value, updated_at) VALUES ('k', '{oops', 0)"),
    ).rejects.toThrow();
  });

  describe("time zone", () => {
    it("falls back to the device zone when unset", async () => {
      expect(await getTimeZone(db)).toBe(systemTimeZone());
    });

    it("returns the stored zone", async () => {
      await setTimeZone(db, "Pacific/Auckland");
      expect(await getTimeZone(db)).toBe("Pacific/Auckland");
    });

    it("rejects an invalid zone, naming the setting", async () => {
      await expect(setTimeZone(db, "Mars/Olympus")).rejects.toThrow('Setting "time_zone"');
      expect(await getSetting(db, "time_zone")).toBeUndefined();
    });

    it("falls back to the device zone when the stored one is unknown", async () => {
      await setSetting(db, "time_zone", "Mars/Olympus");
      expect(await getTimeZone(db)).toBe(systemTimeZone());
    });
  });
});
