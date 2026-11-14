import type { Database } from "@spoor/core";
import { createContext, type ReactNode, use } from "react";

const DatabaseContext = createContext<Database | null>(null);

/**
 * Gives everything below it the app's database, for `useDatabase`. App mounts
 * it once migration has finished, so nothing reads the database before then.
 * Core's functions still take the database explicitly; this only saves the
 * React layer from passing it down by hand.
 */
export function DatabaseProvider({ db, children }: { db: Database; children: ReactNode }) {
  return <DatabaseContext value={db}>{children}</DatabaseContext>;
}

/** The app's database, from the enclosing `DatabaseProvider`. */
export function useDatabase(): Database {
  const db = use(DatabaseContext);
  if (!db) throw new Error("useDatabase must be used inside a DatabaseProvider");
  return db;
}
