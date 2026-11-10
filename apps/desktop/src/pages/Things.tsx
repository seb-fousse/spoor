import { effect, useConfirmDelete } from "@components/ConfirmDelete";
import { FieldList } from "@components/FieldList";
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
  addThingField,
  createThing,
  createThingType,
  type Database,
  deleteThing,
  deleteThingField,
  deleteThingType,
  type FieldDefinition,
  getThingTitle,
  getThingTypeFields,
  listThings,
  listThingTypes,
  mergeThings,
  previewThingDeletion,
  previewThingFieldDeletion,
  previewThingTypeDeletion,
  reorderThingFields,
  setThingTypeArchived,
  type Thing,
  type ThingDeletion,
  type ThingType,
  updateThingField,
  updateThingType,
  updateThingValues,
  type Value,
  type ValuePatch,
} from "@spoor/core";
import dayjs from "dayjs";
import { type FormEvent, useEffect, useState } from "react";

type Run = (action: () => Promise<unknown>) => void;

/**
 * Proof-of-concept Things screen: thing types and their fields, things and
 * their values and merging, wired to stock Mantine controls. Its only
 * job is to show the slice works end to end over IPC; the real UI replaces it.
 */
export function Things({ db }: { db: Database }) {
  const [types, setTypes] = useState<ThingType[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const [confirmDelete, deleteDialog] = useConfirmDelete(run);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` triggers the reload.
  useEffect(() => {
    listThingTypes(db)
      .then(setTypes)
      .catch((e: Error) => setError(e.message));
  }, [db, version]);

  const addType = (e: FormEvent) => {
    e.preventDefault();
    // Every type needs a title field; more are added from its field list.
    run(() =>
      createThingType(db, {
        name,
        fields: [{ name: "Name", valueType: "text", required: true }],
      }),
    );
    setName("");
  };

  const askDelete = (type: ThingType) =>
    confirmDelete(
      `the ${type.name} type`,
      () => deleteThingType(db, type.id),
      async () => {
        const n = await previewThingTypeDeletion(db, type.id);
        return [effect("deletes", n.things, "thing"), ...referenceEffects(n)];
      },
    );

  const selected = types.find((t) => t.id === selectedId);

  return (
    <Stack component="section" gap="sm">
      <Title order={2}>Things</Title>
      {error && <Alert color="red">{error}</Alert>}
      {deleteDialog}

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
              {t.archivedAt !== null && "archived"}
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, deleteDialog] = useConfirmDelete(run);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` triggers the reload.
  useEffect(() => {
    Promise.all([getThingTypeFields(db, type.id), listThings(db, type.id)]).then(([f, live]) => {
      setFields(f);
      setThings(live);
    });
  }, [db, type.id, version]);

  const title = (thing: Thing) => String(thing.values[type.titleFieldId] ?? "?");
  const editing = things.find((t) => t.id === editingId);

  return (
    <Stack gap="sm">
      <Title order={3}>{type.name}</Title>
      {deleteDialog}

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
      <FieldList
        fields={fields}
        thingTypes={types}
        lockedId={type.titleFieldId}
        onAdd={(field) => run(() => addThingField(db, type.id, field))}
        onUpdate={(fieldId, patch) => run(() => updateThingField(db, type.id, fieldId, patch))}
        onReorder={(ids) => run(() => reorderThingFields(db, type.id, ids))}
        onDelete={(field) =>
          confirmDelete(
            `the ${field.name} field`,
            () => deleteThingField(db, type.id, field.id),
            async () => [
              effect(
                "removes its value from",
                (await previewThingFieldDeletion(db, type.id, field.id)).values,
                "thing",
              ),
            ],
          )
        }
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
                onClick={() =>
                  confirmDelete(
                    title(thing),
                    () => deleteThing(db, thing.id),
                    async () => referenceEffects(await previewThingDeletion(db, thing.id)),
                  )
                }
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
    </Stack>
  );
}

/** What deleting things does to what refers to them, for the confirmation. */
function referenceEffects(n: ThingDeletion) {
  return [
    effect("removes", n.references, "reference"),
    effect("unlinks", n.categories, "timeline category", "timeline categories"),
  ];
}

/** Edits a thing against its type's fields. */
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
    getThingTypeFields(db, thing.thingTypeId).then(setFields);
  }, [db, thing.thingTypeId]);
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
    case "date":
      return <DatePickerInput {...choice} />;
    case "datetime":
      return <DateTimePicker {...choice} />;
    default:
      return <TextInput {...label} value={text} onChange={(e) => onChange(e.target.value)} />;
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

/** A thing's values, with references shown by title. */
function ValuesList({ db, thing }: { db: Database; thing: Thing }) {
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  useEffect(() => {
    getThingTypeFields(db, thing.thingTypeId).then(setFields);
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
    // DateTimePicker shows device-local time.
    return dayjs(value as number).format("YYYY-MM-DD HH:mm:ss");
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
      // A DateTimePicker value, parsed as device-local time.
      return dayjs(draft).valueOf();
    default:
      return draft;
  }
}
