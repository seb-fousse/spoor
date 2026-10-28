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
 * their values, merging and the trash, wired to plain HTML controls. Its only
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
    <section className="timelines">
      <h2>Things</h2>
      {error && <p className="error">{error}</p>}

      <form onSubmit={addType}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New thing type"
        />{" "}
        <button type="submit">Add</button>
      </form>
      {confirming && (
        <p>
          This deletes the {confirming.type.name} type and its {confirming.things} things.{" "}
          <button
            type="button"
            onClick={() => {
              setConfirming(null);
              run(() => deleteThingType(db, confirming.type.id));
            }}
          >
            Delete
          </button>{" "}
          <button type="button" onClick={() => setConfirming(null)}>
            Cancel
          </button>
        </p>
      )}
      <ul>
        {types.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => setSelectedId(t.id)}>
              {t.id === selectedId ? <strong>{t.name}</strong> : t.name}
            </button>{" "}
            v{t.schemaVersion}
            {t.archivedAt !== null && " · archived"}{" "}
            <button
              type="button"
              onClick={() => run(() => setThingTypeArchived(db, t.id, t.archivedAt === null))}
            >
              {t.archivedAt === null ? "Archive" : "Unarchive"}
            </button>{" "}
            <button type="button" onClick={() => askDelete(t)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      <Trash
        items={trashed.map((t) => ({ id: t.id, label: t.name, deletionId: t.deletionId }))}
        onRestore={(deletionId) => run(() => restoreThingRecords(db, deletionId))}
      />

      {selected && (
        <ThingTypeDetail db={db} type={selected} types={types} version={version} run={run} />
      )}
    </section>
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
    <div>
      <h3>
        {type.name} <small>(version {type.schemaVersion})</small>
      </h3>

      <h4>Fields</h4>
      <label>
        Title field{" "}
        <select
          value={type.titleFieldId}
          onChange={(e) =>
            run(() => updateThingType(db, type.id, { titleFieldId: e.target.value }))
          }
        >
          {fields
            .filter((f) => f.shape.valueType === "text" && f.required)
            .map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
        </select>
      </label>
      <FieldEditor
        key={`${type.id}:${version}`}
        fields={fields}
        types={types}
        onSave={(inputs) => run(() => reviseThingTypeFields(db, type.id, inputs))}
      />

      <h4>Things</h4>
      {type.archivedAt === null && (
        <ValuesForm
          key={`new:${version}`}
          db={db}
          fields={fields}
          submitLabel="Add"
          onSubmit={(values) => run(() => createThing(db, { thingTypeId: type.id, values }))}
        />
      )}
      <ul>
        {things.map((thing) => (
          <li key={thing.id}>
            <strong>{title(thing)}</strong> <small>v{thing.thingTypeVersion}</small>{" "}
            <button type="button" onClick={() => setEditingId(thing.id)}>
              Edit
            </button>{" "}
            <select
              value=""
              onChange={(e) => run(() => mergeThings(db, e.target.value, thing.id))}
              title="Merge this thing into another, which keeps its references"
            >
              <option value="">Merge into…</option>
              {things
                .filter((other) => other.id !== thing.id)
                .map((other) => (
                  <option key={other.id} value={other.id}>
                    {title(other)}
                  </option>
                ))}
            </select>{" "}
            <button type="button" onClick={() => run(() => deleteThing(db, thing.id))}>
              Delete
            </button>
            <ValuesList db={db} thing={thing} />
          </li>
        ))}
      </ul>
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
    </div>
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
      <h4>Edit {title}</h4>
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
      <ul>
        {drafts.map((d, i) => (
          <li key={d.id ?? i}>
            <input value={d.name} onChange={(e) => change(i, { name: e.target.value })} />{" "}
            <select
              value={d.valueType}
              onChange={(e) =>
                change(i, { valueType: e.target.value as FieldValueType, constraints: "" })
              }
            >
              {FIELD_VALUE_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>{" "}
            <label>
              <input
                type="checkbox"
                checked={d.required}
                onChange={(e) => change(i, { required: e.target.checked })}
              />{" "}
              required
            </label>{" "}
            {isRef(d) ? (
              <select
                value={d.constraints ? (JSON.parse(d.constraints).thingTypeId ?? "") : ""}
                onChange={(e) =>
                  change(i, { constraints: JSON.stringify({ thingTypeId: e.target.value }) })
                }
              >
                <option value="">Refers to…</option>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={d.constraints}
                onChange={(e) => change(i, { constraints: e.target.value })}
                placeholder='Constraints, e.g. {"options":[{"key":"a","order":1}]}'
              />
            )}{" "}
            <button type="button" onClick={() => setDrafts((ds) => ds.filter((_, j) => j !== i))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() =>
          setDrafts((ds) => [
            ...ds,
            { name: "", valueType: "text", required: false, constraints: "" },
          ])
        }
      >
        Add field
      </button>{" "}
      <button type="submit">Save fields</button>
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
      {fields.map((f) => (
        // The input is a component, which a <label> cannot be seen to wrap.
        <div key={f.id}>
          {f.name}
          {f.required && " *"}{" "}
          <ValueInput db={db} field={f} value={draft[f.id] ?? ""} onChange={(v) => set(f.id, v)} />
        </div>
      ))}
      <button type="submit">{submitLabel}</button>
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
  switch (shape.valueType) {
    case "boolean":
      return (
        <select value={text} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          <option value="true">yes</option>
          <option value="false">no</option>
        </select>
      );
    case "enum":
      return (
        <select value={text} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {shape.constraints.options.map((o) => (
            <option key={o.key} value={o.key}>
              {field.optionLabels[o.key] ?? o.key}
            </option>
          ))}
        </select>
      );
    case "ref":
    case "multi_ref":
      return (
        <ThingSelect
          db={db}
          thingTypeId={shape.constraints.thingTypeId}
          multiple={shape.valueType === "multi_ref"}
          value={value}
          onChange={onChange}
        />
      );
    default: {
      const type = { number: "number", date: "date", datetime: "datetime-local" }[
        shape.valueType as string
      ];
      return (
        <input
          type={type ?? "text"}
          step={type === "number" ? "any" : undefined}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }
  }
}

/** Live things of one type to refer to, by title. */
function ThingSelect({
  db,
  thingTypeId,
  multiple,
  value,
  onChange,
}: {
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
  return multiple ? (
    <select
      multiple
      value={Array.isArray(value) ? value : []}
      onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => o.value))}
    >
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.title}
        </option>
      ))}
    </select>
  ) : (
    <select
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.title}
        </option>
      ))}
    </select>
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
    <ul>
      {fields
        .filter((f) => f.id in thing.values)
        .map((f) => (
          <li key={f.id}>
            {f.name}: {show(f, thing.values[f.id])}
          </li>
        ))}
    </ul>
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
