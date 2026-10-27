import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "./platform/index";
import { createInMemoryDatabase } from "./testing/in-memory-database";
import { transaction } from "./transaction";

describe("transaction", () => {
  let db: Database & { close(): void };

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await db.execute("CREATE TABLE t (n INTEGER NOT NULL) STRICT");
  });

  afterEach(() => {
    db.close();
  });

  const values = async () =>
    (await db.query<{ n: number }>("SELECT n FROM t ORDER BY rowid")).map((r) => r.n);

  it("commits and returns the result", async () => {
    const result = await transaction(db, async () => {
      await db.execute("INSERT INTO t VALUES (1)");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(await values()).toEqual([1]);
  });

  it("rolls back and rethrows when fn throws", async () => {
    const error = new Error("boom");
    await expect(
      transaction(db, async () => {
        await db.execute("INSERT INTO t VALUES (1)");
        throw error;
      }),
    ).rejects.toBe(error);
    expect(await values()).toEqual([]);
  });

  it("queues concurrent transactions instead of interleaving them", async () => {
    const write = (a: number, b: number) =>
      transaction(db, async () => {
        await db.execute("INSERT INTO t VALUES (?)", [a]);
        await Promise.resolve();
        await db.execute("INSERT INTO t VALUES (?)", [b]);
      });
    await Promise.all([write(1, 2), write(3, 4)]);
    expect(await values()).toEqual([1, 2, 3, 4]);
  });

  it("keeps running after a failed transaction", async () => {
    const failed = transaction(db, async () => {
      throw new Error("boom");
    });
    const next = transaction(db, () => db.execute("INSERT INTO t VALUES (1)"));
    await expect(failed).rejects.toThrow("boom");
    await next;
    expect(await values()).toEqual([1]);
  });
});
