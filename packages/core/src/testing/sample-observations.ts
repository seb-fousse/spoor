import type { Database } from "../db/platform";
import {
  createMetric,
  deleteMetric,
  setMetricArchived,
  updateMetric,
} from "../observations/metrics";
import { deleteObservation, recordObservation } from "../observations/observations";

/**
 * TEST-ONLY. Observation rows for `populate`: metrics, one archived and one
 * whose constraints changed, and observations of every value type (`multi_enum` with
 * none and several selected, one automated). A deleted metric and a deleted
 * observation leave nothing behind.
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
  // Now one decimal place at most; the first observation is not re-validated.
  await updateMetric(db, water.id, { constraints: { unit: "cups", min: 0, precision: 1 } });
  await recordObservation(db, water.id, "2026-10-20", 7.5, {
    writtenBy: "healthkit",
    externalId: "hk-1",
  });
  const deleted = await recordObservation(db, water.id, "2026-10-21", 2);
  await deleteObservation(db, deleted.observation.id);

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
}
