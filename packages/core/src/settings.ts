import { isTimeZone, systemTimeZone } from "./days";
import type { Database } from "./platform/index";
import { now } from "./time";

/**
 * Settings (see docs/data-spec.md § Settings): one row per key, with a JSON
 * value. Settings are configuration, so the typed-column rule does not apply.
 * The value travels as JSON text because the desktop IPC accepts only scalars.
 */

/** The parsed value stored under `key`, or `undefined` if it was never set. */
export async function getSetting<T>(db: Database, key: string): Promise<T | undefined> {
  const [row] = await db.query<{ value: string }>("SELECT value FROM settings WHERE key = ?", [
    key,
  ]);
  return row === undefined ? undefined : (JSON.parse(row.value) as T);
}

/** Stores `value` under `key`, replacing any previous value. Throws if it is not JSON. */
export async function setSetting(db: Database, key: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value);
  if (json === undefined) {
    throw new Error(`Setting ${JSON.stringify(key)} must be a JSON value; got ${typeof value}`);
  }
  await db.execute(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, json, now()],
  );
}

/**
 * The user's time zone: the `time_zone` setting, or the device's zone when it is
 * unset or names a zone this platform does not know.
 */
export async function getTimeZone(db: Database): Promise<string> {
  const stored = await getSetting<unknown>(db, "time_zone");
  return isTimeZone(stored) ? stored : systemTimeZone();
}

/** Sets the `time_zone` setting. Throws unless `timeZone` is a valid IANA ID. */
export async function setTimeZone(db: Database, timeZone: string): Promise<void> {
  if (!isTimeZone(timeZone)) {
    throw new Error(`Setting "time_zone": invalid time zone ${JSON.stringify(timeZone)}`);
  }
  await setSetting(db, "time_zone", timeZone);
}
