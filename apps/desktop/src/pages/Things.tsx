import { effect, useConfirmDelete } from "@components/ConfirmDelete";
import { FieldList } from "@components/FieldList";
import { useRefTitles, useThings } from "@components/LogEntryForm";
import { type ThingWriteReach, useThingWrite } from "@hooks/useThingWrite";
import { queryKeys } from "@lib/queryKeys";
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
import { useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { type FormEvent, useState } from "react";

type Run = (action: () => Promise<unknown>, reach?: ThingWriteReach) => void;

/** A thing type's fields, shared by everything on the page showing its things. */
function useThingFields(db: Database, typeId: string) {
  return useQuery({
    queryKey: queryKeys.things.fields(typeId),
    queryFn: () => getThingTypeFields(db, typeId),
  });
}

/**
 * Proof-of-concept Things screen: thing types and their fields, things and
 * their values and merging, wired to stock Mantine controls. Its only
 * job is to show the slice works end to end over IPC; the real UI replaces it.
 */
export function Things({ db }: { db: Database }) {
  const typesQuery = useQuery({
    queryKey: queryKeys.things.types,
    queryFn: () => listThingTypes(db),
  });
  const types = typesQuery.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const write = useThingWrite();

  // Runs a write, shows any error, and refreshes what it changed.
  const run: Run = (action, reach) => {
    setError(null);
    write(action, reach).catch((e: Error) => setError(e.message));
  };

  // Deleting a type deletes its things, so references to them go too.
  const [confirmDelete, deleteDialog] = useConfirmDelete((action) => run(action, "references"));

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
      {(error ?? typesQuery.error) && (
        <Alert color="red">{error ?? typesQuery.error?.message}</Alert>
      )}
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

      {selected && <ThingTypeDetail db={db} type={selected} types={types} run={run} />}
    </Stack>
  );
}

function ThingTypeDetail({
  db,
  type,
  types,
  run,
}: {
  db: Database;
  type: ThingType;
  types: ThingType[];
  run: Run;
}) {
  const { data: fields = [] } = useThingFields(db, type.id);
  const { data: things = [] } = useQuery({
    queryKey: queryKeys.things.ofType(type.id),
    queryFn: () => listThings(db, type.id),
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  // Bumped by each thing created, to empty the form for the next.
  const [created, setCreated] = useState(0);
  // Deleting a thing removes references to it. Deleting a field only changes things, but
  // shares the dialog, and refreshing more than a write changed is harmless.
  const [confirmDelete, deleteDialog] = useConfirmDelete((action) => run(action, "references"));

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
          key={created}
          db={db}
          fields={fields}
          submitLabel="Add"
          onSubmit={(values) =>
            run(async () => {
              await createThing(db, { thingTypeId: type.id, values });
              setCreated((n) => n + 1);
            })
          }
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
                onChange={(v) => v && run(() => mergeThings(db, v, thing.id), "references")}
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
          // A changed thing bumps `updatedAt`, which resets the form to its stored values.
          key={`${editing.id}:${editing.updatedAt}`}
          db={db}
          thing={editing}
          title={title(editing)}
          onSave={(values) =>
            run(async () => {
              await updateThingValues(db, editing.id, values);
              setEditingId(null);
            }, "titles")
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
  const { data: fields } = useThingFields(db, thing.thingTypeId);
  if (fields === undefined) return null;
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
  const data = useThings(db, thingTypeId).map((o) => ({ value: o.id, label: o.title }));
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
  const { data: fields = [] } = useThingFields(db, thing.thingTypeId);
  const titles = useRefTitles(db, fields, thing);
  const show = (f: FieldDefinition, v: Value) => {
    if (f.shape.valueType === "ref") return titles.get(v as string) ?? String(v);
    if (f.shape.valueType === "multi_ref")
      return (v as string[]).map((id) => titles.get(id) ?? id).join(", ");
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
