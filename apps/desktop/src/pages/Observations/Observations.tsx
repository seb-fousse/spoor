import { effect, useConfirmDelete } from "@components/ConfirmDelete";
import {
  useCreateMetric,
  useDeleteMetric,
  useDeleteObservation,
  useMetricObservations,
  useMetrics,
  useRecordObservation,
  useSetMetricArchived,
  useUpdateMetric,
} from "@data/observations";
import { useTimeZone } from "@data/settings";
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
import { DatePickerInput } from "@mantine/dates";
import { useDatabase } from "@platform/DatabaseProvider";
import {
  dayOf,
  METRIC_VALUE_TYPES,
  type MetricValueType,
  now,
  type Observation,
  type ObservationMetric,
  optionLabel,
  previewMetricDeletion,
  type Value,
} from "@spoor/core";
import { type FormEvent, useState } from "react";

type Run = (action: () => Promise<unknown>) => void;

/**
 * Proof-of-concept Observations screen: every core read and write, wired to
 * basic Mantine controls. Constraints and option labels are typed as JSON. Its
 * only job is to show the slice works end to end over IPC; the real UI
 * replaces it.
 */
export function Observations() {
  const db = useDatabase();
  const metricsQuery = useMetrics();
  const metrics = metricsQuery.data ?? [];
  const createMetric = useCreateMetric();
  const setMetricArchived = useSetMetricArchived();
  const deleteMetric = useDeleteMetric();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Runs a write and shows any error. Each write's mutation invalidates what
  // it changed, so this page's lists and Home's reload.
  const run: Run = (action) => {
    setError(null);
    action().catch((e: Error) => setError(e.message));
  };

  const [confirmDelete, deleteDialog] = useConfirmDelete(run);

  const selected = metrics.find((m) => m.id === selectedId);
  const shownError = error ?? metricsQuery.error?.message ?? null;

  return (
    <Stack component="section" gap="sm">
      <Title order={2}>Observations</Title>
      {shownError && <Alert color="red">{shownError}</Alert>}
      {deleteDialog}

      <ShapeForm
        submitLabel="Add"
        onSubmit={(shape, { name, labels }) =>
          run(() =>
            createMetric.mutateAsync({
              ...shape,
              name,
              optionLabels: parseJson(labels) as never,
            }),
          )
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
              {m.valueType}
              {m.archivedAt !== null && " · archived"}
            </Text>
            <Button
              size="xs"
              variant="default"
              onClick={() =>
                run(() =>
                  setMetricArchived.mutateAsync({ id: m.id, archived: m.archivedAt === null }),
                )
              }
            >
              {m.archivedAt === null ? "Archive" : "Unarchive"}
            </Button>
            <Button
              size="xs"
              variant="light"
              color="red"
              onClick={() =>
                confirmDelete(
                  `the ${m.name} metric`,
                  () => deleteMetric.mutateAsync(m.id),
                  async () => [
                    effect(
                      "deletes",
                      (await previewMetricDeletion(db, m.id)).observations,
                      "observation",
                    ),
                  ],
                )
              }
            >
              Delete
            </Button>
          </Group>
        ))}
      </Stack>

      {selected && <MetricDetail key={selected.id} metric={selected} run={run} />}
    </Stack>
  );
}

/** A new metric: its name, value type, constraints and option labels. */
function ShapeForm({
  submitLabel,
  onSubmit,
}: {
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
        <TextInput
          size="xs"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="New metric"
          aria-label="New metric"
        />
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
        <TextInput
          size="xs"
          value={labels}
          onChange={(e) => setLabels(e.currentTarget.value)}
          placeholder='Labels, e.g. {"low": "Low"}'
          aria-label="Labels"
        />
        <Button type="submit" size="xs">
          {submitLabel}
        </Button>
      </Group>
    </form>
  );
}

function MetricDetail({ metric, run }: { metric: ObservationMetric; run: Run }) {
  const observations = useMetricObservations(metric.id).data ?? [];
  const updateMetric = useUpdateMetric();
  const recordObservation = useRecordObservation();
  const deleteObservation = useDeleteObservation();
  const timeZone = useTimeZone().data;
  // Set from the metric once, when it is selected (the parent keys this by id),
  // so the refetch after a save leaves what the user typed alone.
  const [name, setName] = useState(metric.name);
  const [constraints, setConstraints] = useState(JSON.stringify(metric.constraints));
  const [labels, setLabels] = useState(JSON.stringify(metric.optionLabels));
  // The day the user picked; until they pick one, today in the user's time zone.
  const [pickedDate, setDate] = useState<string | null>(null);
  const date = pickedDate ?? (timeZone ? dayOf(now(), timeZone) : "");
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, deleteDialog] = useConfirmDelete(run);

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
    run(() =>
      updateMetric.mutateAsync({
        id: metric.id,
        patch: {
          name,
          constraints: parseJson(constraints),
          optionLabels: parseJson(labels) as never,
        },
      }),
    );
  };

  return (
    <Stack gap="sm">
      <Title order={3}>{metric.name}</Title>
      {deleteDialog}
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
            value={constraints}
            onChange={(e) => setConstraints(e.currentTarget.value)}
            title={`Constraints of this ${metric.valueType} metric`}
            aria-label="Constraints"
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

      <Title order={4}>Observations</Title>
      <ValueForm
        key={metric.updatedAt}
        metric={metric}
        labels={metric.optionLabels}
        date={date}
        onDate={setDate}
        onRecord={(value) =>
          run(async () => {
            const { skipped } = await recordObservation.mutateAsync({
              metricId: metric.id,
              date,
              value,
            });
            setNotice(skipped ? `Skipped ${date}: written by another writer` : null);
          })
        }
      />
      {notice && <Text size="sm">{notice}</Text>}
      <Stack gap={4}>
        {observations.map((o) => (
          <Group key={o.id} gap="xs">
            <Text size="sm">{show(o)}</Text>
            <Text size="sm" c="dimmed">
              (by {o.writtenBy})
            </Text>
            <Button
              size="xs"
              variant="light"
              color="red"
              onClick={() =>
                confirmDelete(`the observation for ${o.date}`, () =>
                  deleteObservation.mutateAsync(o.id),
                )
              }
            >
              Delete
            </Button>
          </Group>
        ))}
      </Stack>
    </Stack>
  );
}

/** A date and a value input that fits the metric's type. */
function ValueForm({
  metric: version,
  labels,
  date,
  onDate,
  onRecord,
}: {
  metric: ObservationMetric;
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
        {/* DatePickerInput values are "YYYY-MM-DD" strings, the day format core expects. */}
        <DatePickerInput
          size="xs"
          value={date || null}
          onChange={(v) => onDate(v ?? "")}
          aria-label="Date"
          placeholder="Date"
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
        {/* The picker is not a native input, so `required` cannot stop an empty date. */}
        <Button type="submit" size="xs" disabled={!date}>
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
