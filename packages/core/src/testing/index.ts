/**
 * `@spoor/core/testing`: core's helpers for tests, in core and in the apps.
 *
 * Tests only. A lint rule (#146, rule 3) keeps app code from importing it, and
 * `better-sqlite3`, which the in-memory database runs on, is a devDependency:
 * a package whose tests import this needs it as a devDependency too.
 *
 * Like the package's main barrel, it lists what it exports by name. Inside
 * core, import from the file that defines a helper, not from here.
 */

export { createInMemoryDatabase } from "./in-memory-database";
export { dumpAll, populate } from "./sample-data";
export { populateLogs } from "./sample-logs";
export { populateObservations } from "./sample-observations";
export { populateThings } from "./sample-things";
