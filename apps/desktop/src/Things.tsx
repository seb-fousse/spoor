import {
  Alert,
  Button,
  Checkbox,
  Group,
  MultiSelect,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  createThing,
  createThingType,
  type Database,
  deleteThing,
  deleteThingType,
  FIELD_VALUE_TYPES,
  type FieldDefinition,
  type FieldInput,
  type FieldValueType,
  getThingTitle,
  getThingTypeVersionFields,
  listThings,
  listThingTypes,
  mergeThings,
  previewThingTypeDeletion,
  restoreThingRecords,
  reviseThingTypeFields,
  setThingTypeArchived,
  type Thing,
  type ThingType,
  updateThingType,
  updateThingValues,
  type Value,
  type ValuePatch,
} from "@spoor/core";
import { type FormEvent, useEffect, useState } from "react";
import { Trash } from "./Timelines";

type Run = (action: () => Promise<unknown>) => void;

/**
 * Proof-of-concept Things screen: thing types and their fields, things and
 * their values, merging and the trash, wired to stock Mantine controls. Its only
 * job is to show the slice works end to end over IPC; the real UI replaces it.
 */
export function Things({ db }: { db: Database }) {
  const [types, setTypes] = useState<ThingType[]>([]);
  const [trashed, setTrashed] = useState<ThingType[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ type: ThingType; things: number } | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // Runs a write, shows any error, and reloads everything.
  const run: Run = (action) => {
    setError(null);
    action()
      .catch((e: Error) => setError(e.message))
      .finally(() => setVersion((v) => v + 1));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` triggers the reload.
  useEffect(() => {
    Promise.all([listThingTypes(db), listThingTypes(db, { trashed: true })])
      .then(([live, trash]) => {
        setTypes(live);
        setTrashed(trash);
      })
      .catch((e: Error) => setError(e.message));
  }, [db, version]);

  const addType = (e: FormEvent) => {
    e.preventDefault();
    // Every type needs a title field; more fields are added by revising it.
    run(() =>
      createThingType(db, {
        name,
        fields: [{ name: "Name", valueType: "text", required: true }],
      }),
    );
    setName("");
  };

  // Deleting cascades, so show what it removes first.
  const askDelete = (type: ThingType) =>
    run(async () => setConfirming({ type, ...(await previewThingTypeDeletion(db, type.id)) }));

  const selected = types.find((t) => t.id === selectedId);

  return (
    <Stack component="section" gap="sm">
      <Title order={2}>Things</Title>
      {error && <Alert color="red">{error}</Alert>}

      <form onSubmit={addType}>
        <Group gap="xs" align="flex-end">
          <TextInput
            size="xs"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New thing type"
            aria-label="New thing type"
          />
          <Button type="submit" size="xs">
            Add
          </Button>
        </Group>
      </form>
      {confirming && (
        <Group gap="xs">
          <Text size="sm">
            This deletes the {confirming.type.name} type and its {confirming.things} things.
          </Text>
          <Button
            size="xs"
            variant="light"
            color="red"
            onClick={() => {
              setConfirming(null);
              run(() => deleteThingType(db, confirming.type.id));
            }}
          >
            Delete
          </Button>
          <Button size="xs" variant="default" onClick={() => setConfirming(null)}>
            Cancel
          </Button>
        </Group>
      )}
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
              v{t.schemaVersion}
              {t.archivedAt !== null && " · archived"}
            </Text>
            <Button
              size="xs"
              variant="default"
              onClick={() => run(() => setThingTypeArchived(db, t.id, t.archivedAt === null))}
            >
              {t.archivedAt === null ? "Archive" : "Unarchive"}
            </Button>
            <Button size="xs" variant="light" color="red" onClick={() => askDelete(t)}>
              Delete
            </Button>
          </Group>
        ))}
      </Stack>
      <Trash
        items={trashed.map((t) => ({ id: t.id, label: t.name, deletionId: t.deletionId }))}
        onRestore={(deletionId) => run(() => restoreThingRecords(db, deletionId))}
      />

      {selected && (
        <ThingTypeDetail db={db} type={selected} types={types} version={version} run={run} />
      )}
    </Stack>
  );
}

function ThingTypeDetail({
  db,
  type,
  types,
  version,
  run,
}: {
  db: Database;
  type: ThingType;
  types: ThingType[];
  version: number;
  run: Run;
}) {
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [things, setThings] = useState<Thing[]>([]);
  const [trashed, setTrashed] = useState<Thing[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` triggers the reload.
  useEffect(() => {
    Promise.all([
      getThingTypeVersionFields(db, type.id),
      listThings(db, type.id),
      listThings(db, type.id, { trashed: true }),
    ]).then(([f, live, trash]) => {
      setFields(f);
      setThings(live);
      setTrashed(trash);
    });
  }, [db, type.id, type.schemaVersion, version]);

  const title = (thing: Thing) => String(thing.values[type.titleFieldId] ?? "?");
  const editing = things.find((t) => t.id === editingId);

  return (
    <Stack gap="sm">
      <Title order={3}>
        {type.name}{" "}
        <Text span size="sm" c="dimmed">
          (version {type.schemaVersion})
        </Text>
      </Title>

      <Title order={4}>Fields</Title>
      <Group gap="xs">
        <Select
          size="xs"
          label="Title field"
          allowDeselect={false}
          value={type.titleFieldId}
          onChange={(v) => v && run(() => updateThingType(db, type.id, { titleFieldId: v }))}
          data={fields
            .filter((f) => f.shape.valueType === "text" && f.required)
            .map((f) => ({ value: f.id, label: f.name }))}
        />
      </Group>
      <FieldEditor
        key={`${type.id}:${version}`}
        fields={fields}
        types={types}
        onSave={(inputs) => run(() => reviseThingTypeFields(db, type.id, inputs))}
      />

      <Title order={4}>Things</Title>
      {type.archivedAt === null && (
        <ValuesForm
          key={`new:${version}`}
          db={db}
          fields={fields}
          submitLabel="Add"
          onSubmit={(values) => run(() => createThing(db, { thingTypeId: type.id, values }))}
        />
      )}
      <Stack gap={4}>
        {things.map((thing) => (
          <div key={thing.id}>
            <Group gap="xs">
              <Text size="sm" fw={700}>
                {title(thing)}
              </Text>
              <Text size="sm" c="dimmed">
                v{thing.thingTypeVersion}
              </Text>
              <Button size="xs" variant="default" onClick={() => setEditingId(thing.id)}>
                Edit
              </Button>
              {/* Never holds a value: picking a target merges at once. */}
              <Select
                size="xs"
                value={null}
                onChange={(v) => v && run(() => mergeThings(db, v, thing.id))}
                placeholder="Merge into…"
                aria-label="Merge into"
                title="Merge this thing into another, which keeps its references"
                data={things
                  .filter((other) => other.id !== thing.id)
                  .map((other) => ({ value: other.id, label: title(other) }))}
              />
              <Button
                size="xs"
                variant="light"
                color="red"
                onClick={() => run(() => deleteThing(db, thing.id))}
              >
                Delete
              </Button>
            </Group>
            <ValuesList db={db} thing={thing} />
          </div>
        ))}
      </Stack>
      {editing && (
        <EditThing
          key={`${editing.id}:${version}`}
          db={db}
          thing={editing}
          title={title(editing)}
          onSave={(values) =>
            run(async () => {
              await updateThingValues(db, editing.id, values);
              setEditingId(null);
            })
          }
        />
      )}
      <Trash
        items={trashed.map((t) => ({
          id: t.id,
          label: t.mergedIntoId ? `${title(t)} (merged)` : title(t),
          deletionId: t.deletionId,
        }))}
        onRestore={(deletionId) => run(() => restoreThingRecords(db, deletionId))}
      />
    </Stack>
  );
}

/** Edits a thing against its own version's fields, which may be older than the current ones. */
function EditThing({
  db,
  thing,
  title,
  onSave,
}: {
  db: Database;
  thing: Thing;
  title: string;
  onSave: (values: ValuePatch) => void;
}) {
  const [fields, setFields] = useState<FieldDefinition[] | null>(null);
  useEffect(() => {
    getThingTypeVersionFields(db, thing.thingTypeId, thing.thingTypeVersion).then(setFields);
  }, [db, thing.thingTypeId, thing.thingTypeVersion]);
  if (fields === null) return null;
  return (
    <>
      <Title order={4}>Edit {title}</Title>
      <ValuesForm
        db={db}
        fields={fields}
        initial={thing.values}
        clearsMissing
        submitLabel="Save"
        onSubmit={onSave}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Fields

interface FieldDraft {
  id?: string;
  name: string;
  valueType: FieldValueType;
  required: boolean;
  /** JSON text, or the target thing type for references. */
  constraints: string;
}

/** Edits the whole field list, saved as one revision. Removing a field retires it. */
function FieldEditor({
  fields,
  types,
  onSave,
}: {
  fields: FieldDefinition[];
  types: ThingType[];
  onSave: (inputs: FieldInput[]) => void;
}) {
  const [drafts, setDrafts] = useState<FieldDraft[]>(() =>
    fields.map((f) => ({
      id: f.id,
      name: f.name,
      valueType: f.shape.valueType as FieldValueType,
      required: f.required,
      constraints: JSON.stringify(f.shape.constraints),
    })),
  );
  const change = (i: number, patch: Partial<FieldDraft>) =>
    setDrafts((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const isRef = (d: FieldDraft) => d.valueType === "ref" || d.valueType === "multi_ref";

  const save = (e: FormEvent) => {
    e.preventDefault();
    onSave(
      drafts.map(({ constraints, ...d }) => ({
        ...d,
        constraints: constraints.trim() === "" ? undefined : JSON.parse(constraints),
      })),
    );
  };

  return (
    <form onSubmit={save}>
      <Stack gap="xs">
        <Stack gap={4}>
          {drafts.map((d, i) => (
            <Group key={d.id ?? i} gap="xs">
              <TextInput
                size="xs"
                aria-label="Field name"
                value={d.name}
                onChange={(e) => change(i, { name: e.target.value })}
              />
              <Select
                size="xs"
                aria-label="Value type"
                allowDeselect={false}
                value={d.valueType}
                onChange={(v) =>
                  v && change(i, { valueType: v as FieldValueType, constraints: "" })
                }
                data={FIELD_VALUE_TYPES}
              />
              <Checkbox
                size="xs"
                label="required"
                checked={d.required}
                onChange={(e) => change(i, { required: e.currentTarget.checked })}
              />
              {isRef(d) ? (
                // No target shows the placeholder, as the old empty option did.
                <Select
                  size="xs"
                  clearable
                  placeholder="Refers to…"
                  aria-label="Refers to"
                  value={(d.constraints ? JSON.parse(d.constraints).thingTypeId : null) || null}
                  onChange={(v) =>
                    change(i, { constraints: JSON.stringify({ thingTypeId: v ?? "" }) })
                  }
                  data={types.map((t) => ({ value: t.id, label: t.name }))}
                />
              ) : (
                <TextInput
                  size="xs"
                  value={d.constraints}
                  onChange={(e) => change(i, { constraints: e.target.value })}
                  placeholder='Constraints, e.g. {"options":[{"key":"a","order":1}]}'
                  aria-label="Constraints"
                />
              )}
              <Button
                size="xs"
                variant="default"
                onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}
              >
                Remove
              </Button>
            </Group>
          ))}
        </Stack>
        <Group gap="xs">
          <Button
            size="xs"
            variant="default"
            onClick={() =>
              setDrafts((ds) => [
                ...ds,
                { name: "", valueType: "text", required: false, constraints: "" },
              ])
            }
          >
            Add field
          </Button>
          <Button type="submit" size="xs">
            Save fields
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Values

/** A form value per field: text for most types, a flag or ids for the rest. */
type Draft = Record<string, string | string[]>;

function ValuesForm({
  db,
  fields,
  initial = {},
  clearsMissing = false,
  submitLabel,
  onSubmit,
}: {
  db: Database;
  fields: FieldDefinition[];
  initial?: Record<string, Value>;
  /** Send an emptied field as `null`, clearing it, instead of leaving it out. */
  clearsMissing?: boolean;
  submitLabel: string;
  onSubmit: (values: ValuePatch) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(fields.map((f) => [f.id, toDraft(f, initial[f.id])])),
  );
  const set = (id: string, value: string | string[]) => setDraft((d) => ({ ...d, [id]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const values: Record<string, Value | null> = {};
    for (const field of fields) {
      const value = fromDraft(field, draft[field.id]);
      if (value !== null || clearsMissing) values[field.id] = value;
    }
    onSubmit(values);
  };

  return (
    <form onSubmit={submit}>
      <Group gap="xs" align="flex-end">
        {fields.map((f) => (
          <ValueInput
            key={f.id}
            db={db}
            field={f}
            value={draft[f.id] ?? ""}
            onChange={(v) => set(f.id, v)}
          />
        ))}
        <Button type="submit" size="xs">
          {submitLabel}
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
  field: FieldDefinition;
  value: string | string[];
  onChange: (value: string | string[]) => void;
}) {
  const { shape } = field;
  const text = typeof value === "string" ? value : "";
  // The asterisk only marks a required field; the core validates, not the form.
  const label: InputLabel = { label: field.name, withAsterisk: field.required, size: "xs" };
  // "—" stands for no value, which the draft keeps as an empty string.
  const choice = {
    ...label,
    clearable: true,
    placeholder: "—",
    value: text || null,
    onChange: (v: string | null) => onChange(v ?? ""),
  };
  switch (shape.valueType) {
    case "boolean":
      return (
        <Select
          {...choice}
          data={[
            { value: "true", label: "yes" },
            { value: "false", label: "no" },
          ]}
        />
      );
    case "enum":
      return (
        <Select
          {...choice}
          data={shape.constraints.options.map((o) => ({
            value: o.key,
            label: field.optionLabels[o.key] ?? o.key,
          }))}
        />
      );
    case "ref":
    case "multi_ref":
      return (
        <ThingSelect
          {...label}
          db={db}
          thingTypeId={shape.constraints.thingTypeId}
          multiple={shape.valueType === "multi_ref"}
          value={value}
          onChange={onChange}
        />
      );
    case "number":
      // Kept as text like the other inputs; `fromDraft` parses it.
      return <NumberInput {...label} value={text} onChange={(v) => onChange(String(v))} />;
    default: {
      const type = { date: "date", datetime: "datetime-local" }[shape.valueType as string];
      return (
        <TextInput
          {...label}
          type={type ?? "text"}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
  }
}

/** The label props every value input takes. */
interface InputLabel {
  label: string;
  withAsterisk: boolean;
  size: "xs";
}

/** Live things of one type to refer to, by title. */
function ThingSelect({
  db,
  thingTypeId,
  multiple,
  value,
  onChange,
  ...label
}: InputLabel & {
  db: Database;
  thingTypeId: string;
  multiple: boolean;
  value: string | string[];
  onChange: (value: string | string[]) => void;
}) {
  const [options, setOptions] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    listThings(db, thingTypeId)
      .then((things) =>
        Promise.all(
          things.map(async (t) => ({ id: t.id, title: (await getThingTitle(db, t.id)) ?? "?" })),
        ),
      )
      .then(setOptions);
  }, [db, thingTypeId]);
  const data = options.map((o) => ({ value: o.id, label: o.title }));
  return multiple ? (
    <MultiSelect
      {...label}
      value={Array.isArray(value) ? value : []}
      onChange={onChange}
      data={data}
    />
  ) : (
    <Select
      {...label}
      clearable
      placeholder="—"
      value={(typeof value === "string" ? value : "") || null}
      onChange={(v) => onChange(v ?? "")}
      data={data}
    />
  );
}

/** A thing's values, with references shown by title, including deleted things. */
function ValuesList({ db, thing }: { db: Database; thing: Thing }) {
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    getThingTypeVersionFields(db, thing.thingTypeId, thing.thingTypeVersion).then(setFields);
    const ids = Object.values(thing.values).flatMap((v) =>
      Array.isArray(v) ? v : typeof v === "string" ? [v] : [],
    );
    Promise.all(ids.map(async (id) => [id, await getThingTitle(db, id)] as const)).then((pairs) =>
      setTitles(
        Object.fromEntries(pairs.filter(([, t]) => t !== undefined)) as Record<string, string>,
      ),
    );
  }, [db, thing]);
  const show = (f: FieldDefinition, v: Value) => {
    if (f.shape.valueType === "ref") return titles[v as string] ?? String(v);
    if (f.shape.valueType === "multi_ref")
      return (v as string[]).map((id) => titles[id] ?? id).join(", ");
    if (f.shape.valueType === "datetime") return new Date(v as number).toLocaleString();
    if (f.shape.valueType === "enum") return f.optionLabels[v as string] ?? String(v);
    return String(v);
  };
  return (
    <Stack gap={0} pl="md">
      {fields
        .filter((f) => f.id in thing.values)
        .map((f) => (
          <Text key={f.id} size="sm" c="dimmed">
            {f.name}: {show(f, thing.values[f.id])}
          </Text>
        ))}
    </Stack>
  );
}

function toDraft(field: FieldDefinition, value: Value | undefined): string | string[] {
  if (value === undefined) return field.shape.valueType === "multi_ref" ? [] : "";
  if (Array.isArray(value)) return value;
  if (field.shape.valueType === "datetime") {
    // `datetime-local` shows device-local time.
    const date = new Date(value as number);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  }
  return String(value);
}

/** The value for a field's form input; an empty input is no value. */
function fromDraft(field: FieldDefinition, draft: string | string[] | undefined): Value | null {
  if (draft === undefined || draft.length === 0) return null;
  if (Array.isArray(draft)) return draft;
  switch (field.shape.valueType) {
    case "boolean":
      return draft === "true";
    case "number":
      return Number(draft);
    case "datetime":
      return new Date(draft).getTime();
    default:
      return draft;
  }
}
