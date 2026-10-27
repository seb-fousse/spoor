import {
  type CompiledQuery,
  type DatabaseConnection,
  type Dialect,
  type Driver,
  Kysely,
  type QueryResult,
  type RootOperationNode,
  SqliteAdapter,
  SqliteIntrospector,
  SqliteQueryCompiler,
} from "kysely";
import type { Database } from "./platform/index";
import type { DB } from "./schema/tables";

/**
 * Typed SQL over the `Database` seam, with Kysely as a query builder only.
 *
 * Repositories build queries with `queryBuilder(db)` so table names, column
 * names and row shapes are checked against `DB` at compile time. Every
 * compiled query still runs through `db.execute` or `db.query`, so apps only
 * ever implement the seam and public functions keep taking a `Database`.
 *
 * Internal to core: not exported from the barrel.
 */

// One builder per seam, so repositories can call `queryBuilder(db)` freely.
const builders = new WeakMap<Database, Kysely<DB>>();

/** The Kysely builder for `db`. */
export function queryBuilder(db: Database): Kysely<DB> {
  let builder = builders.get(db);
  if (builder === undefined) {
    builder = new Kysely<DB>({ dialect: seamDialect(db) });
    builders.set(db, builder);
  }
  return builder;
}

const NO_TRANSACTIONS =
  "Kysely transactions are not supported over the Database seam; wrap the work in core's transaction() instead";

// Kysely's own SQLite adapter, compiler and introspector, with a driver that
// forwards to the seam instead of opening a database itself.
function seamDialect(db: Database): Dialect {
  const connection = seamConnection(db);
  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection;
    },
    async releaseConnection() {},
    async destroy() {},
    // The seam shares one connection, and `transaction()` queues transactions
    // on it. A second path that does not queue could interleave with it.
    async beginTransaction() {
      throw new Error(NO_TRANSACTIONS);
    },
    async commitTransaction() {
      throw new Error(NO_TRANSACTIONS);
    },
    async rollbackTransaction() {
      throw new Error(NO_TRANSACTIONS);
    },
  };
  return {
    createDriver: () => driver,
    createQueryCompiler: () => new SqliteQueryCompiler(),
    createAdapter: () => new SqliteAdapter(),
    createIntrospector: (kysely) => new SqliteIntrospector(kysely),
  };
}

/**
 * Statements that return rows go to `db.query`, everything else to
 * `db.execute`: `better-sqlite3` refuses to read rows from a statement that
 * returns none. Results of non-reader statements are empty, with no affected
 * row count or insert id; add `.returning(...)` when a caller needs either.
 *
 * Booleans are bound as 1 and 0, as SQLite stores them (`better-sqlite3`
 * rejects booleans; the desktop backend converts them the same way).
 */
function seamConnection(db: Database): DatabaseConnection {
  return {
    async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
      const params = compiled.parameters.map((p) => (typeof p === "boolean" ? Number(p) : p));
      if (returnsRows(compiled)) {
        return { rows: await db.query<R>(compiled.sql, params) };
      }
      await db.execute(compiled.sql, params);
      return { rows: [] };
    },
    // biome-ignore lint/correctness/useYield: it refuses before yielding anything.
    async *streamQuery(): AsyncIterableIterator<QueryResult<never>> {
      throw new Error("Streaming queries are not supported over the Database seam");
    },
  };
}

/**
 * Whether a compiled query returns rows. Builder queries are judged by their
 * node: a SELECT (including CTEs and UNIONs), or an INSERT/UPDATE/DELETE with
 * RETURNING. Raw `sql` statements carry no structure, so they count as readers
 * when they start with SELECT, WITH or VALUES, or mention RETURNING. Anything
 * subtler than that should call the seam directly.
 */
function returnsRows({ query, sql }: CompiledQuery): boolean {
  const node: RootOperationNode = query;
  switch (node.kind) {
    case "SelectQueryNode":
      return true;
    case "InsertQueryNode":
    case "UpdateQueryNode":
    case "DeleteQueryNode":
    case "MergeQueryNode":
      return node.returning !== undefined;
    case "RawNode":
      return /^\s*(select|with|values)\b/i.test(sql) || /\breturning\b/i.test(sql);
    default:
      return false;
  }
}
