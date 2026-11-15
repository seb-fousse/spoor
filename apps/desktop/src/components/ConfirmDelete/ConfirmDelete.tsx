import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { useState } from "react";

type Run = (action: () => Promise<unknown>) => void;

interface Pending {
  what: string;
  also: string[];
  remove: () => Promise<unknown>;
}

/**
 * Deleting is permanent and takes dependent records with it, so every delete
 * asks first, saying what else it does. `ask(what, remove, also)` reads `also`
 * (built from core's `preview*Deletion` counts) through `run`, so a failure
 * shows like any other, then opens the dialog; `remove` runs on confirm.
 * Render the returned dialog anywhere in the screen. Enter confirms, Esc cancels.
 */
export function useConfirmDelete(run: Run) {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = (
    what: string,
    remove: () => Promise<unknown>,
    also: () => Promise<(string | false)[]> = async () => [],
  ) =>
    run(async () => {
      const effects = (await also()).filter((s): s is string => s !== false);
      setPending({ what, also: effects, remove });
    });

  const confirm = () => {
    if (!pending) return;
    setPending(null);
    run(pending.remove);
  };

  const dialog = (
    <Modal
      opened={pending !== null}
      onClose={() => setPending(null)}
      title={pending && `Delete ${pending.what}?`}
    >
      <Stack gap="sm">
        {pending && pending.also.length > 0 && (
          <Text size="sm">This also {LIST.format(pending.also)}.</Text>
        )}
        <Text size="sm">This cannot be undone.</Text>
        <Group justify="flex-end" gap="xs">
          <Button size="xs" variant="default" onClick={() => setPending(null)}>
            Cancel
          </Button>
          {/* Focused first, so Enter confirms; Esc cancels. */}
          <Button size="xs" color="red" onClick={confirm} data-autofocus>
            Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );

  return [ask, dialog] as const;
}

const LIST = new Intl.ListFormat("en", { type: "conjunction" });

/** `"deletes 3 entries"`, or `false` for none, so `ask` leaves it out. */
export function effect(verb: string, n: number, noun: string, plural = `${noun}s`) {
  return n > 0 && `${verb} ${n} ${n === 1 ? noun : plural}`;
}
