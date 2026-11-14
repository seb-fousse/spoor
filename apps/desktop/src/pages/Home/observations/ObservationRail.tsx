import { useDayObservations, useRecordObservation } from "@data/observations";
import { Chip, Group, NumberInput, SegmentedControl, Text } from "@mantine/core";
import { type LocalDate, type MetricDay, optionLabel, type Value } from "@spoor/core";
import { type ReactNode, useEffect, useState } from "react";
import { RailPanel } from "../rail/RailPanel";
import classes from "./ObservationRail.module.css";
import {
  atMaximum,
  countRecorded,
  meetsMinimum,
  type NumberConstraints,
  normalizeNumber,
  stepNumber,
  toggleOption,
} from "./observationValues";

interface ObservationRailProps {
  /** The day the cards show and record on. */
  day: LocalDate;
}

/**
 * The rail's observations: a card per active metric for `day`, with a control
 * that fits the metric's type. One click (or, for a typed number, Enter or
 * leaving the field) records the value; recording again revises it.
 */
export function ObservationRail({ day }: ObservationRailProps) {
  // The previous day's cards stay until the new ones load (`shown.day` is then
  // the previous day), shown but not usable. Most loads finish within a frame,
  // so the stale styling only shows after a delay (see RailPanel's CSS), and
  // nothing else changes until the new day arrives.
  const observations = useDayObservations(day);
  const shown = observations.data;
  const items = shown?.items ?? [];
  const { recorded, total } = countRecorded(items);

  const record = useRecordObservation();
  // A failed save, until the next one. It shows only on the day it was for, so
  // it doesn't follow the user around, and there ahead of a failed load.
  const saveError = record.variables?.date === day ? record.error : null;

  return (
    <RailPanel
      title="Observations"
      count={shown !== undefined && items.length > 0 ? `${recorded}/${total} recorded` : undefined}
      read={{
        status: observations.status,
        error: saveError ?? observations.error,
        isPlaceholderData: observations.isPlaceholderData,
      }}
      errorTitle="Could not save or load observations"
      empty={
        shown !== undefined &&
        items.length === 0 && (
          <Text c="dimmed">
            No metrics yet. Add one on the Observations page to record it here.
          </Text>
        )
      }
      listClassName={classes.cards}
    >
      {items.map((item) => (
        <ObservationCard
          // Per metric, not per day: the cards stay mounted across days, so
          // their controls update in place instead of being rebuilt.
          key={item.metric.id}
          day={shown?.day ?? null}
          item={item}
          onRecord={async (value) => {
            await record.mutateAsync({ metricId: item.metric.id, date: day, value });
          }}
        />
      ))}
    </RailPanel>
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

/**
 * A number field with Mantine's chevrons. A chevron click (or ↑/↓ in the
 * field) records a step at once; a typed value records on Enter or blur.
 */
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
  // From what the field shows, so a typed but unsaved value is stepped from too.
  const step = (by: number) => {
    const next = stepNumber(typeof draft === "number" ? draft : value, by, constraints);
    setDraft(next);
    if (next !== value) onRecord(next);
  };

  return (
    <NumberInput
      // xs is 30px tall, the height of the segmented controls in the other cards.
      size="xs"
      className={classes.number}
      aria-label={name}
      value={draft}
      onChange={setDraft}
      // Mantine reports its own steps with a source of "increment" or
      // "decrement", which react-number-format's types don't list. Mantine has
      // already applied its step to the field; `step` replaces it with ours,
      // which starts an empty day from 0 and rounds to the metric's precision.
      onValueChange={(_, info) => {
        const source = String(info.source);
        if (source === "increment") step(1);
        else if (source === "decrement") step(-1);
      }}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
      min={constraints.min}
      max={constraints.max}
      decimalScale={constraints.precision}
      suffix={constraints.unit ? ` ${constraints.unit}` : undefined}
      placeholder={constraints.unit ? `— ${constraints.unit}` : "—"}
    />
  );
}
