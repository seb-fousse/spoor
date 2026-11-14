import { effect, useConfirmDelete } from "@components/ConfirmDelete";
import {
  FieldList,
  type NewFieldDraft,
  NewFieldInputs,
  newFieldDraft,
  toNewField,
} from "@components/FieldList";
import { describeValues, EntryForm, formatTime } from "@components/LogEntryForm";
import {
  useAddLogField,
  useChildEntries,
  useCreateLogEntry,
  useCreateLogType,
  useDeleteLogEntry,
  useDeleteLogField,
  useDeleteLogType,
  useFields,
  useLogEntries,
  useLogTypes,
  useMoveChildEntry,
  useReorderLogFields,
  useSetLogTypeArchived,
  useUpdateLogField,
} from "@data/logs";
import { useRefTitles, useThingTypes } from "@data/things";
import { Alert, Button, Group, Select, Stack, Text, TextInput, Title } from "@mantine/core";
import { useDatabase } from "@platform/DatabaseProvider";
import {
  type LogEntry,
  type LogType,
  type NewLogField,
  previewLogEntryDeletion,
  previewLogFieldDeletion,
  previewLogTypeDeletion,
} from "@spoor/core";
import { type FormEvent, useState } from "react";

/**
 * Proof-of-concept Logs screen: log types and their fields, entries with a
 * value of every field type, and child entries, built from plain Mantine
 * components. Its only job is to show the slice works end to end over IPC;
 * the real UI replaces it.
 */

type Run = (action: () => Promise<unknown>) => void;

export function Logs() {
  const db = useDatabase();
  const typesQuery = useLogTypes();
  const types = typesQuery.data ?? [];
  const createType = useCreateLogType();
  const setTypeArchived = useSetLogTypeArchived();
  const deleteType = useDeleteLogType();
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
      () => deleteType.mutateAsync(type.id),
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
        types={types}
        onCreate={(name, parentTypeId, fields) =>
          run(() => createType.mutateAsync({ name, parentTypeId, fields }))
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
                run(() =>
                  setTypeArchived.mutateAsync({ id: t.id, archived: t.archivedAt === null }),
                )
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

      {selected && <LogTypeDetail type={selected} types={types} run={run} />}
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Types and fields

function LogTypeForm({
  types,
  onCreate,
}: {
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
        <FieldsEditor rows={rows} setRows={setRows} />
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
  rows,
  setRows,
}: {
  rows: NewFieldDraft[];
  setRows: (rows: NewFieldDraft[]) => void;
}) {
  const thingTypes = useThingTypes();
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

function LogTypeDetail({ type, types, run }: { type: LogType; types: LogType[]; run: Run }) {
  const db = useDatabase();
  const fields = useFields(type.id);
  const thingTypes = useThingTypes();
  const entries = useLogEntries(type.id).data ?? [];
  const addField = useAddLogField(type.id);
  const updateField = useUpdateLogField();
  const reorderFields = useReorderLogFields(type.id);
  const deleteField = useDeleteLogField();
  const createEntry = useCreateLogEntry();
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
        onAdd={(field) => run(() => addField.mutateAsync(field))}
        onUpdate={(fieldId, patch) => run(() => updateField.mutateAsync({ fieldId, patch }))}
        onReorder={(ids) => run(() => reorderFields.mutateAsync(ids))}
        onDelete={(field) =>
          confirmDelete(
            `the ${field.name} field`,
            () => deleteField.mutateAsync(field.id),
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
            fields={fields}
            child={false}
            onCreate={(time, values) =>
              run(() => createEntry.mutateAsync({ logTypeId: type.id, ...time, values }))
            }
          />
        )
      )}
      <Stack gap={4}>
        {entries.map((entry) => (
          <EntryItem key={entry.id} entry={entry} types={types} run={run} />
        ))}
      </Stack>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Entries

function EntryItem({
  entry,
  types,
  place,
  run,
}: {
  entry: LogEntry;
  types: LogType[];
  /** A child entry's place among its siblings, 1 first. */
  place?: { index: number; count: number };
  run: Run;
}) {
  const db = useDatabase();
  const fields = useFields(entry.logTypeId);
  const titles = useRefTitles(fields, entry);
  const children = useChildEntries(entry.id).data ?? [];
  const moveEntry = useMoveChildEntry();
  const deleteEntry = useDeleteLogEntry();
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
                run(() => moveEntry.mutateAsync({ id: entry.id, position: place.index - 1 }))
              }
            >
              ↑
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={place.index === place.count}
              onClick={() =>
                run(() => moveEntry.mutateAsync({ id: entry.id, position: place.index + 1 }))
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
              () => deleteEntry.mutateAsync(entry.id),
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
              entry={child}
              types={types}
              place={{ index: i + 1, count: children.length }}
              run={run}
            />
          ))}
          {childTypes
            .filter((t) => t.archivedAt === null)
            .map((t) => (
              <ChildEntryForm key={t.id} type={t} parentEntryId={entry.id} run={run} />
            ))}
        </Stack>
      )}
    </Stack>
  );
}

function ChildEntryForm({
  type,
  parentEntryId,
  run,
}: {
  type: LogType;
  parentEntryId: string;
  run: Run;
}) {
  const fields = useFields(type.id);
  const createEntry = useCreateLogEntry();
  return (
    <Group gap="xs" align="flex-end">
      <Text size="sm">{type.name}:</Text>
      <EntryForm
        fields={fields}
        child
        onCreate={(_, values) =>
          run(() => createEntry.mutateAsync({ logTypeId: type.id, parentEntryId, values }))
        }
      />
    </Group>
  );
}
