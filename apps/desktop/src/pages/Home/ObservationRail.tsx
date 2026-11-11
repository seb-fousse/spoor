import {
  ActionIcon,
  Alert,
  Chip,
  Group,
  Loader,
  NumberInput,
  SegmentedControl,
  Text,
  Title,
} from "@mantine/core";
import {
  type Database,
  type LocalDate,
  type MetricDay,
  type Observation,
  optionLabel,
  type Value,
} from "@spoor/core";
import { type ReactNode, useEffect, useState } from "react";
import classes from "./ObservationRail.module.css";
import {
  atMaximum,
  countRecorded,
  meetsMinimum,
  normalizeNumber,
  stepNumber,
  toggleOption,
} from "./observationValues";
import { useDayObservations } from "./useDayObservations";

interface ObservationRailProps {
  db: Database;
  /** The day the cards show and record on. */
  day: LocalDate;
  /** Called after each recorded value, so other views of the day can refresh. */
  onRecorded?: (observation: Observation) => void;
}

/**
 * The rail's observations: a card per active metric for `day`, with a control
 * that fits the metric's type. One click (or, for a typed number, Enter or
 * leaving the field) records the value; recording again revises it.
 */
export function ObservationRail({ db, day, onRecorded }: ObservationRailProps) {
  const data = useDayObservations(db, day, onRecorded);
  const { recorded, total } = countRecorded(data.items);
  // The previous day's cards stay until the new ones load, shown but not usable.
  const stale = data.day !== day;

  return (
    <div className={classes.rail}>
      <Group justify="space-between" align="baseline">
        <Title order={3}>Observations</Title>
        {!stale && (
          <Text size="sm" c="dimmed" ff="monospace">
            {recorded}/{total} recorded
          </Text>
        )}
      </Group>
      {data.error !== null && (
        <Alert color="red" title="Could not save or load observations">
          {data.error}
        </Alert>
      )}
      {data.day === null && data.error === null && <Loader size="sm" />}
      {data.day !== null && data.items.length === 0 && (
        <Text c="dimmed">No metrics yet. Add one on the Observations page to record it here.</Text>
      )}
      <div className={classes.cards} inert={stale} data-stale={stale || undefined}>
        {data.items.map((item) => (
          <ObservationCard
            // Per day, so a card's unsaved input never carries over to another day.
            key={`${data.day}:${item.metric.id}`}
            item={item}
            onRecord={(value) => data.record(item.metric.id, value)}
          />
        ))}
      </div>
    </div>
  );
}

function ObservationCard({
  item: { metric, observation },
  onRecord,
}: {
  item: MetricDay;
  onRecord: (value: Value) => Promise<void>;
}) {
  // What the card shows instead of the stored value: a click not yet saved, or
  // a selection with fewer options than the metric needs. Dropped if saving fails.
  const [local, setLocal] = useState<Value | null>(null);
  const value = local ?? observation?.value ?? null;
  const save = (next: Value) => {
    setLocal(next);
    onRecord(next).catch(() => setLocal(null));
  };
  const labelled = (key: string) => ({ value: key, label: optionLabel(metric.optionLabels, key) });

  let control: ReactNode;
  let hint: string | null = null;
  switch (metric.valueType) {
    case "boolean":
      control = (
        <SegmentedControl
          className={classes.segmented}
          aria-label={metric.name}
          data={[
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ]}
          value={value === null ? "" : String(value)}
          onChange={(v) => save(v === "true")}
        />
      );
      break;
    case "enum":
      control = (
        <SegmentedControl
          className={classes.segmented}
          aria-label={metric.name}
          data={metric.constraints.options.map((o) => labelled(o.key))}
          value={(value as string | null) ?? ""}
          onChange={save}
        />
      );
      break;
    case "multi_enum": {
      const c = metric.constraints;
      const selected = (value as string[] | null) ?? [];
      if (!meetsMinimum(selected, c)) hint = `Pick at least ${c.minSelected}`;
      control = (
        <Group gap={6}>
          {c.options.map((o) => {
            const checked = selected.includes(o.key);
            return (
              <Chip
                key={o.key}
                size="xs"
                checked={checked}
                disabled={!checked && atMaximum(selected, c)}
                onChange={() => {
                  const next = toggleOption(selected, o.key, c);
                  if (meetsMinimum(next, c)) save(next);
                  else setLocal(next);
                }}
              >
                {labelled(o.key).label}
              </Chip>
            );
          })}
        </Group>
      );
      break;
    }
    case "number":
      control = (
        <NumberStepper
          name={metric.name}
          value={value as number | null}
          constraints={metric.constraints}
          onRecord={save}
        />
      );
      break;
  }

  return (
    <div className={classes.card} data-empty={observation === null || undefined}>
      <Group justify="space-between" gap="xs">
        <Text fw={500}>{metric.name}</Text>
        {observation === null && (
          <Text size="xs" c="dimmed">
            Not recorded
          </Text>
        )}
      </Group>
      {control}
      {hint && (
        <Text size="xs" c="dimmed">
          {hint}
        </Text>
      )}
    </div>
  );
}

type NumberConstraints = Extract<MetricDay["metric"], { valueType: "number" }>["constraints"];

/** − and + record a step from the value; a typed value records on Enter or blur. */
function NumberStepper({
  name,
  value,
  constraints,
  onRecord,
}: {
  name: string;
  value: number | null;
  constraints: NumberConstraints;
  onRecord: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | string>(value ?? "");
  useEffect(() => setDraft(value ?? ""), [value]);
  const commit = () => {
    if (typeof draft !== "number") return setDraft(value ?? "");
    const next = normalizeNumber(draft, constraints);
    setDraft(next);
    if (next !== value) onRecord(next);
  };
  const step = (by: number) => {
    const next = stepNumber(value, by, constraints);
    if (next !== value) onRecord(next);
  };

  return (
    <Group gap={6} wrap="nowrap">
      <ActionIcon variant="default" aria-label={`Decrease ${name}`} onClick={() => step(-1)}>
        −
      </ActionIcon>
      <NumberInput
        className={classes.number}
        aria-label={name}
        hideControls
        value={draft}
        onChange={setDraft}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        min={constraints.min}
        max={constraints.max}
        decimalScale={constraints.precision}
        placeholder="—"
      />
      <ActionIcon variant="default" aria-label={`Increase ${name}`} onClick={() => step(1)}>
        +
      </ActionIcon>
      {constraints.unit && (
        <Text size="sm" c="dimmed">
          {constraints.unit}
        </Text>
      )}
    </Group>
  );
}
