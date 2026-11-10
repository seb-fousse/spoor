import { effect, useConfirmDelete } from "@components/ConfirmDelete";
import {
  FieldList,
  type NewFieldDraft,
  NewFieldInputs,
  newFieldDraft,
  toNewField,
} from "@components/FieldList";
import {
  Alert,
  Button,
  Group,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { DatePickerInput, DateTimePicker } from "@mantine/dates";
import {
  addLogField,
  createLogEntry,
  createLogType,
  type Database,
  deleteLogEntry,
  deleteLogField,
  deleteLogType,
  getLogTypeFields,
  getThingTitle,
  type LogEntry,
  type LogField,
  type LogType,
  listChildEntries,
  listLogEntries,
  listLogTypes,
  listThings,
  listThingTypes,
  moveChildEntry,
  type NewLogField,
  optionLabel,
  PRECISIONS,
  type Precision,
  previewLogEntryDeletion,
  previewLogFieldDeletion,
  previewLogTypeDeletion,
  reorderLogFields,
  setLogTypeArchived,
  type ThingType,
  updateLogField,
  type Value,
} from "@spoor/core";
import dayjs from "dayjs";
import { type FormEvent, useEffect, useState } from "react";

/**
 * Proof-of-concept Logs screen: log types and their fields, entries with a
 * value of every field type, and child entries, built from plain Mantine
 * components. Its only job is to show the slice works end to end over IPC;
 * the real UI replaces it.
 */

type Run = (action: () => Promise<unknown>) => void;

export function Logs({ db }: { db: Database }) {
  const [types, setTypes] = useState<LogType[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // Runs a write, shows any error, and reloads everything.
  const run: Run = (action) => {
    setError(null);
    action()
      .catch((e: Error) => setError(e.message))
      .finally(() => setVersion((v) => v + 1));
  };

  const [confirmDelete, deleteDialog] = useConfirmDelete(run);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` triggers the reload.
  useEffect(() => {
    listLogTypes(db)
      .then(setTypes)
      .catch((e: Error) => setError(e.message));
  }, [db, version]);

  const selected = types.find((t) => t.id === selectedId);
  const nameOf = (id: string | null) => types.find((t) => t.id === id)?.name ?? "?";

  const askDelete = (type: LogType) =>
    confirmDelete(
      `the ${type.name} log type`,
      () => deleteLogType(db, type.id),
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
          run(() => createLogType(db, { name, parentTypeId, fields }))
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
              onClick={() => run(() => setLogTypeArchived(db, t.id, t.archivedAt === null))}
            >
              {t.archivedAt === null ? "Archive" : "Unarchive"}
            </Button>
            <Button size="xs" variant="light" color="red" onClick={() => askDelete(t)}>
              Delete
            </Button>
          </Group>
        ))}
      </Stack>

      {selected && (
        <LogTypeDetail db={db} type={selected} types={types} version={version} run={run} />
      )}
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
  version,
  run,
}: {
  db: Database;
  type: LogType;
  types: LogType[];
  version: number;
  run: Run;
}) {
  const fields = useFields(db, type.id, version);
  const thingTypes = useThingTypes(db);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [confirmDelete, deleteDialog] = useConfirmDelete(run);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` triggers the reload.
  useEffect(() => {
    listLogEntries(db, type.id).then(setEntries);
  }, [db, type.id, version]);

  const parent = types.find((t) => t.id === type.parentTypeId);

  return (
    <Stack gap="sm">
      <Title order={3}>{type.name}</Title>
      {deleteDialog}

      <Title order={4}>Fields</Title>
      <FieldList
        fields={fields}
        thingTypes={thingTypes}
        onAdd={(field) => run(() => addLogField(db, type.id, field))}
        onUpdate={(fieldId, patch) => run(() => updateLogField(db, fieldId, patch))}
        onReorder={(ids) => run(() => reorderLogFields(db, type.id, ids))}
        onDelete={(field) =>
          confirmDelete(
            `the ${field.name} field`,
            () => deleteLogField(db, field.id),
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
              run(() => createLogEntry(db, { logTypeId: type.id, ...time, values }))
            }
          />
        )
      )}
      <Stack gap={4}>
        {entries.map((entry) => (
          <EntryItem
            key={entry.id}
            db={db}
            entry={entry}
            types={types}
            version={version}
            run={run}
          />
        ))}
      </Stack>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Entries

interface EntryTimeInput {
  occurredAt?: number;
  endedAt?: number | null;
  precision?: Precision;
}

function EntryItem({
  db,
  entry,
  types,
  place,
  version,
  run,
}: {
  db: Database;
  entry: LogEntry;
  types: LogType[];
  /** A child entry's place among its siblings, 1 first. */
  place?: { index: number; count: number };
  version: number;
  run: Run;
}) {
  const fields = useFields(db, entry.logTypeId, version);
  const titles = useRefTitles(db, fields, entry);
  const [children, setChildren] = useState<LogEntry[]>([]);
  const childTypes = types.filter((t) => t.parentTypeId === entry.logTypeId);
  const [confirmDelete, deleteDialog] = useConfirmDelete(run);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` triggers the reload.
  useEffect(() => {
    listChildEntries(db, entry.id).then(setChildren);
  }, [db, entry.id, version]);

  const show = (field: LogField, value: Value): string => {
    switch (field.shape.valueType) {
      case "boolean":
        return value ? "yes" : "no";
      case "enum":
        return optionLabel(field.optionLabels, value as string);
      case "datetime":
        return new Date(value as number).toLocaleString();
      case "ref":
        return titles.get(value as string) ?? (value as string);
      case "multi_ref":
        return (value as string[]).map((id) => titles.get(id) ?? id).join(", ");
      default:
        return String(value);
    }
  };

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
        <Text size="sm">
          {fields
            .filter((f) => f.id in entry.values)
            .map((f) => `${f.name}: ${show(f, entry.values[f.id])}`)
            .join(" · ")}
        </Text>
        {place && (
          <>
            <Button
              size="xs"
              variant="default"
              disabled={place.index === 1}
              onClick={() => run(() => moveChildEntry(db, entry.id, place.index - 1))}
            >
              ↑
            </Button>
            <Button
              size="xs"
              variant="default"
              disabled={place.index === place.count}
              onClick={() => run(() => moveChildEntry(db, entry.id, place.index + 1))}
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
              () => deleteLogEntry(db, entry.id),
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
              version={version}
              run={run}
            />
          ))}
          {childTypes
            .filter((t) => t.archivedAt === null)
            .map((t) => (
              <ChildEntryForm
                key={t.id}
                db={db}
                type={t}
                parentEntryId={entry.id}
                run={run}
                version={version}
              />
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
  version,
  run,
}: {
  db: Database;
  type: LogType;
  parentEntryId: string;
  version: number;
  run: Run;
}) {
  const fields = useFields(db, type.id, version);
  return (
    <Group gap="xs" align="flex-end">
      <Text size="sm">{type.name}:</Text>
      <EntryForm
        db={db}
        fields={fields}
        child
        onCreate={(_, values) =>
          run(() => createLogEntry(db, { logTypeId: type.id, parentEntryId, values }))
        }
      />
    </Group>
  );
}

/** A new entry's time (unless it is a child entry) and a value per field. */
function EntryForm({
  db,
  fields,
  child,
  onCreate,
}: {
  db: Database;
  fields: LogField[];
  child: boolean;
  onCreate: (time: EntryTimeInput, values: Record<string, Value>) => void;
}) {
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const [precision, setPrecision] = useState<Precision>("instant");
  const [inputs, setInputs] = useState<Record<string, string | string[]>>({});

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const values: Record<string, Value> = {};
    for (const field of fields) {
      const input = inputs[field.id];
      if (input === undefined || input === "" || (Array.isArray(input) && input.length === 0)) {
        continue;
      }
      values[field.id] = parseInput(field.shape.valueType, input);
    }
    // DateTimePicker values are "YYYY-MM-DD HH:mm:ss" strings, which dayjs parses as device-local time.
    const time = child
      ? {}
      : {
          occurredAt: dayjs(start).valueOf(),
          endedAt: end ? dayjs(end).valueOf() : null,
          precision,
        };
    onCreate(time, values);
    setInputs({});
  };

  return (
    <form onSubmit={submit}>
      <Group gap="xs" align="flex-end">
        {!child && (
          <>
            <DateTimePicker
              size="xs"
              aria-label="Start"
              placeholder="Start"
              value={start}
              onChange={setStart}
            />
            <Text size="sm">→</Text>
            <DateTimePicker
              size="xs"
              aria-label="Optional end"
              placeholder="Optional end"
              clearable
              value={end}
              onChange={setEnd}
              title="Optional end"
            />
            <Select
              size="xs"
              aria-label="Precision"
              allowDeselect={false}
              value={precision}
              onChange={(v) => setPrecision(v as Precision)}
              data={[...PRECISIONS]}
            />
          </>
        )}
        {fields.map((field) => (
          <ValueInput
            key={field.id}
            db={db}
            field={field}
            value={inputs[field.id] ?? (field.shape.valueType === "multi_ref" ? [] : "")}
            onChange={(v) => setInputs({ ...inputs, [field.id]: v })}
          />
        ))}
        {/* The pickers are not native inputs, so `required` cannot stop an empty start. */}
        <Button type="submit" size="xs" disabled={!child && !start}>
          Add
        </Button>
      </Group>
    </form>
  );
}

function ValueInput({
  db,
  field,
  value,
  onChange,
}: {
  db: Database;
  field: LogField;
  value: string | string[];
  onChange: (value: string | string[]) => void;
}) {
  const { shape } = field;
  const things = useThings(
    db,
    shape.valueType === "ref" || shape.valueType === "multi_ref"
      ? shape.constraints.thingTypeId
      : null,
  );
  const text = value as string;
  // The field's name labels its input; "*" marks a required one.
  const common = { size: "xs", label: field.name, withAsterisk: field.required } as const;
  // Selects keep "" as an explicit "–" option and a cleared picker gives "", so an empty value stays a string.
  const pick = (v: string | null) => onChange(v ?? "");
  switch (shape.valueType) {
    case "boolean":
      return (
        <Select
          {...common}
          allowDeselect={false}
          value={text}
          onChange={pick}
          data={[
            { value: "", label: "–" },
            { value: "true", label: "yes" },
            { value: "false", label: "no" },
          ]}
        />
      );
    case "number":
      // Kept as text, like the plain input it replaces; `parseInput` makes it a number.
      return <NumberInput {...common} value={text} onChange={(v) => onChange(String(v))} />;
    case "enum":
      return (
        <Select
          {...common}
          allowDeselect={false}
          value={text}
          onChange={pick}
          data={[
            { value: "", label: "–" },
            ...shape.constraints.options.map((o) => ({
              value: o.key,
              label: optionLabel(field.optionLabels, o.key),
            })),
          ]}
        />
      );
    case "date":
      return <DatePickerInput {...common} clearable value={text || null} onChange={pick} />;
    case "datetime":
      return <DateTimePicker {...common} clearable value={text || null} onChange={pick} />;
    case "ref":
      return (
        <Select
          {...common}
          allowDeselect={false}
          value={text}
          onChange={pick}
          data={[
            { value: "", label: "–" },
            ...things.map((t) => ({ value: t.id, label: t.title })),
          ]}
        />
      );
    case "multi_ref":
      return (
        <MultiSelect
          {...common}
          value={value as string[]}
          onChange={onChange}
          data={things.map((t) => ({ value: t.id, label: t.title }))}
        />
      );
    default:
      return (
        <TextInput {...common} value={text} onChange={(e) => onChange(e.currentTarget.value)} />
      );
  }
}

/** A form input as a value of `valueType`, for core to validate. */
function parseInput(valueType: string, input: string | string[]): Value {
  switch (valueType) {
    case "boolean":
      return input === "true";
    case "number":
      return Number(input);
    case "datetime":
      // A DateTimePicker value, parsed as device-local time.
      return dayjs(input as string).valueOf();
    default:
      return input;
  }
}

/** The entry's time, showing only the part its precision knows. */
function formatTime(entry: LogEntry): string {
  const { occurredAt, precision, timeZone } = entry.resolved;
  const options: Record<Precision, Intl.DateTimeFormatOptions> = {
    instant: { dateStyle: "medium", timeStyle: "short" },
    day: { dateStyle: "medium" },
    month: { year: "numeric", month: "short" },
    year: { year: "numeric" },
  };
  const format = (instant: number) =>
    new Date(instant).toLocaleString(undefined, { ...options[precision], timeZone });
  return entry.endedAt === null
    ? format(occurredAt)
    : `${format(occurredAt)} → ${format(entry.endedAt)}`;
}

// ---------------------------------------------------------------------------
// Reads

function useFields(db: Database, typeId: string, reload: number) {
  const [fields, setFields] = useState<LogField[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` triggers the reload.
  useEffect(() => {
    getLogTypeFields(db, typeId).then(setFields);
  }, [db, typeId, reload]);
  return fields;
}

/** Thing types a `ref` field can target: live and unarchived. */
function useThingTypes(db: Database) {
  const [types, setTypes] = useState<ThingType[]>([]);
  useEffect(() => {
    listThingTypes(db).then((all) => setTypes(all.filter((t) => t.archivedAt === null)));
  }, [db]);
  return types;
}

/** The live things of a type, by title, to pick from. */
function useThings(db: Database, thingTypeId: string | null) {
  const [things, setThings] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    if (thingTypeId === null) return;
    listThings(db, thingTypeId)
      .then((list) =>
        Promise.all(
          list.map(async (t) => ({ id: t.id, title: (await getThingTitle(db, t.id)) ?? t.id })),
        ),
      )
      .then(setThings);
  }, [db, thingTypeId]);
  return things;
}

/** The titles of the things an entry refers to. */
function useRefTitles(db: Database, fields: LogField[], entry: LogEntry) {
  const [titles, setTitles] = useState(new Map<string, string>());
  useEffect(() => {
    const ids = fields.flatMap((f) => {
      const value = entry.values[f.id];
      if (f.shape.valueType === "ref") return [value as string];
      if (f.shape.valueType === "multi_ref") return value as string[];
      return [];
    });
    Promise.all(
      ids.filter(Boolean).map(async (id) => [id, (await getThingTitle(db, id)) ?? id] as const),
    ).then((pairs) => setTitles(new Map(pairs)));
  }, [db, fields, entry]);
  return titles;
}
