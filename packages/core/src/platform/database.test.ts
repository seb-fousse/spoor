import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createInMemoryDatabase } from "../testing/in-memory-database";
import type { Database } from "./index";

describe("Database seam (in-memory adapter)", () => {
  let db: Database & { close(): void };

  beforeEach(async () => {
    db = createInMemoryDatabase();
    await db.execute("CREATE TABLE note (id TEXT PRIMARY KEY, body TEXT NOT NULL)");
  });

  afterEach(() => {
    db.close();
  });

  it("round-trips a written row through the interface", async () => {
    await db.execute("INSERT INTO note (id, body) VALUES (?, ?)", ["n1", "hello"]);

    const rows = await db.query<{ id: string; body: string }>(
      "SELECT id, body FROM note WHERE id = ?",
      ["n1"],
    );

    expect(rows).toEqual([{ id: "n1", body: "hello" }]);
  });

  it("returns an empty array when nothing matches", async () => {
    const rows = await db.query("SELECT * FROM note WHERE id = ?", ["missing"]);
    expect(rows).toEqual([]);
  });
});
