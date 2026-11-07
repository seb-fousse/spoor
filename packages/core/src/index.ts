/**
 * `@spoor/core` public surface.
 *
 * Apps import from here only. This is the package's only barrel: it lists what
 * is public by name, so anything not listed stays internal. Inside the package,
 * import from the file that defines a thing, not from here.
 */

export type { Database, HealthSource, SecretStore } from "./db/platform";
export { migrate } from "./db/schema/migrate";
export { transaction } from "./db/transaction";
export type { FieldDefinition, FieldPatch, NewField, ValuePatch } from "./definitions/engine";
export {
  dayOf,
  dayOfEntry,
  dayRange,
  daysSpanned,
  isTimeZone,
  type Precision,
  startOfDay,
  systemTimeZone,
  truncateToPrecision,
} from "./lib/days";
export { isUuid, newId } from "./lib/ids";
export {
  addDays,
  compareLocalDates,
  type Instant,
  instantToIso,
  isInstant,
  isLocalDate,
  isoToInstant,
  type LocalDate,
  now,
} from "./lib/time";
export {
  createLogEntry,
  type DayLogEntry,
  type DayLogGroup,
  deleteLogEntry,
  type EntryTime,
  entryDay,
  getLogEntry,
  type LogEntry,
  type LogEntryPatch,
  listChildEntries,
  listDayLogEntries,
  listLogEntries,
  moveChildEntry,
  type NewLogEntry,
  PRECISIONS,
  previewLogEntryDeletion,
  updateLogEntry,
} from "./logs/entries";
export {
  addLogField,
  createLogType,
  deleteLogField,
  deleteLogType,
  getLogType,
  getLogTypeFields,
  type LogField,
  type LogType,
  type LogTypeDeletion,
  listLogTypes,
  type NewLogField,
  previewLogFieldDeletion,
  previewLogTypeDeletion,
  reorderLogFields,
  setLogTypeArchived,
  updateLogField,
  updateLogType,
} from "./logs/log-types";
export {
  createMetric,
  deleteMetric,
  getMetric,
  listMetrics,
  type MetricShape,
  type ObservationMetric,
  previewMetricDeletion,
  setMetricArchived,
  updateMetric,
} from "./observations/metrics";
export {
  deleteObservation,
  getObservation,
  listDayObservations,
  listObservations,
  type MetricDay,
  type Observation,
  type RecordObservationResult,
  recordObservation,
} from "./observations/observations";
export { exportData, exportJson } from "./portable/export";
export { importData, importJson } from "./portable/import";
export type { ExportDocument } from "./portable/registry";
export { getSetting, getTimeZone, setSetting, setTimeZone } from "./settings/settings";
export { mergeThings } from "./things/merge";
export {
  addThingField,
  createThingType,
  deleteThingField,
  deleteThingType,
  getThingType,
  getThingTypeFields,
  listThingTypes,
  previewThingFieldDeletion,
  previewThingTypeDeletion,
  reorderThingFields,
  setThingTypeArchived,
  type ThingDeletion,
  type ThingType,
  updateThingField,
  updateThingType,
} from "./things/thing-types";
export {
  createThing,
  deleteThing,
  getThing,
  getThingTitle,
  listThings,
  previewThingDeletion,
  type Thing,
  updateThingValues,
} from "./things/things";
export {
  createCategory,
  deleteCategory,
  getCategory,
  listCategories,
  previewCategoryDeletion,
  setCategoryArchived,
  type TimelineCategory,
  updateCategory,
} from "./timelines/categories";
export {
  createInterval,
  deleteInterval,
  getInterval,
  listIntervals,
  listIntervalsInRange,
  startInterval,
  stopInterval,
  type TimelineInterval,
  updateInterval,
} from "./timelines/intervals";
export {
  createTimeline,
  deleteTimeline,
  getTimeline,
  listTimelines,
  previewTimelineDeletion,
  setTimelineArchived,
  type Timeline,
  type TimelineDeletion,
  updateTimeline,
} from "./timelines/timelines";
export {
  FIELD_VALUE_TYPES,
  type FieldValueType,
  METRIC_VALUE_TYPES,
  type MetricValueType,
  optionLabel,
  VALUE_TYPES,
  type Value,
  type ValueShape,
  type ValueType,
} from "./values/values";
