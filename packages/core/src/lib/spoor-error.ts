/**
 * Typed errors. Every failure core raises on purpose is a `SpoorError`, so an app
 * can tell a failure the user caused from a bug by its `code`, and word it for
 * users from `code` and `details`. Its `message` is for developers and names ids;
 * an app never shows it. Anything else thrown out of core, such as a SQL error from
 * the database, is a bug.
 */

/**
 * What went wrong, which also says who caused it. The `details` each code carries
 * are listed with it; see `SpoorErrorDetails`.
 *
 * Expected, the user can cause them:
 * - `invalid`: the input breaks a rule on its own, whatever else is stored: a
 *   required value left out, a value outside its field's constraints, a malformed
 *   import file, or an operation never allowed on the record as it is, such as
 *   deleting a thing type's title field.
 *   Details: `entity` and `id` (the record written, when there is one), `field`
 *   (the input property at fault), `fieldId` (a thing or log field whose value or
 *   definition is at fault), `metricId` (an observation metric whose value is at
 *   fault), `constraint` (with `field: "constraints"`, the constraint at fault),
 *   `rule` and `limit` (for a value its field refuses), `path` (where in an
 *   import file).
 * - `conflict`: the input is fine on its own, but other stored data is in the way:
 *   a name or external id already used, an overlapping or later ongoing interval,
 *   an interval already stopped, a database that isn't empty for an import, things
 *   with no value for the field picked as their type's title.
 *   Details: `entity` and `id` (the record written, when there is one), `field`
 *   (the input property whose value clashes, such as `name` or `externalId`),
 *   `fieldId` (the field the clash is on), `count` (how many records are in the
 *   way, such as the things with no value for a title field).
 * - `archived`: the record written to, or one it needs, is archived.
 *   Details: `entity` and `id` (the archived record).
 * - `newer_version`: the database or an import file was written by a newer Spoor;
 *   updating the app fixes it.
 *   Details: `version` (the one found) and `supported` (the newest this Spoor knows).
 *
 * Usually a stale UI, or a bug:
 * - `not_found`: a record named by id does not exist, or is not where the input
 *   says it is, such as a field of another type.
 *   Details: `entity` and `id` (the missing record), `fieldId` (when it was named
 *   as a field's value).
 *
 * A bug, which no input from the user should cause:
 * - `internal`: a broken invariant: corrupt stored data, a failed migration, or
 *   core's internals used in a way they don't support.
 *   Details: `entity` and `id` (the record whose stored data is corrupt), when
 *   known. The underlying error, if any, is the `cause`.
 */
export type SpoorErrorCode =
  | "invalid"
  | "conflict"
  | "archived"
  | "newer_version"
  | "not_found"
  | "internal";

/** A kind of record, as `details.entity` names it. */
export type SpoorEntity =
  | "thing"
  | "thing_type"
  | "thing_field"
  | "log_entry"
  | "log_type"
  | "log_field"
  | "observation"
  | "observation_metric"
  | "timeline"
  | "timeline_category"
  | "timeline_interval"
  | "setting";

/**
 * The rule a field's value broke, as `details.rule` names it. Most are the name
 * of the constraint that refused it; `limit` is that constraint's value.
 * - `required`: the field has no value but needs one.
 * - `type`: not a value of the field's type, such as text for a number field.
 * - `option`: not one of the field's options.
 * - `unique`: a multi-valued field lists a member twice.
 * - `range`: a datetime outside the years 0000 to 9999.
 * - `min`, `max`: a number or date beyond its bound (`limit`).
 * - `precision`: more decimal places than `limit`.
 * - `minLength`, `maxLength`: text shorter or longer than `limit` characters.
 * - `minSelected`, `maxSelected`: fewer or more than `limit` options selected.
 */
export type SpoorValueRule =
  | "required"
  | "type"
  | "option"
  | "unique"
  | "range"
  | "min"
  | "max"
  | "precision"
  | "minLength"
  | "maxLength"
  | "minSelected"
  | "maxSelected";

/** What an app needs to word an error for users. See `SpoorErrorCode` for each code's. */
export interface SpoorErrorDetails {
  /** The kind of record the error is about. */
  entity?: SpoorEntity;
  /** That record's id. */
  id?: string;
  /** The input property at fault, as the API names it, such as `name` or `occurredAt`. */
  field?: string;
  /** The thing or log field whose value or definition is at fault. */
  fieldId?: string;
  /** The observation metric whose value is at fault. */
  metricId?: string;
  /** With `field: "constraints"`, the constraint at fault, such as `min` or `options`. */
  constraint?: string;
  /** The rule a field's value broke. */
  rule?: SpoorValueRule;
  /** The bound `rule` sets, such as a minimum. */
  limit?: number | string;
  /** Where in an import file, such as `things[3]` or `schemaVersion`. */
  path?: string;
  /** How many records are in the way, such as the things with no value for a title field. */
  count?: number;
  /** The version found, for `newer_version`. */
  version?: number;
  /** The newest version this Spoor supports, for `newer_version`. */
  supported?: number;
}

/** A failure core raises on purpose. See `SpoorErrorCode`. */
export class SpoorError extends Error {
  override readonly name = "SpoorError";

  constructor(
    readonly code: SpoorErrorCode,
    /** For developers: ids are fine here. Apps word errors from `code` and `details`. */
    message: string,
    readonly details: SpoorErrorDetails = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** True for a `SpoorError`; anything else thrown out of core is a bug. */
export function isSpoorError(error: unknown): error is SpoorError {
  return error instanceof SpoorError;
}

/**
 * `parse()`, for data core stored itself. The parsers it reuses refuse bad input
 * as `invalid`, but stored data they refuse is corrupt, so that error is rethrown
 * as `internal`, with it as the cause.
 */
export function parseStored<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    if (!isSpoorError(error) || error.code !== "invalid") throw error;
    const { entity, id } = error.details;
    throw new SpoorError(
      "internal",
      `Stored data is corrupt: ${error.message}`,
      { entity, id },
      { cause: error },
    );
  }
}
