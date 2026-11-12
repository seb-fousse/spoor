import { effect, useConfirmDelete } from "@components/ConfirmDelete";
import {
  FieldList,
  type NewFieldDraft,
  NewFieldInputs,
  newFieldDraft,
  toNewField,
} from "@components/FieldList";
import {
  describeValues,
  EntryForm,
  formatTime,
  useFields,
  useRefTitles,
  useThingTypes,
} from "@components/LogEntryForm";
import { Alert, Button, Group, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import {
  type Database,
  type LogEntry,
  type LogType,
  type NewLogField,
  previewLogEntryDeletion,
  previewLogFieldDeletion,
  previewLogTypeDeletion,
} from "@spoor/core";
import { type FormEvent, useState } from "react";
import {
  useChildEntries,
  useLogEntries,
  useLogEntryWrites,
  useLogFieldWrites,
  useLogTypes,
  useLogTypeWrites,
} from "./useLogsData";

/**
 * Proof-of-concept Logs screen: log types and their fields, entries with a
 * value of every field type, and child entries, built from plain Mantine
 * components. Its only job is to show the slice works end to end over IPC;
 * the real UI replaces it.
 */

type Run = (action: () => Promise<unknown>) => void;

export function Logs({ db }: { db: Database }) {
  const typesQuery = useLogTypes(db);
  const types = typesQuery.data ?? [];
  const typeWrites = useLogTypeWrites(db);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const error = writeError ?? typesQuery.error?.message ?? null;

  // Runs a write and shows any error. The write's mutation invalidates the
  // queries it changes, which reloads them here and on Home.
  const run: Run = (action) => {
    setWriteError(null);
    action().catch((e: Error) => setWriteError(e.message));
  };

  const [confirmDelete, deleteDialog] = useConfirmDelete(run);

  const selected = types.find((t) => t.id === selectedId);
  const nameOf = (id: string | null) => types.find((t) => t.id === id)?.name ?? "?";

  const askDelete = (type: LogType) =>
    confirmDelete(
      `the ${type.name} log type`,
      () => typeWrites.remove(type.id),
      async () => {
        const n = await previewLogTypeDeletion(db, type.id);
        return [
          effect("deletes", n.types - 1, "child type"),
          effect("deletes", n.entries, "entry", "entries"),
        ];
      },
    );

  return (
    <Stack component="section" gap="sm">
      <Title order={2}>Logs</Title>
      {error && <Alert color="red">{error}</Alert>}
      {deleteDialog}

      <LogTypeForm
        db={db}
        types={types}
        onCreate={(name, parentTypeId, fields) =>
          run(() => typeWrites.create({ name, parentTypeId, fields }))
        }
      />
      <Stack gap={4}>
        {types.map((t) => (
          <Group key={t.id} gap="xs">
            <Button
              size="xs"
              variant={t.id === selectedId ? "light" : "subtle"}
              onClick={() => setSelectedId(t.id)}
            >
              {t.name}
            </Button>
            <Text size="sm" c="dimmed">
              {[
                t.parentTypeId !== null && `inside ${nameOf(t.parentTypeId)}`,
                t.archivedAt !== null && "archived",
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            <Button
              size="xs"
              variant="default"
              onClick={() =>
                run(() => typeWrites.setArchived({ id: t.id, archived: t.archivedAt === null }))
              }
            >
              {t.archivedAt === null ? "Archive" : "Unarchive"}
            </Button>
            <Button size="xs" variant="light" color="red" onClick={() => askDelete(t)}>
              Delete
            </Button>
          </Group>
        ))}
      </Stack>

      {selected && <LogTypeDetail db={db} type={selected} types={types} run={run} />}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Types and fields

function LogTypeForm({
  db,
  types,
  onCreate,
}: {
  db: Database;
  types: LogType[];
  onCreate: (name: string, parentTypeId: string | null, fields: NewLogField[]) => void;
}) {
  const [name, setName] = useState("");
  const [parentTypeId, setParentTypeId] = useState("");
  const [rows, setRows] = useState<NewFieldDraft[]>([]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCreate(name, parentTypeId || null, rows.map(toNewField));
    setName("");
    setRows([]);
  };
  return (
    <form onSubmit={submit}>
      <Stack gap="xs">
        <Group gap="xs" align="flex-end">
          <TextInput
            size="xs"
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
            placeholder="New log type"
            aria-label="New log type"
          />
          <Select
            size="xs"
            aria-label="Parent type"
            allowDeselect={false}
            value={parentTypeId}
            onChange={(v) => setParentTypeId(v ?? "")}
            data={[
              { value: "", label: "Top level" },
              ...types.map((t) => ({ value: t.id, label: `Inside ${t.name}` })),
            ]}
          />
        </Group>
        <FieldsEditor db={db} rows={rows} setRows={setRows} />
        <Group gap="xs">
          <Button type="submit" size="xs">
            Add type
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** The fields of a type being created, each removable before it is saved. */
function FieldsEditor({
  db,
  rows,
  setRows,
}: {
  db: Database;
  rows: NewFieldDraft[];
  setRows: (rows: NewFieldDraft[]) => void;
}) {
  const thingTypes = useThingTypes(db);
  return (
    <Stack gap={4}>
      {rows.map((row, i) => (
        // New rows have no id yet; the inputs are controlled, so an index key is safe.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above.
        <Group key={i} gap="xs" align="flex-end">
          <NewFieldInputs
            field={row}
            thingTypes={thingTypes}
            onChange={(next) => setRows(rows.map((r, j) => (j === i ? next : r)))}
          />
          <Button
            size="xs"
            variant="default"
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
          >
            Remove
          </Button>
        </Group>
      ))}
      <Group gap="xs">
        <Button size="xs" variant="default" onClick={() => setRows([...rows, newFieldDraft()])}>
          Add field
        </Button>
      </Group>
    </Stack>
  );
}

function LogTypeDetail({
  db,
  type,
  types,
  run,
}: {
  db: Database;
  type: LogType;
  types: LogType[];
  run: Run;
}) {
  const fields = useFields(db, type.id);
  const thingTypes = useThingTypes(db);
  const entries = useLogEntries(db, type.id).data ?? [];
  const fieldWrites = useLogFieldWrites(db, type.id);
  const entryWrites = useLogEntryWrites(db);
  const [confirmDelete, deleteDialog] = useConfirmDelete(run);

  const parent = types.find((t) => t.id === type.parentTypeId);

  return (
    <Stack gap="sm">
      <Title order={3}>{type.name}</Title>
      {deleteDialog}

      <Title order={4}>Fields</Title>
      <FieldList
        fields={fields}
        thingTypes={thingTypes}
        onAdd={(field) => run(() => fieldWrites.add(field))}
        onUpdate={(fieldId, patch) => run(() => fieldWrites.update({ fieldId, patch }))}
        onReorder={(ids) => run(() => fieldWrites.reorder(ids))}
        onDelete={(field) =>
          confirmDelete(
            `the ${field.name} field`,
            () => fieldWrites.remove(field.id),
            async () => [
              effect(
                "removes its value from",
                (await previewLogFieldDeletion(db, field.id)).values,
                "entry",
                "entries",
              ),
            ],
          )
        }
      />

      <Title order={4}>Entries</Title>
      {parent ? (
        <Text size="sm" c="dimmed">
          Entries of this type are added inside a {parent.name} entry.
        </Text>
      ) : (
        type.archivedAt === null && (
          <EntryForm
            db={db}
            fields={fields}
            child={false}
            onCreate={(time, values) =>
              run(() => entryWrites.create({ logTypeId: type.id, ...time, values }))
            }
          />
        )
      )}
      <Stack gap={4}>
        {entries.map((entry) => (
          <EntryItem key={entry.id} db={db} entry={entry} types={types} run={run} />
        ))}
      </Stack>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Entries

function EntryItem({
  db,
  entry,
  types,
  place,
  run,
}: {
  db: Database;
  entry: LogEntry;
  types: LogType[];
  /** A child entry's place among its siblings, 1 first. */
  place?: { index: number; count: number };
  run: Run;
}) {
  const fields = useFields(db, entry.logTypeId);
  const titles = useRefTitles(db, fields, entry);
  const children = useChildEntries(db, entry.id).data ?? [];
  const entryWrites = useLogEntryWrites(db);
  const childTypes = types.filter((t) => t.parentTypeId === entry.logTypeId);
  const [confirmDelete, deleteDialog] = useConfirmDelete(run);

  return (
    <Stack gap={4}>
      <Group gap="xs">
        <Text size="sm">
          {place && `#${place.index} `}
          {formatTime(entry)}
        </Text>
        <Text size="sm" c="dimmed">
          ({entry.resolved.timeZone}, day {entry.day ?? "none"})
        </Text>
        <Text size="sm">{describeValues(fields, entry, titles)}</Text>
        {place && (
          <>
            <Button
              size="xs"
              variant="default"
              disabled={place.index === 1}
              onClick={() =>
                run(() => entryWrites.move({ id: entry.id, position: place.index - 1 }))
              }
            >
              ↑
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={place.index === place.count}
              onClick={() =>
                run(() => entryWrites.move({ id: entry.id, position: place.index + 1 }))
              }
            >
              ↓
            </Button>
          </>
        )}
        <Button
          size="xs"
          variant="light"
          color="red"
          onClick={() =>
            confirmDelete(
              `the entry of ${formatTime(entry)}`,
              () => entryWrites.remove(entry.id),
              async () => [
                effect(
                  "deletes",
                  (await previewLogEntryDeletion(db, entry.id)).childEntries,
                  "child entry",
                  "child entries",
                ),
              ],
            )
          }
        >
          Delete
        </Button>
      </Group>
      {deleteDialog}
      {(children.length > 0 || childTypes.length > 0) && (
        <Stack gap={4} pl="md">
          {children.map((child, i) => (
            <EntryItem
              key={child.id}
              db={db}
              entry={child}
              types={types}
              place={{ index: i + 1, count: children.length }}
              run={run}
            />
          ))}
          {childTypes
            .filter((t) => t.archivedAt === null)
            .map((t) => (
              <ChildEntryForm key={t.id} db={db} type={t} parentEntryId={entry.id} run={run} />
            ))}
        </Stack>
      )}
    </Stack>
  );
}

function ChildEntryForm({
  db,
  type,
  parentEntryId,
  run,
}: {
  db: Database;
  type: LogType;
  parentEntryId: string;
  run: Run;
}) {
  const fields = useFields(db, type.id);
  const entryWrites = useLogEntryWrites(db);
  return (
    <Group gap="xs" align="flex-end">
      <Text size="sm">{type.name}:</Text>
      <EntryForm
        db={db}
        fields={fields}
        child
        onCreate={(_, values) =>
          run(() => entryWrites.create({ logTypeId: type.id, parentEntryId, values }))
        }
      />
    </Group>
  );
}
