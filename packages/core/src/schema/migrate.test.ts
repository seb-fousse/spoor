import { readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../platform/index";
import { createInMemoryDatabase } from "../testing/in-memory-database";
import { migrate } from "./migrate";
import { MIGRATIONS, type Migration } from "./migrations";

const FIXTURES: readonly Migration[] = [
  { version: 1, name: "create a", statements: ["CREATE TABLE a (id TEXT PRIMARY KEY) STRICT"] },
  {
    version: 2,
    name: "create b",
    statements: [
      "CREATE TABLE b (id TEXT PRIMARY KEY, a_id TEXT NOT NULL REFERENCES a (id)) STRICT",
      "CREATE INDEX b_a_id ON b (a_id)",
    ],
  },
];

describe("migrate", () => {
  let db: Database & { close(): void };

  beforeEach(() => {
    db = createInMemoryDatabase();
  });

  afterEach(() => {
    db.close();
  });

  const userVersion = async () =>
    (await db.query<{ user_version: number }>("PRAGMA user_version"))[0].user_version;

  const tables = async () =>
    (
      await db.query<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
    ).map((r) => r.name);

  it("applies every migration to a fresh database", async () => {
    expect(await migrate(db, FIXTURES)).toEqual({ from: 0, to: 2 });
    expect(await userVersion()).toBe(2);
    expect(await tables()).toEqual(["a", "b"]);
  });

  it("is a no-op when already up to date", async () => {
    await migrate(db, FIXTURES);
    expect(await migrate(db, FIXTURES)).toEqual({ from: 2, to: 2 });
    expect(await userVersion()).toBe(2);
  });

  it("applies only the pending migrations", async () => {
    await migrate(db, FIXTURES.slice(0, 1));
    expect(await migrate(db, FIXTURES)).toEqual({ from: 1, to: 2 });
    expect(await tables()).toEqual(["a", "b"]);
  });

  it("rolls back a failing migration and keeps the earlier ones", async () => {
    const broken: Migration[] = [
      ...FIXTURES.slice(0, 1),
      {
        version: 2,
        name: "half broken",
        statements: ["CREATE TABLE c (id TEXT PRIMARY KEY) STRICT", "NOT VALID SQL"],
      },
    ];

    const error = await migrate(db, broken).catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/^Migration 2 \(half broken\) failed: /);
    expect((error as Error).cause).toBeInstanceOf(Error);

    expect(await userVersion()).toBe(1);
    expect(await tables()).toEqual(["a"]);
  });

  it("refuses a database written by a newer version, without touching it", async () => {
    await db.execute("PRAGMA user_version = 3");
    await expect(migrate(db, FIXTURES)).rejects.toThrow(/newer version of Spoor/);
    expect(await userVersion()).toBe(3);
    expect(await tables()).toEqual([]);
  });

  it.each([
    ["a gap", [FIXTURES[0], { ...FIXTURES[1], version: 3 }]],
    ["a duplicate", [FIXTURES[0], { ...FIXTURES[1], version: 1 }]],
    ["misordering", [FIXTURES[1], FIXTURES[0]]],
    ["not starting at 1", [{ ...FIXTURES[0], version: 0 }]],
  ])("rejects %s in versions", async (_, migrations) => {
    await expect(migrate(db, migrations)).rejects.toThrow(/1\.\.n in order/);
    expect(await userVersion()).toBe(0);
  });

  it("accepts an empty list", async () => {
    expect(await migrate(db, [])).toEqual({ from: 0, to: 0 });
  });

  it("applies the real migrations", async () => {
    expect(await migrate(db)).toEqual({ from: 0, to: MIGRATIONS.length });
  });
});

describe("MIGRATIONS", () => {
  // STRICT must be among the table options after the closing parenthesis; it
  // may be combined with others, e.g. `STRICT, WITHOUT ROWID`.
  const STRICT_TABLE = /\)[\w\s,]*\bSTRICT\b[\w\s,]*;?$/i;

  it("recognises STRICT table options", () => {
    expect("CREATE TABLE t (id TEXT) STRICT").toMatch(STRICT_TABLE);
    expect("CREATE TABLE t (id TEXT PRIMARY KEY) strict, WITHOUT ROWID;").toMatch(STRICT_TABLE);
    expect("CREATE TABLE t (id TEXT)").not.toMatch(STRICT_TABLE);
    expect("CREATE TABLE t (strict TEXT)").not.toMatch(STRICT_TABLE);
  });

  it("lists every file in migrations/, in order", () => {
    // A file nobody imported would never run; one listed out of order would
    // run under the wrong version.
    const files = readdirSync(new URL("./migrations", import.meta.url))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const expected = MIGRATIONS.map(
      ({ version, name }) => `${String(version).padStart(4, "0")}_${name}.sql`,
    );
    expect(files).toEqual(expected);
  });

  it("makes every table STRICT", () => {
    for (const { version, statements } of MIGRATIONS) {
      for (const sql of statements.filter((s) => /CREATE\s+TABLE/i.test(s))) {
        expect(sql.trim(), `migration ${version}`).toMatch(STRICT_TABLE);
      }
    }
  });
});
