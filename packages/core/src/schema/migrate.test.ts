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

  it("upgrades a version 1 database to the real migrations, keeping its data", async () => {
    await migrate(db, MIGRATIONS.slice(0, 1));
    await db.execute("INSERT INTO settings (key, value, updated_at) VALUES ('k', '1', 0)");

    expect(await migrate(db)).toEqual({ from: 1, to: MIGRATIONS.length });
    expect(await db.query("SELECT key, value FROM settings")).toEqual([{ key: "k", value: "1" }]);
    expect(await tables()).toEqual(
      expect.arrayContaining([
        "log_entries",
        "log_field_values",
        "log_field_versions",
        "log_fields",
        "log_type_versions",
        "log_types",
        "observation_metric_versions",
        "observation_metrics",
        "observation_selections",
        "observations",
        "thing_field_values",
        "thing_field_versions",
        "thing_fields",
        "thing_type_versions",
        "thing_types",
        "things",
        "timeline_categories",
        "timeline_intervals",
        "timelines",
      ]),
    );
  });

  // Migration 4 rebuilds the timeline tables to add the foreign keys to things.
  it("upgrades a version 2 database, keeping its timelines and adding their thing keys", async () => {
    await migrate(db, MIGRATIONS.slice(0, 2));
    const id = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`;
    const rows = [
      `INSERT INTO timelines (id, name, description, exclusive, created_at, updated_at, archived_at)
       VALUES ('${id(1)}', 'Activities', 'Day', 1, 1, 2, 3)`,
      `INSERT INTO timelines (id, name, exclusive, created_at, updated_at, deleted_at, deletion_id)
       VALUES ('${id(2)}', 'People', 0, 1, 2, 3, '${id(99)}')`,
      `INSERT INTO timeline_categories (id, timeline_id, name, description, created_at, updated_at)
       VALUES ('${id(10)}', '${id(1)}', 'Work', 'Job', 1, 2)`,
      `INSERT INTO timeline_categories (id, timeline_id, name, created_at, updated_at, archived_at)
       VALUES ('${id(11)}', '${id(1)}', 'Sleep', 1, 2, 3)`,
      `INSERT INTO timeline_categories (id, timeline_id, name, created_at, updated_at, deleted_at, deletion_id)
       VALUES ('${id(12)}', '${id(2)}', 'Alex', 1, 2, 3, '${id(99)}')`,
      `INSERT INTO timeline_intervals (id, timeline_id, category_id, start_at, end_at, time_zone, created_at, updated_at)
       VALUES ('${id(20)}', '${id(1)}', '${id(11)}', 0, 100, 'Europe/Paris', 1, 2)`,
      `INSERT INTO timeline_intervals (id, timeline_id, category_id, start_at, end_at, time_zone, created_at, updated_at)
       VALUES ('${id(21)}', '${id(1)}', '${id(10)}', 100, NULL, 'Asia/Tokyo', 1, 2)`,
      `INSERT INTO timeline_intervals (id, timeline_id, category_id, start_at, end_at, time_zone, created_at, updated_at, deleted_at, deletion_id)
       VALUES ('${id(22)}', '${id(2)}', '${id(12)}', 0, 50, 'UTC', 1, 2, 3, '${id(99)}')`,
      `INSERT INTO timeline_intervals (id, timeline_id, category_id, created_at, updated_at, deleted_at, deletion_id, purged_at)
       VALUES ('${id(23)}', '${id(1)}', '${id(10)}', 1, 2, 3, '${id(98)}', 4)`,
    ];
    for (const sql of rows) await db.execute(sql);

    const timelineTables = ["timelines", "timeline_categories", "timeline_intervals"];
    const dump = async () =>
      Promise.all(timelineTables.map((t) => db.query(`SELECT * FROM ${t} ORDER BY id`)));
    const indexes = () =>
      db.query(
        `SELECT name, tbl_name, sql FROM sqlite_master
         WHERE type = 'index' AND tbl_name LIKE 'timeline%' ORDER BY name`,
      );
    const before = { rows: await dump(), indexes: await indexes() };

    expect(await migrate(db)).toEqual({ from: 2, to: MIGRATIONS.length });

    expect(await dump()).toEqual(before.rows);
    // Every index is back under its own name with the same definition, including the
    // autoindex behind `UNIQUE (id, timeline_id)` that the intervals' composite key targets.
    expect(await indexes()).toEqual(before.indexes);
    expect(before.indexes).toContainEqual({
      name: "sqlite_autoindex_timeline_categories_2",
      tbl_name: "timeline_categories",
      sql: null,
    });
    expect(await db.query("PRAGMA foreign_key_check")).toEqual([]);
    expect(await db.query("SELECT name FROM sqlite_master WHERE name LIKE '%_new%'")).toEqual([]);

    const keys = async (table: string) =>
      (
        await db.query<{ table: string; from: string; to: string }>(
          `PRAGMA foreign_key_list(${table})`,
        )
      )
        .map((fk) => `${fk.from} -> ${fk.table}.${fk.to}`)
        .sort();
    expect(await keys("timelines")).toEqual(["default_thing_type_id -> thing_types.id"]);
    expect(await keys("timeline_categories")).toEqual([
      "thing_id -> things.id",
      "timeline_id -> timelines.id",
    ]);
    expect(await keys("timeline_intervals")).toEqual([
      "category_id -> timeline_categories.id",
      "timeline_id -> timeline_categories.timeline_id",
      "timeline_id -> timelines.id",
    ]);

    // The new keys and the old constraints are enforced.
    await expect(
      db.execute(`UPDATE timelines SET default_thing_type_id = '${id(50)}' WHERE id = '${id(1)}'`),
    ).rejects.toThrow(/FOREIGN KEY/);
    await expect(
      db.execute(`UPDATE timeline_categories SET thing_id = '${id(50)}' WHERE id = '${id(10)}'`),
    ).rejects.toThrow(/FOREIGN KEY/);
    await expect(
      db.execute(`UPDATE timeline_intervals SET timeline_id = '${id(2)}' WHERE id = '${id(20)}'`),
    ).rejects.toThrow(/FOREIGN KEY/);
    await expect(
      db.execute(
        `INSERT INTO timeline_intervals (id, timeline_id, category_id, start_at, time_zone, created_at, updated_at)
         VALUES ('${id(24)}', '${id(1)}', '${id(10)}', 200, 'UTC', 1, 2)`,
      ),
    ).rejects.toThrow(/UNIQUE/);
    await expect(db.execute(`DELETE FROM timelines WHERE id = '${id(1)}'`)).rejects.toThrow(
      /FOREIGN KEY/,
    );

    // And a real thing satisfies them.
    await db.execute(
      `INSERT INTO thing_types (id, name, title_field_id, schema_version, created_at, updated_at)
       VALUES ('${id(50)}', 'Person', '${id(51)}', 1, 1, 1)`,
    );
    await db.execute(
      `INSERT INTO thing_type_versions (id, thing_type_id, version, created_at)
       VALUES ('${id(52)}', '${id(50)}', 1, 1)`,
    );
    await db.execute(
      `INSERT INTO things (id, thing_type_id, thing_type_version, source, created_at, updated_at)
       VALUES ('${id(53)}', '${id(50)}', 1, 'manual', 1, 1)`,
    );
    await db.execute(
      `UPDATE timelines SET default_thing_type_id = '${id(50)}' WHERE id = '${id(1)}'`,
    );
    await db.execute(
      `UPDATE timeline_categories SET thing_id = '${id(53)}' WHERE id = '${id(10)}'`,
    );
    expect(await db.query("PRAGMA foreign_key_check")).toEqual([]);
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
