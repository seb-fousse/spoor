import { EntryForm, type EntryTimeInput, useFields } from "@components/LogEntryForm";
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
import {
  createLogEntry,
  type Database,
  type LocalDate,
  type LogEntry,
  type LogType,
  listLogTypes,
  type NewLogEntry,
  type Value,
} from "@spoor/core";
import { useEffect, useState } from "react";
import { formatDay } from "./homeDays";
import { childTypes, topLevelTypes } from "./logForm";
import classes from "./NewLogModal.module.css";

interface NewLogModalProps {
  db: Database;
  opened: boolean;
  /** The active day, which the new entry is on. */
  day: LocalDate;
  onClose: () => void;
  /** Called after each entry is stored, so the list can reload. */
  onCreated: () => void;
}

/**
 * A modal card to create a log entry for the active day. It first offers a card
 * per log type; choosing one shows that type's form, with a back button in the
 * header to choose again. A type with child types then stays open to add them.
 */
export function NewLogModal({ db, opened, day, onClose, onCreated }: NewLogModalProps) {
  const [types, setTypes] = useState<LogType[] | null>(null);
  const [typeId, setTypeId] = useState<string | null>(null);
  const [created, setCreated] = useState<LogEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!opened) return;
    listLogTypes(db)
      .then(setTypes)
      .catch((e: Error) => setError(e.message));
  }, [db, opened]);

  const choices = topLevelTypes(types ?? []);
  const type = types?.find((t) => t.id === typeId) ?? null;
  const children = type ? childTypes(types ?? [], type.id) : [];
  // Going back would orphan the entry just created, so only the form step has it.
  const canGoBack = type !== null && created === null;

  const create = async (input: NewLogEntry) => {
    try {
      const entry = await createLogEntry(db, input);
      setError(null);
      onCreated();
      return entry;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  };

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
            setError(null);
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
        setError(null);
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
          <TypeForm key={type.id} db={db} type={type} day={day} onCreate={createTopLevel} />
        )}

        {type && created !== null && (
          <Stack gap="md">
            <Text size="sm" c="dimmed">
              Added. Add {children.map((t) => t.name).join(", ")} to it, or finish.
            </Text>
            {children.map((child) => (
              <ChildForm
                key={child.id}
                db={db}
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
  db,
  type,
  day,
  onCreate,
}: {
  db: Database;
  type: LogType;
  day: LocalDate;
  onCreate: (time: EntryTimeInput, values: Record<string, Value>) => void;
}) {
  const fields = useFields(db, type.id, 0);
  return (
    <EntryForm
      db={db}
      fields={fields}
      child={false}
      layout="stacked"
      day={day}
      onCreate={onCreate}
    />
  );
}

function ChildForm({
  db,
  type,
  onCreate,
}: {
  db: Database;
  type: LogType;
  onCreate: (values: Record<string, Value>) => Promise<unknown>;
}) {
  const fields = useFields(db, type.id, 0);
  const [added, setAdded] = useState(0);
  return (
    <Stack gap="xs">
      <Text fw={500}>
        {type.name}
        {added > 0 && ` (${added} added)`}
      </Text>
      <EntryForm
        db={db}
        fields={fields}
        child
        layout="stacked"
        onCreate={(_, values) => onCreate(values).then((entry) => entry && setAdded((n) => n + 1))}
      />
    </Stack>
  );
}
