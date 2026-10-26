// @vitest-environment jsdom
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it } from "vitest";
import { createTauriDatabase } from "./database";

describe("Database seam (Tauri IPC adapter)", () => {
  afterEach(() => {
    clearMocks();
  });

  it("execute calls db_execute with sql and params", async () => {
    const calls: [string, unknown][] = [];
    mockIPC((cmd, args) => {
      calls.push([cmd, args]);
    });

    await createTauriDatabase().execute("INSERT INTO t VALUES (?)", [1]);

    expect(calls).toEqual([["db_execute", { sql: "INSERT INTO t VALUES (?)", params: [1] }]]);
  });

  it("query calls db_query and returns rows unchanged", async () => {
    const rows = [{ id: "a", n: 1 }];
    const calls: [string, unknown][] = [];
    mockIPC((cmd, args) => {
      calls.push([cmd, args]);
      return rows;
    });

    const result = await createTauriDatabase().query("SELECT * FROM t");

    expect(calls).toEqual([["db_query", { sql: "SELECT * FROM t", params: [] }]]);
    expect(result).toEqual(rows);
  });

  it("wraps a rejected string in an Error", async () => {
    mockIPC(() => {
      throw "no such table: t";
    });

    await expect(createTauriDatabase().query("SELECT * FROM t")).rejects.toThrow(
      new Error("no such table: t"),
    );
  });
});
