import { EntryForm, type EntryTimeInput } from "@components/LogEntryForm";
import { useFields } from "@data/logs";
import { queryKeys } from "@data/queryKeys";
import { formatDay } from "@lib/format";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  Stack,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useDatabase } from "@platform/DatabaseProvider";
import {
  createLogEntry,
  type LocalDate,
  type LogEntry,
  type LogType,
  listLogTypes,
  type NewLogEntry,
  type Value,
} from "@spoor/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import classes from "./NewLogModal.module.css";

interface NewLogModalProps {
  opened: boolean;
  /** The active day, which the new entry is on. */
  day: LocalDate;
  onClose: () => void;
}

/**
 * A modal card to create a log entry for the active day. It first offers a card
 * per log type; choosing one shows that type's form, with a back button in the
 * header to choose again. A type with child types then stays open to add them.
 */
export function NewLogModal({ opened, day, onClose }: NewLogModalProps) {
  const db = useDatabase();
  const queryClient = useQueryClient();
  const [typeId, setTypeId] = useState<string | null>(null);
  const [created, setCreated] = useState<LogEntry | null>(null);

  // Loaded the first time the modal opens, then cached; the Logs page's type writes invalidate it.
  const typesQuery = useQuery({
    queryKey: queryKeys.logTypes.list,
    queryFn: () => listLogTypes(db),
    enabled: opened,
  });
  const types = typesQuery.data ?? null;

  // Each stored entry invalidates the day lists, so the rail shows it.
  const createEntry = useMutation({
    mutationFn: (input: NewLogEntry) => createLogEntry(db, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.logs.all }),
  });
  // The last save's error, cleared by the next save or by going back.
  const error = createEntry.error?.message ?? typesQuery.error?.message ?? null;

  // Live types only. Top-level ones get a card; a chosen type's children are added inside its entry.
  const live = (types ?? []).filter((t) => t.archivedAt === null);
  const choices = live.filter((t) => t.parentTypeId === null);
  const type = types?.find((t) => t.id === typeId) ?? null;
  const children = type ? live.filter((t) => t.parentTypeId === type.id) : [];
  // Going back would orphan the entry just created, so only the form step has it.
  const canGoBack = type !== null && created === null;

  // The entry, or null if saving failed (the mutation's error shows it).
  const create = (input: NewLogEntry) => createEntry.mutateAsync(input).catch(() => null);

  const createTopLevel = async (time: EntryTimeInput, values: Record<string, Value>) => {
    if (!type) return;
    const entry = await create({ logTypeId: type.id, ...time, values });
    if (!entry) return;
    // A type with child types stays open, to add them to the new entry.
    if (children.length === 0) onClose();
    else setCreated(entry);
  };

  const title = (
    <span className={classes.title}>
      {canGoBack && (
        <ActionIcon
          className={classes.back}
          aria-label="Back to log types"
          onClick={() => {
            setTypeId(null);
            createEntry.reset();
          }}
        >
          ‹
        </ActionIcon>
      )}
      <span>
        {type ? type.name : "New log"} · {formatDay(day)}
      </span>
    </span>
  );

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      // Closing discards everything typed: start from the cards again next time.
      onExitTransitionEnd={() => {
        setTypeId(null);
        setCreated(null);
        createEntry.reset();
      }}
    >
      <Stack gap="md">
        {error && <Alert color="red">{error}</Alert>}

        {types !== null && choices.length === 0 && (
          <Text c="dimmed">No log types yet. Add one on the Logs page.</Text>
        )}

        {type === null && choices.length > 0 && (
          <div className={classes.cards}>
            {choices.map((t) => (
              <UnstyledButton
                key={t.id}
                className={classes.card}
                onClick={() => setTypeId(t.id)}
                data-autofocus={t === choices[0] || undefined}
              >
                <span className={classes.cardName}>{t.name}</span>
                {t.description && <span className={classes.cardText}>{t.description}</span>}
              </UnstyledButton>
            ))}
          </div>
        )}

        {type && created === null && (
          <TypeForm key={type.id} type={type} day={day} onCreate={createTopLevel} />
        )}

        {type && created !== null && (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Added. Add {children.map((t) => t.name).join(", ")} to it, or finish.
            </Text>
            {children.map((child) => (
              <ChildForm
                key={child.id}
                type={child}
                onCreate={(values) =>
                  create({ logTypeId: child.id, parentEntryId: created.id, values })
                }
              />
            ))}
            <Group justify="flex-end">
              <Button variant="default" onClick={onClose}>
                Done
              </Button>
            </Group>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}

function TypeForm({
  type,
  day,
  onCreate,
}: {
  type: LogType;
  day: LocalDate;
  onCreate: (time: EntryTimeInput, values: Record<string, Value>) => void;
}) {
  const fields = useFields(type.id);
  return <EntryForm fields={fields} child={false} layout="stacked" day={day} onCreate={onCreate} />;
}

function ChildForm({
  type,
  onCreate,
}: {
  type: LogType;
  onCreate: (values: Record<string, Value>) => Promise<unknown>;
}) {
  const fields = useFields(type.id);
  const [added, setAdded] = useState(0);
  return (
    <Stack gap="xs">
      <Text fw={500}>
        {type.name}
        {added > 0 && ` (${added} added)`}
      </Text>
      <EntryForm
        fields={fields}
        child
        layout="stacked"
        onCreate={(_, values) => onCreate(values).then((entry) => entry && setAdded((n) => n + 1))}
      />
    </Stack>
  );
}
