import {
  Alert,
  Button,
  Checkbox,
  Group,
  NativeSelect,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
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
 * basic Mantine controls. Constraints and option labels are typed as JSON. Its
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
    <Stack component="section" gap="sm">
      <Title order={2}>Observations</Title>
      {error && <Alert color="red">{error}</Alert>}

      <ShapeForm
        withName
        submitLabel="Add"
        onSubmit={(shape, { name, labels }) =>
          run(() => createMetric(db, { ...shape, name, optionLabels: parseJson(labels) as never }))
        }
      />
      <Stack gap={4}>
        {metrics.map((m) => (
          <Group key={m.id} gap="xs">
            <Button
              size="xs"
              variant={m.id === selectedId ? "light" : "subtle"}
              onClick={() => setSelectedId(m.id)}
            >
              {m.name}
            </Button>
            <Text size="sm" c="dimmed">
              v{m.schemaVersion}
              {m.archivedAt !== null && " · archived"}
            </Text>
            <Button
              size="xs"
              variant="default"
              onClick={() => run(() => setMetricArchived(db, m.id, m.archivedAt === null))}
            >
              {m.archivedAt === null ? "Archive" : "Unarchive"}
            </Button>
            <Button
              size="xs"
              variant="light"
              color="red"
              onClick={() => run(() => deleteMetric(db, m.id))}
            >
              Delete
            </Button>
          </Group>
        ))}
      </Stack>
      <Trash
        items={trashed.map((m) => ({ id: m.id, label: m.name, deletionId: m.deletionId }))}
        onRestore={(deletionId) => run(() => restoreObservationRecords(db, deletionId))}
      />

      {selected && (
        <MetricDetail key={selected.id} db={db} metric={selected} version={version} run={run} />
      )}
    </Stack>
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
      <Group gap="xs" align="flex-end">
        {withName && (
          <TextInput
            size="xs"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="New metric"
            aria-label="New metric"
          />
        )}
        <Select
          size="xs"
          data={METRIC_VALUE_TYPES}
          value={valueType}
          onChange={(v) => v && setValueType(v as MetricValueType)}
          allowDeselect={false}
          aria-label="Value type"
        />
        <TextInput
          size="xs"
          value={constraints}
          onChange={(e) => setConstraints(e.currentTarget.value)}
          placeholder='Constraints, e.g. {"min": 0}'
          aria-label="Constraints"
        />
        {withName && (
          <TextInput
            size="xs"
            value={labels}
            onChange={(e) => setLabels(e.currentTarget.value)}
            placeholder='Labels, e.g. {"low": "Low"}'
            aria-label="Labels"
          />
        )}
        <Button type="submit" size="xs">
          {submitLabel}
        </Button>
      </Group>
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
    <Stack gap="sm">
      <Title order={3}>{metric.name}</Title>
      <form onSubmit={rename}>
        <Group gap="xs" align="flex-end">
          <TextInput
            size="xs"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            aria-label="Name"
          />
          <TextInput
            size="xs"
            value={labels}
            onChange={(e) => setLabels(e.currentTarget.value)}
            title="Option labels"
            aria-label="Option labels"
          />
          <Button type="submit" size="xs">
            Save
          </Button>
        </Group>
      </form>

      <Title order={4}>Versions</Title>
      <Stack gap={4}>
        {versions.map((v) => (
          <Text key={v.id} size="sm">
            v{v.version}: {v.valueType} {JSON.stringify(v.constraints)}
          </Text>
        ))}
      </Stack>
      <ShapeForm
        submitLabel="Revise"
        onSubmit={(shape) => run(() => reviseMetric(db, metric.id, shape))}
      />

      <Title order={4}>Observations</Title>
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
      {notice && <Text size="sm">{notice}</Text>}
      <Stack gap={4}>
        {observations.map((o) => (
          <Group key={o.id} gap="xs">
            <Text size="sm">{show(o)}</Text>
            <Text size="sm" c="dimmed">
              (v{o.metricVersion}, by {o.writtenBy})
            </Text>
            <Button
              size="xs"
              variant="light"
              color="red"
              onClick={() => run(() => deleteObservation(db, o.id))}
            >
              Delete
            </Button>
          </Group>
        ))}
      </Stack>
      <Trash
        items={trashedObservations.map((o) => ({
          id: o.id,
          label: show(o),
          deletionId: o.deletionId,
        }))}
        onRestore={(deletionId) => run(() => restoreObservationRecords(db, deletionId))}
      />
    </Stack>
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
      <Group gap="xs" align="flex-end">
        <TextInput
          size="xs"
          type="date"
          value={date}
          onChange={(e) => onDate(e.currentTarget.value)}
          required
          aria-label="Date"
        />
        {version.valueType === "number" && (
          <NumberInput
            size="xs"
            value={text}
            onChange={(v) => setText(String(v))}
            required
            aria-label="Value"
          />
        )}
        {/* NativeSelect, not Select: Mantine's Select input is read-only, so `required` would not stop an empty submit. */}
        {(version.valueType === "boolean" || version.valueType === "enum") && (
          <NativeSelect
            size="xs"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
            required
            aria-label="Value"
            data={[
              { value: "", label: "Value…" },
              ...(version.valueType === "boolean"
                ? [
                    { value: "true", label: "yes" },
                    { value: "false", label: "no" },
                  ]
                : options.map((o) => ({ value: o.key, label: optionLabel(labels, o.key) }))),
            ]}
          />
        )}
        {version.valueType === "multi_enum" &&
          options.map((o) => (
            <Checkbox
              key={o.key}
              size="xs"
              label={optionLabel(labels, o.key)}
              checked={checked.includes(o.key)}
              onChange={() => toggle(o.key)}
            />
          ))}
        <Button type="submit" size="xs">
          Record
        </Button>
      </Group>
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
