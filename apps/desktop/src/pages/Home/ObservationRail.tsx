import {
  ActionIcon,
  Alert,
  Chip,
  Group,
  Loader,
  NumberInput,
  SegmentedControl,
  Text,
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
  // Most loads finish within a frame, so the stale styling only shows after a
  // delay (see the CSS), and nothing else changes until the new day arrives.
  const stale = data.day !== day;

  return (
    <section className={classes.rail} aria-labelledby="observations-title">
      <header className={classes.header}>
        <h2 id="observations-title" className={classes.title}>
          Observations
        </h2>
        {data.day !== null && data.items.length > 0 && (
          <span className={classes.count} aria-live="polite">
            {recorded}/{total} recorded
          </span>
        )}
      </header>

      <div className={classes.body}>
        {data.error !== null && (
          <Alert color="red" title="Could not save or load observations">
            {data.error}
          </Alert>
        )}
        {data.day === null && data.error === null && <Loader size="sm" />}
        {data.day !== null && data.items.length === 0 && (
          <Text c="dimmed">
            No metrics yet. Add one on the Observations page to record it here.
          </Text>
        )}
        <div className={classes.cards} inert={stale} data-stale={stale || undefined}>
          {data.items.map((item) => (
            <ObservationCard
              // Per metric, not per day: the cards stay mounted across days, so
              // their controls update in place instead of being rebuilt.
              key={item.metric.id}
              day={data.day}
              item={item}
              onRecord={(value) => data.record(item.metric.id, value)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ObservationCard({
  day,
  item: { metric, observation },
  onRecord,
}: {
  /** The day `item` belongs to. */
  day: LocalDate | null;
  item: MetricDay;
  onRecord: (value: Value) => Promise<void>;
}) {
  // What the card shows instead of the stored value: a click not yet saved, or
  // a selection with fewer options than the metric needs. Dropped if saving
  // fails. Tagged with its day, so it never shows on another day's card.
  const [local, setLocal] = useState<{ day: LocalDate | null; value: Value } | null>(null);
  const value = (local?.day === day ? local.value : null) ?? observation?.value ?? null;
  const save = (next: Value) => {
    setLocal({ day, value: next });
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
                  else setLocal({ day, value: next });
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
          day={day}
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
  day,
  name,
  value,
  constraints,
  onRecord,
}: {
  day: LocalDate | null;
  name: string;
  value: number | null;
  constraints: NumberConstraints;
  onRecord: (value: number) => void;
}) {
  const [draft, setDraft] = useState<number | string>(value ?? "");
  // A new day resets the field even when its value is the same as the last day's.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `day` is the signal to reset.
  useEffect(() => setDraft(value ?? ""), [value, day]);
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
