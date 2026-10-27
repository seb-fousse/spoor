import {
  createMetric,
  deleteMetric,
  deleteObservation,
  recordObservation,
  reviseMetric,
  setMetricArchived,
} from "../observations";
import type { Database } from "../platform/index";

/**
 * TEST-ONLY. Observation rows for `populate`: live, archived and trashed
 * metrics, a metric with two versions, observations of every value type
 * (`multi_enum` with none and several selected, one automated), a trashed
 * observation and a purged one.
 */
export async function populateObservations(db: Database): Promise<void> {
  const teeth = await createMetric(db, { name: "Brushed teeth", valueType: "boolean" });
  await recordObservation(db, teeth.id, "2026-10-19", true);
  await recordObservation(db, teeth.id, "2026-10-20", false);

  const water = await createMetric(db, {
    name: "Water",
    description: "Cups",
    valueType: "number",
    constraints: { unit: "cups", min: 0 },
  });
  await recordObservation(db, water.id, "2026-10-19", 6);
  // Version 2 allows one decimal place at most; the first observation keeps version 1.
  await reviseMetric(db, water.id, {
    valueType: "number",
    constraints: { unit: "cups", min: 0, precision: 1 },
  });
  await recordObservation(db, water.id, "2026-10-20", 7.5, {
    writtenBy: "healthkit",
    externalId: "hk-1",
  });
  const trashed = await recordObservation(db, water.id, "2026-10-21", 2);
  await deleteObservation(db, trashed.observation.id);

  const mood = await createMetric(db, {
    name: "Mood",
    valueType: "enum",
    constraints: {
      options: [
        { key: "low", order: 1, score: 1 },
        { key: "high", order: 2, score: 5 },
      ],
    },
    optionLabels: { low: "Low", high: "High" },
  });
  await recordObservation(db, mood.id, "2026-10-20", "high");
  await setMetricArchived(db, mood.id, true);

  const symptoms = await createMetric(db, {
    name: "Symptoms",
    valueType: "multi_enum",
    constraints: {
      options: [
        { key: "headache", order: 1 },
        { key: "cough", order: 2 },
        { key: "fever", order: 3 },
      ],
      maxSelected: 3,
    },
  });
  await recordObservation(db, symptoms.id, "2026-10-19", []);
  await recordObservation(db, symptoms.id, "2026-10-20", ["fever", "headache"]);

  const gone = await createMetric(db, { name: "Gone", valueType: "boolean" });
  await recordObservation(db, gone.id, "2026-10-20", true);
  await deleteMetric(db, gone.id);

  // The purge operation does not exist yet, so write the tombstone it will leave.
  const T0 = Date.UTC(2026, 9, 20, 8);
  await db.execute(
    `INSERT INTO observations
       (id, metric_id, metric_version, created_at, updated_at, deleted_at, deletion_id, purged_at)
     VALUES ('01900000-0000-7000-8000-000000000003', ?, 1, ?, ?, ?, ?, ?)`,
    [teeth.id, T0, T0 + 1, T0 + 2, "01900000-0000-7000-8000-000000000004", T0 + 3],
  );
}
