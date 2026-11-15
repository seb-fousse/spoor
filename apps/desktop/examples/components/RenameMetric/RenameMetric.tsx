/**
 * Example: a shared component in its own folder, and how it shows errors.
 * Illustrates docs/conventions/components.md and docs/conventions/errors.md.
 *
 * The folder holds the component, its CSS module, its test and an index.ts barrel,
 * as src/components/<Name>/ does. It reads and writes only through data hooks; in
 * the app those come from @data/<domain>, here from the example domain file.
 */
import { ErrorAlert } from "@components/ErrorAlert";
import { Button, Group, Loader, TextInput } from "@mantine/core";
import { useState } from "react";
import { useMetricList, useRenameMetric } from "../../data/metrics";
import classes from "./RenameMetric.module.css";

interface RenameMetricProps {
  metricId: string;
  /** Called once the new name is saved, or when the user cancels. */
  onDone: () => void;
}

/** A form to rename a metric. */
export function RenameMetric({ metricId, onDone }: RenameMetricProps) {
  const list = useMetricList();
  const rename = useRenameMetric();
  // What the user typed, or null to show the stored name.
  const [typed, setTyped] = useState<string | null>(null);

  // A failed read: ErrorAlert, titled with what was being done. It words the error
  // from its code and logs it in full when the user can't have caused it.
  if (list.status === "error") {
    return <ErrorAlert title="Could not load metrics" error={list.error} />;
  }
  if (list.status === "pending") return <Loader size="sm" />;
  const metric = list.data.find((m) => m.id === metricId);
  // Deleted meanwhile: there is nothing left to rename.
  if (!metric) return null;

  const name = typed ?? metric.name;
  // A failed save resolves to nothing here: the mutation's `error` shows it.
  const save = () => rename.mutateAsync({ id: metricId, name }).then(onDone, () => {});

  return (
    <form
      className={classes.root}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      {/* Shown until the next attempt, which clears it, or until the user cancels. */}
      {rename.error && <ErrorAlert error={rename.error} />}
      <TextInput label="Name" value={name} onChange={(e) => setTyped(e.currentTarget.value)} />
      <Group justify="flex-end" gap="xs">
        <Button
          variant="default"
          onClick={() => {
            rename.reset();
            onDone();
          }}
        >
          Cancel
        </Button>
        <Button type="submit" loading={rename.isPending}>
          Save
        </Button>
      </Group>
    </form>
  );
}
