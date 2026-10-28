import {
  createMetric,
  type Database,
  dayOf,
  deleteMetric,
  deleteObservation,
  getMetricVersion,
  getTimeZone,
  listMetrics,
  listMetricVersions,
  listObservations,
  METRIC_VALUE_TYPES,
  type MetricValueType,
  now,
  type Observation,
  type ObservationMetric,
  type ObservationMetricVersion,
  optionLabel,
  recordObservation,
  restoreObservationRecords,
  reviseMetric,
  setMetricArchived,
  updateMetric,
  type Value,
} from "@spoor/core";
import { type FormEvent, useEffect, useState } from "react";
import { Trash } from "./Timelines";

type Run = (action: () => Promise<unknown>) => void;

/**
 * Proof-of-concept Observations screen: every core read and write, wired to
 * plain HTML controls. Constraints and option labels are typed as JSON. Its
 * only job is to show the slice works end to end over IPC; the real UI
 * replaces it.
 */
export function Observations({ db }: { db: Database }) {
  const [metrics, setMetrics] = useState<ObservationMetric[]>([]);
  const [trashed, setTrashed] = useState<ObservationMetric[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // Runs a write, shows any error, and reloads everything.
  const run: Run = (action) => {
    setError(null);
    action()
      .catch((e: Error) => setError(e.message))
      .finally(() => setVersion((v) => v + 1));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` triggers the reload.
  useEffect(() => {
    Promise.all([listMetrics(db), listMetrics(db, { trashed: true })])
      .then(([live, trash]) => {
        setMetrics(live);
        setTrashed(trash);
      })
      .catch((e: Error) => setError(e.message));
  }, [db, version]);

  const selected = metrics.find((m) => m.id === selectedId);

  return (
    <section className="timelines">
      <h2>Observations</h2>
      {error && <p className="error">{error}</p>}

      <ShapeForm
        withName
        submitLabel="Add"
        onSubmit={(shape, { name, labels }) =>
          run(() => createMetric(db, { ...shape, name, optionLabels: parseJson(labels) as never }))
        }
      />
      <ul>
        {metrics.map((m) => (
          <li key={m.id}>
            <button type="button" onClick={() => setSelectedId(m.id)}>
              {m.id === selectedId ? <strong>{m.name}</strong> : m.name}
            </button>{" "}
            v{m.schemaVersion}
            {m.archivedAt !== null && " · archived"}{" "}
            <button
              type="button"
              onClick={() => run(() => setMetricArchived(db, m.id, m.archivedAt === null))}
            >
              {m.archivedAt === null ? "Archive" : "Unarchive"}
            </button>{" "}
            <button type="button" onClick={() => run(() => deleteMetric(db, m.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      <Trash
        items={trashed.map((m) => ({ id: m.id, label: m.name, deletionId: m.deletionId }))}
        onRestore={(deletionId) => run(() => restoreObservationRecords(db, deletionId))}
      />

      {selected && (
        <MetricDetail key={selected.id} db={db} metric={selected} version={version} run={run} />
      )}
    </section>
  );
}

/** Value type and constraints, plus a name and option labels when creating. */
function ShapeForm({
  withName = false,
  submitLabel,
  onSubmit,
}: {
  withName?: boolean;
  submitLabel: string;
  onSubmit: (
    shape: { valueType: MetricValueType; constraints: unknown },
    extra: { name: string; labels: string },
  ) => void;
}) {
  const [name, setName] = useState("");
  const [valueType, setValueType] = useState<MetricValueType>("boolean");
  const [constraints, setConstraints] = useState("");
  const [labels, setLabels] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({ valueType, constraints: parseJson(constraints) }, { name, labels });
    setName("");
  };
  return (
    <form onSubmit={submit}>
      {withName && (
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New metric" />
      )}{" "}
      <select value={valueType} onChange={(e) => setValueType(e.target.value as MetricValueType)}>
        {METRIC_VALUE_TYPES.map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>{" "}
      <input
        value={constraints}
        onChange={(e) => setConstraints(e.target.value)}
        placeholder='Constraints, e.g. {"min": 0}'
      />{" "}
      {withName && (
        <input
          value={labels}
          onChange={(e) => setLabels(e.target.value)}
          placeholder='Labels, e.g. {"low": "Low"}'
        />
      )}{" "}
      <button type="submit">{submitLabel}</button>
    </form>
  );
}

function MetricDetail({
  db,
  metric,
  version,
  run,
}: {
  db: Database;
  metric: ObservationMetric;
  version: number;
  run: Run;
}) {
  const [current, setCurrent] = useState<ObservationMetricVersion>();
  const [versions, setVersions] = useState<ObservationMetricVersion[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [trashedObservations, setTrashedObservations] = useState<Observation[]>([]);
  const [name, setName] = useState(metric.name);
  const [labels, setLabels] = useState(JSON.stringify(metric.optionLabels));
  const [date, setDate] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` triggers the reload.
  useEffect(() => {
    Promise.all([
      getMetricVersion(db, metric.id, metric.schemaVersion),
      listMetricVersions(db, metric.id),
      listObservations(db, metric.id),
      listObservations(db, metric.id, { trashed: true }),
    ]).then(([c, v, o, to]) => {
      setCurrent(c);
      setVersions(v);
      setObservations(o);
      setTrashedObservations(to);
    });
  }, [db, metric.id, metric.schemaVersion, version]);

  // Today in the user's time zone, the day new values default to.
  useEffect(() => {
    getTimeZone(db).then((zone) => setDate(dayOf(now(), zone)));
  }, [db]);

  const show = (o: Observation) => {
    const text = Array.isArray(o.value)
      ? o.value.map((k) => optionLabel(metric.optionLabels, k)).join(", ") || "(none)"
      : o.valueType === "enum"
        ? optionLabel(metric.optionLabels, o.value as string)
        : String(o.value);
    return `${o.date}: ${text}`;
  };

  const rename = (e: FormEvent) => {
    e.preventDefault();
    run(() => updateMetric(db, metric.id, { name, optionLabels: parseJson(labels) as never }));
  };

  return (
    <div>
      <h3>{metric.name}</h3>
      <form onSubmit={rename}>
        <input value={name} onChange={(e) => setName(e.target.value)} />{" "}
        <input value={labels} onChange={(e) => setLabels(e.target.value)} title="Option labels" />{" "}
        <button type="submit">Save</button>
      </form>

      <h4>Versions</h4>
      <ul>
        {versions.map((v) => (
          <li key={v.id}>
            v{v.version}: {v.valueType} {JSON.stringify(v.constraints)}
          </li>
        ))}
      </ul>
      <ShapeForm
        submitLabel="Revise"
        onSubmit={(shape) => run(() => reviseMetric(db, metric.id, shape))}
      />

      <h4>Observations</h4>
      {current && (
        <ValueForm
          key={current.id}
          version={current}
          labels={metric.optionLabels}
          date={date}
          onDate={setDate}
          onRecord={(value) =>
            run(async () => {
              const { skipped } = await recordObservation(db, metric.id, date, value);
              setNotice(skipped ? `Skipped ${date}: written by another writer` : null);
            })
          }
        />
      )}
      {notice && <p>{notice}</p>}
      <ul>
        {observations.map((o) => (
          <li key={o.id}>
            {show(o)}{" "}
            <small>
              (v{o.metricVersion}, by {o.writtenBy})
            </small>{" "}
            <button type="button" onClick={() => run(() => deleteObservation(db, o.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      <Trash
        items={trashedObservations.map((o) => ({
          id: o.id,
          label: show(o),
          deletionId: o.deletionId,
        }))}
        onRestore={(deletionId) => run(() => restoreObservationRecords(db, deletionId))}
      />
    </div>
  );
}

/** A date and a value input that fits the current version's type. */
function ValueForm({
  version,
  labels,
  date,
  onDate,
  onRecord,
}: {
  version: ObservationMetricVersion;
  labels: Record<string, string>;
  date: string;
  onDate: (date: string) => void;
  onRecord: (value: Value) => void;
}) {
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const options =
    version.valueType === "enum" || version.valueType === "multi_enum"
      ? version.constraints.options
      : [];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (version.valueType === "multi_enum") onRecord(checked);
    else if (version.valueType === "boolean") onRecord(text === "true");
    else if (version.valueType === "number") onRecord(Number(text));
    else onRecord(text);
  };
  const toggle = (key: string) =>
    setChecked((keys) => (keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key]));

  return (
    <form onSubmit={submit}>
      <input type="date" value={date} onChange={(e) => onDate(e.target.value)} required />{" "}
      {version.valueType === "number" && (
        <input
          type="number"
          step="any"
          value={text}
          onChange={(e) => setText(e.target.value)}
          required
        />
      )}
      {(version.valueType === "boolean" || version.valueType === "enum") && (
        <select value={text} onChange={(e) => setText(e.target.value)} required>
          <option value="">Value…</option>
          {version.valueType === "boolean" ? (
            <>
              <option value="true">yes</option>
              <option value="false">no</option>
            </>
          ) : (
            options.map((o) => (
              <option key={o.key} value={o.key}>
                {optionLabel(labels, o.key)}
              </option>
            ))
          )}
        </select>
      )}
      {version.valueType === "multi_enum" &&
        options.map((o) => (
          <label key={o.key}>
            <input
              type="checkbox"
              checked={checked.includes(o.key)}
              onChange={() => toggle(o.key)}
            />{" "}
            {optionLabel(labels, o.key)}{" "}
          </label>
        ))}{" "}
      <button type="submit">Record</button>
    </form>
  );
}

/** `text` parsed as JSON, or `undefined` when blank; invalid JSON reaches core as a string. */
function parseJson(text: string): unknown {
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
