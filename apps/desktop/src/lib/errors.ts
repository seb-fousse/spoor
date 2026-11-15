import { isSpoorError, type SpoorEntity, type SpoorErrorDetails } from "@spoor/core";

/**
 * An error in words written for users, from a `SpoorError`'s `code` and
 * `details`; see `describeError`. The error's own `message` is for developers
 * and names ids, so it is never shown.
 */
export interface DescribedError {
  /** A heading, for the errors that need one. A caller's own, such as "Could not load logs", wins. */
  title?: string;
  /** What went wrong, and what to do about it when there is something to do. */
  message: string;
  /**
   * True for a failure the user can cause: `invalid`, `conflict`, `archived`
   * and `newer_version`. Anything else is a stale screen or a bug, and worth
   * logging in full.
   */
  expected: boolean;
}

/** For a bug, and anything thrown that isn't a `SpoorError`. */
export const UNEXPECTED_ERROR: DescribedError = {
  title: "Something went wrong",
  message:
    "Spoor ran into an unexpected problem. Try again, or restart Spoor if it keeps happening.",
  expected: false,
};

/** What users call each kind of record. A timeline's intervals are its blocks. */
const ENTITY_NOUNS: Record<SpoorEntity, string> = {
  thing: "thing",
  thing_type: "thing type",
  thing_field: "field",
  log_entry: "log entry",
  log_type: "log type",
  log_field: "field",
  observation: "observation",
  observation_metric: "metric",
  timeline: "timeline",
  timeline_category: "category",
  timeline_interval: "block",
  setting: "setting",
};

/** `details.field`s users have a name for. Others are left unnamed. */
const FIELD_NOUNS: Record<string, string> = {
  name: "name",
  externalId: "external id",
};

/** The parts of a field's or metric's definition an import file can get wrong, by `details.field`. */
const DEFINITION_NOUNS: Record<string, string> = {
  valueType: "value type",
  constraints: "constraints",
  optionLabels: "option labels",
};

/**
 * Words `error` for users. Every `SpoorError` code has its wording, made more
 * precise by the details that come with it; anything else, and `internal`, is
 * `UNEXPECTED_ERROR`. Never names an id. Translating the text would happen here.
 */
export function describeError(error: unknown): DescribedError {
  if (!isSpoorError(error)) return UNEXPECTED_ERROR;
  const { details } = error;
  switch (error.code) {
    case "invalid":
      return { message: invalidMessage(details), expected: true };
    case "conflict":
      return { message: conflictMessage(details), expected: true };
    case "archived":
      return {
        message: details.entity
          ? `This ${ENTITY_NOUNS[details.entity]} is archived, so it can't be changed.`
          : "Something this needs is archived, so it can't be changed.",
        expected: true,
      };
    case "newer_version":
      return {
        title: "Update Spoor",
        message: "This data was saved by a newer version of Spoor. Update Spoor to open it.",
        expected: true,
      };
    case "not_found":
      return {
        title: "Not found",
        message: details.entity
          ? `This ${ENTITY_NOUNS[details.entity]} no longer exists. It may have been deleted.`
          : "Something this needs no longer exists. It may have been deleted.",
        expected: false,
      };
    case "internal":
      return UNEXPECTED_ERROR;
  }
}

function invalidMessage(details: SpoorErrorDetails): string {
  const { rule, limit, field, path } = details;
  if (path !== undefined) return importMessage(path, details);
  if (rule !== undefined) return valueMessage(rule, limit, ownerNoun(details));
  const noun = field === undefined ? undefined : FIELD_NOUNS[field];
  if (noun) return `That ${noun} isn't valid. Check it and try again.`;
  return "That isn't valid. Check what you entered and try again.";
}

/**
 * An import file refused at `path`. It blames the file, not the data already
 * saved, which a refused import leaves as it was, and says more when the details
 * do: a value its field or metric could not hold, or a definition Spoor can't read.
 */
function importMessage(path: string, details: SpoorErrorDetails): string {
  const { rule, limit, entity, field } = details;
  const where = `The file can't be imported: ${path} isn't valid.`;
  if (rule !== undefined) return `${where} ${valueMessage(rule, limit, ownerNoun(details))}`;
  const part = field === undefined ? undefined : DEFINITION_NOUNS[field];
  if (entity !== undefined && part !== undefined) {
    return `${where} It has a ${ENTITY_NOUNS[entity]} whose ${part} Spoor can't read.`;
  }
  return where;
}

/** What a value belongs to: an observation's to its metric, anything else's to its field. */
function ownerNoun({ entity, metricId }: SpoorErrorDetails): string {
  return entity === "observation" || metricId !== undefined ? "metric" : "field";
}

/** A value its field or metric (`owner`) refuses, for the rule it broke. */
function valueMessage(
  rule: NonNullable<SpoorErrorDetails["rule"]>,
  limit: number | string | undefined,
  owner: string,
) {
  switch (rule) {
    case "required":
      return "A required value is missing.";
    case "type":
      return `A value isn't the right kind for its ${owner}.`;
    case "option":
      return `A value isn't one of its ${owner}'s options.`;
    case "unique":
      return "The same option is chosen twice.";
    case "range":
      return "A date must be between the years 0 and 9999.";
    case "min":
      return `A value must be at least ${limit}.`;
    case "max":
      return `A value must be at most ${limit}.`;
    case "precision":
      return `A value can have at most ${limit} decimal ${limit === 1 ? "place" : "places"}.`;
    case "minLength":
      return `A value must be at least ${limit} ${limit === 1 ? "character" : "characters"} long.`;
    case "maxLength":
      return `A value must be at most ${limit} ${limit === 1 ? "character" : "characters"} long.`;
    case "minSelected":
      return `Choose at least ${limit} ${limit === 1 ? "option" : "options"}.`;
    case "maxSelected":
      return `Choose at most ${limit} ${limit === 1 ? "option" : "options"}.`;
  }
}

function conflictMessage({ entity, field, count }: SpoorErrorDetails): string {
  const noun = field === undefined ? undefined : FIELD_NOUNS[field];
  if (noun) return `That ${noun} is already used. Choose another.`;
  if (entity === "thing_type" && field === "titleFieldId") return titleFieldMessage(count);
  if (entity === "timeline" && field === "exclusive") {
    return "This timeline has overlapping blocks, so it can't be made exclusive.";
  }
  if (entity === "timeline_category" && field === "thingId") {
    return "That thing already has a category on this timeline.";
  }
  if (entity === "timeline_interval") {
    return field === "at"
      ? "A block is already ongoing on this timeline."
      : "That would overlap another block on this timeline.";
  }
  return "That clashes with something already saved.";
}

/** A title field refused because `count` things of the type have no value for it. */
function titleFieldMessage(count: number | undefined): string {
  const reason = "no value for that field, so it can't be the title.";
  if (count === 1) return `1 thing has ${reason} Fill it in first.`;
  const things = count === undefined ? "Some things" : `${count} things`;
  return `${things} have ${reason} Fill it in for each first.`;
}
