import { sql } from "kysely";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { Database } from "./platform/index";
import { queryBuilder } from "./query";
import { migrate } from "./schema/migrate";
import { createInMemoryDatabase } from "./testing/in-memory-database";
import { transaction } from "./transaction";

describe("queryBuilder", () => {
  let inner: Database & { close(): void };
  // The seam, spied on so each test can see which method a query went through.
  let db: Database;
  let execute: Mock;
  let query: Mock;

  beforeEach(async () => {
    inner = createInMemoryDatabase();
    await migrate(inner);
    execute = vi.fn((sql: string, params?: unknown[]) => inner.execute(sql, params));
    query = vi.fn((sql: string, params?: unknown[]) => inner.query(sql, params));
    db = { execute, query: query as Database["query"] };
  });

  afterEach(() => {
    inner.close();
  });

  const settings = () => inner.query("SELECT key, value, updated_at FROM settings ORDER BY key");
  const insert = (key: string, updated_at = 1) =>
    queryBuilder(db).insertInto("settings").values({ key, value: '"v"', updated_at }).execute();

  it("returns the same builder for the same seam", () => {
    expect(queryBuilder(db)).toBe(queryBuilder(db));
    expect(queryBuilder(db)).not.toBe(queryBuilder(inner));
  });

  it("runs an insert through execute", async () => {
    await insert("a");
    expect(execute).toHaveBeenCalledWith(
      'insert into "settings" ("key", "value", "updated_at") values (?, ?, ?)',
      ["a", '"v"', 1],
    );
    expect(query).not.toHaveBeenCalled();
    expect(await settings()).toEqual([{ key: "a", value: '"v"', updated_at: 1 }]);
  });

  it("runs a select through query", async () => {
    await insert("a");
    await insert("b");
    const rows = await queryBuilder(db)
      .selectFrom("settings")
      .select(["key", "updated_at"])
      .where("key", "<>", "a")
      .execute();
    expect(rows).toEqual([{ key: "b", updated_at: 1 }]);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("runs an update through execute", async () => {
    await insert("a");
    execute.mockClear();
    await queryBuilder(db)
      .updateTable("settings")
      .set({ updated_at: 2 })
      .where("key", "=", "a")
      .execute();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
    expect(await settings()).toEqual([{ key: "a", value: '"v"', updated_at: 2 }]);
  });

  it("runs statements with RETURNING through query", async () => {
    const inserted = await queryBuilder(db)
      .insertInto("settings")
      .values({ key: "a", value: "1", updated_at: 1 })
      .returning(["key", "value"])
      .execute();
    const deleted = await queryBuilder(db)
      .deleteFrom("settings")
      .where("key", "=", "a")
      .returning("key")
      .executeTakeFirst();
    expect(inserted).toEqual([{ key: "a", value: "1" }]);
    expect(deleted).toEqual({ key: "a" });
    expect(query).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
  });

  it("routes raw statements by their leading keyword", async () => {
    await sql`INSERT INTO settings VALUES ('a', '1', 1)`.execute(queryBuilder(db));
    const { rows } = await sql<{ n: number }>`SELECT count(*) AS n FROM settings`.execute(
      queryBuilder(db),
    );
    expect(rows).toEqual([{ n: 1 }]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("binds booleans as 1 and 0", async () => {
    const { rows } = await sql<{
      t: number;
      f: number;
    }>`SELECT ${true} AS t, ${false} AS f`.execute(queryBuilder(db));
    expect(rows).toEqual([{ t: 1, f: 0 }]);
    expect(query).toHaveBeenCalledWith("SELECT ? AS t, ? AS f", [1, 0]);
  });

  it("refuses Kysely transactions, pointing to transaction()", async () => {
    await expect(
      queryBuilder(db)
        .transaction()
        .execute(() => insert("a")),
    ).rejects.toThrow("transaction()");
    await expect(queryBuilder(db).startTransaction().execute()).rejects.toThrow("transaction()");
    expect(await settings()).toEqual([]);
  });

  it("works inside core's transaction()", async () => {
    await expect(
      transaction(db, async () => {
        await insert("a");
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await transaction(db, () => insert("b"));
    expect(await settings()).toEqual([{ key: "b", value: '"v"', updated_at: 1 }]);
  });
});
