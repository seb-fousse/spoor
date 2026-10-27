import {
  createLogEntry,
  createLogType,
  type Database,
  deleteLogEntry,
  deleteLogType,
  FIELD_VALUE_TYPES,
  type FieldValueType,
  getLogTypeVersionFields,
  getThingTitle,
  type LogEntry,
  type LogField,
  type LogFieldInput,
  type LogType,
  type LogTypeDeletion,
  listChildEntries,
  listLogEntries,
  listLogTypes,
  listThings,
  listThingTypes,
  logFieldInput,
  moveChildEntry,
  optionLabel,
  PRECISIONS,
  type Precision,
  previewLogTypeDeletion,
  reorderLogFields,
  restoreLogRecords,
  reviseLogTypeFields,
  setLogTypeArchived,
  type ThingType,
  type Value,
} from "@spoor/core";
import { type FormEvent, useEffect, useState } from "react";
import { Trash } from "./Timelines";

/**
 * Proof-of-concept Logs screen: log types and their fields, entries with a
 * value of every field type, and child entries, wired to plain HTML controls.
 * Its only job is to show the slice works end to end over IPC; the real UI
 * replaces it.
 */

type Run = (action: () => Promise<unknown>) => void;

export function Logs({ db }: { db: Database }) {
  const [types, setTypes] = useState<LogType[]>([]);
  const [trashed, setTrashed] = useState<LogType[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ type: LogType; preview: LogTypeDeletion } | null>(null);
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
    Promise.all([listLogTypes(db), listLogTypes(db, { trashed: true })])
      .then(([live, trash]) => {
        setTypes(live);
        setTrashed(trash);
      })
      .catch((e: Error) => setError(e.message));
  }, [db, version]);

  const selected = types.find((t) => t.id === selectedId);
  const nameOf = (id: string | null) => types.find((t) => t.id === id)?.name ?? "?";

  // The spec requires the cascade's counts before the user confirms.
  const askDelete = (type: LogType) =>
    run(async () => setPending({ type, preview: await previewLogTypeDeletion(db, type.id) }));

  return (
    <section className="logs">
      <h2>Logs</h2>
      {error && <p className="error">{error}</p>}

      <LogTypeForm
        db={db}
        types={types}
        onCreate={(name, parentTypeId, fields) =>
          run(() => createLogType(db, { name, parentTypeId, fields }))
        }
      />
      <ul>
        {types.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => setSelectedId(t.id)}>
              {t.id === selectedId ? <strong>{t.name}</strong> : t.name}
            </button>{" "}
            v{t.schemaVersion}
            {t.parentTypeId !== null && ` · inside ${nameOf(t.parentTypeId)}`}
            {t.archivedAt !== null && " · archived"}{" "}
            <button
              type="button"
              onClick={() => run(() => setLogTypeArchived(db, t.id, t.archivedAt === null))}
            >
              {t.archivedAt === null ? "Archive" : "Unarchive"}
            </button>{" "}
            <button type="button" onClick={() => askDelete(t)}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      {pending && (
        <p>
          This deletes the {pending.type.name} log type
          {pending.preview.types > 1 && `, ${pending.preview.types - 1} child type(s)`} and{" "}
          {pending.preview.entries} entries.{" "}
          <button
            type="button"
            onClick={() => {
              setPending(null);
              run(() => deleteLogType(db, pending.type.id));
            }}
          >
            Confirm
          </button>{" "}
          <button type="button" onClick={() => setPending(null)}>
            Cancel
          </button>
        </p>
      )}
      <Trash
        items={trashed.map((t) => ({ id: t.id, label: t.name, deletionId: t.deletionId }))}
        onRestore={(deletionId) => run(() => restoreLogRecords(db, deletionId))}
      />

      {selected && (
        <LogTypeDetail db={db} type={selected} types={types} version={version} run={run} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Types and fields

/** A field being edited: constraints as JSON text. */
interface FieldRow {
  id?: string;
  name: string;
  valueType: FieldValueType;
  required: boolean;
  constraints: string;
  optionLabels?: Record<string, string>;
}

const newRow = (): FieldRow => ({ name: "", valueType: "text", required: false, constraints: "" });

const toRow = (field: LogField): FieldRow => {
  const constraints = JSON.stringify(field.shape.constraints);
  return {
    ...logFieldInput(field),
    required: field.required,
    constraints: constraints === "{}" ? "" : constraints,
  };
};

/** The `thingTypeId` of a row's constraints, or "" while they are not a reference's. */
const thingTypeOf = (constraints: string): string => {
  try {
    return JSON.parse(constraints).thingTypeId ?? "";
  } catch {
    return "";
  }
};

const toInput = ({ constraints, ...row }: FieldRow): LogFieldInput => ({
  ...row,
  constraints: constraints.trim() === "" ? undefined : JSON.parse(constraints),
});

function LogTypeForm({
  db,
  types,
  onCreate,
}: {
  db: Database;
  types: LogType[];
  onCreate: (name: string, parentTypeId: string | null, fields: LogFieldInput[]) => void;
}) {
  const [name, setName] = useState("");
  const [parentTypeId, setParentTypeId] = useState("");
  const [rows, setRows] = useState<FieldRow[]>([]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCreate(name, parentTypeId || null, rows.map(toInput));
    setName("");
    setRows([]);
  };
  return (
    <form onSubmit={submit}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New log type" />{" "}
      <select value={parentTypeId} onChange={(e) => setParentTypeId(e.target.value)}>
        <option value="">Top level</option>
        {types.map((t) => (
          <option key={t.id} value={t.id}>
            Inside {t.name}
          </option>
        ))}
      </select>
      <FieldsEditor db={db} rows={rows} setRows={setRows} />
      <button type="submit">Add type</button>
    </form>
  );
}

function FieldsEditor({
  db,
  rows,
  setRows,
}: {
  db: Database;
  rows: FieldRow[];
  setRows: (rows: FieldRow[]) => void;
}) {
  const thingTypes = useThingTypes(db);
  const change = (i: number, patch: Partial<FieldRow>) =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <ol>
      {rows.map((row, i) => (
        // New rows have no id yet; the inputs are controlled, so an index key is safe.
        <li key={row.id ?? i}>
          <input
            value={row.name}
            onChange={(e) => change(i, { name: e.target.value })}
            placeholder="Field name"
          />{" "}
          <select
            value={row.valueType}
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
              checked={row.required}
              onChange={(e) => change(i, { required: e.target.checked })}
            />{" "}
            required
          </label>{" "}
          {row.valueType === "ref" || row.valueType === "multi_ref" ? (
            <select
              value={thingTypeOf(row.constraints)}
              onChange={(e) =>
                change(i, { constraints: JSON.stringify({ thingTypeId: e.target.value }) })
              }
            >
              <option value="">Thing type…</option>
              {thingTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={row.constraints}
              onChange={(e) => change(i, { constraints: e.target.value })}
              placeholder={
                row.valueType === "enum"
                  ? '{"options":[{"key":"a","order":1}]}'
                  : "Constraints (JSON)"
              }
            />
          )}{" "}
          <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))}>
            Remove
          </button>
        </li>
      ))}
      <li>
        <button type="button" onClick={() => setRows([...rows, newRow()])}>
          Add field
        </button>
      </li>
    </ol>
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
  const fields = useVersionFields(db, type.id, type.schemaVersion, version);
  const [rows, setRows] = useState<FieldRow[] | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [trashedEntries, setTrashedEntries] = useState<LogEntry[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` triggers the reload.
  useEffect(() => {
    Promise.all([listLogEntries(db, type.id), listLogEntries(db, type.id, { trashed: true })]).then(
      ([live, trash]) => {
        setEntries(live);
        setTrashedEntries(trash);
      },
    );
  }, [db, type.id, version]);

  const move = (i: number, by: number) => {
    const ids = fields.map((f) => f.id);
    [ids[i], ids[i + by]] = [ids[i + by], ids[i]];
    run(() => reorderLogFields(db, type.id, ids));
  };
  const parent = types.find((t) => t.id === type.parentTypeId);

  return (
    <div>
      <h3>
        {type.name} <small>(version {type.schemaVersion})</small>
      </h3>

      <h4>Fields</h4>
      {rows === null ? (
        <>
          <ol>
            {fields.map((f, i) => (
              <li key={f.id}>
                {f.name}: {f.shape.valueType}
                {f.required && " (required)"}{" "}
                <button type="button" disabled={i === 0} onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button type="button" disabled={i === fields.length - 1} onClick={() => move(i, 1)}>
                  ↓
                </button>
              </li>
            ))}
          </ol>
          <button type="button" onClick={() => setRows(fields.map(toRow))}>
            Revise fields
          </button>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(() => reviseLogTypeFields(db, type.id, rows.map(toInput)));
            setRows(null);
          }}
        >
          <FieldsEditor db={db} rows={rows} setRows={setRows} />
          <button type="submit">Save</button>{" "}
          <button type="button" onClick={() => setRows(null)}>
            Cancel
          </button>
        </form>
      )}

      <h4>Entries</h4>
      {parent ? (
        <p>
          <small>Entries of this type are added inside a {parent.name} entry.</small>
        </p>
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
      <ul>
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
      </ul>
      <Trash
        items={trashedEntries.map((e) => ({
          id: e.id,
          label: formatTime(e),
          deletionId: e.deletionId,
        }))}
        onRestore={(deletionId) => run(() => restoreLogRecords(db, deletionId))}
      />
    </div>
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
  /** A child entry's place among its live siblings, 1 first. */
  place?: { index: number; count: number };
  version: number;
  run: Run;
}) {
  const fields = useVersionFields(db, entry.logTypeId, entry.logTypeVersion, version);
  const titles = useRefTitles(db, fields, entry);
  const [children, setChildren] = useState<LogEntry[]>([]);
  const childTypes = types.filter((t) => t.parentTypeId === entry.logTypeId);

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
    <li>
      {place && `#${place.index} `}
      {formatTime(entry)}{" "}
      <small>
        ({entry.resolved.timeZone}, day {entry.day ?? "none"})
      </small>{" "}
      {fields
        .filter((f) => f.id in entry.values)
        .map((f) => `${f.name}: ${show(f, entry.values[f.id])}`)
        .join(" · ")}{" "}
      {place && (
        <>
          <button
            type="button"
            disabled={place.index === 1}
            onClick={() => run(() => moveChildEntry(db, entry.id, place.index - 1))}
          >
            ↑
          </button>
          <button
            type="button"
            disabled={place.index === place.count}
            onClick={() => run(() => moveChildEntry(db, entry.id, place.index + 1))}
          >
            ↓
          </button>{" "}
        </>
      )}
      <button type="button" onClick={() => run(() => deleteLogEntry(db, entry.id))}>
        Delete
      </button>
      {(children.length > 0 || childTypes.length > 0) && (
        <ul>
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
              <li key={t.id}>
                <ChildEntryForm
                  db={db}
                  type={t}
                  parentEntryId={entry.id}
                  run={run}
                  version={version}
                />
              </li>
            ))}
        </ul>
      )}
    </li>
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
  const fields = useVersionFields(db, type.id, type.schemaVersion, version);
  return (
    <>
      {type.name}:{" "}
      <EntryForm
        db={db}
        fields={fields}
        child
        onCreate={(_, values) =>
          run(() => createLogEntry(db, { logTypeId: type.id, parentEntryId, values }))
        }
      />
    </>
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
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
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
    // `datetime-local` values parse as device-local time.
    const time = child
      ? {}
      : {
          occurredAt: new Date(start).getTime(),
          endedAt: end ? new Date(end).getTime() : null,
          precision,
        };
    onCreate(time, values);
    setInputs({});
  };

  return (
    <form onSubmit={submit} style={{ display: "inline" }}>
      {!child && (
        <>
          <input
            type="datetime-local"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            required
          />{" "}
          →{" "}
          <input
            type="datetime-local"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            title="Optional end"
          />{" "}
          <select value={precision} onChange={(e) => setPrecision(e.target.value as Precision)}>
            {PRECISIONS.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>{" "}
        </>
      )}
      {fields.map((field) => (
        <span key={field.id}>
          {field.name}
          {field.required && "*"}{" "}
          <ValueInput
            db={db}
            field={field}
            value={inputs[field.id] ?? (field.shape.valueType === "multi_ref" ? [] : "")}
            onChange={(v) => setInputs({ ...inputs, [field.id]: v })}
          />{" "}
        </span>
      ))}
      <button type="submit">Add</button>
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
  switch (shape.valueType) {
    case "boolean":
      return (
        <select value={text} onChange={(e) => onChange(e.target.value)}>
          <option value="">–</option>
          <option value="true">yes</option>
          <option value="false">no</option>
        </select>
      );
    case "number":
      return (
        <input type="number" step="any" value={text} onChange={(e) => onChange(e.target.value)} />
      );
    case "enum":
      return (
        <select value={text} onChange={(e) => onChange(e.target.value)}>
          <option value="">–</option>
          {shape.constraints.options.map((o) => (
            <option key={o.key} value={o.key}>
              {optionLabel(field.optionLabels, o.key)}
            </option>
          ))}
        </select>
      );
    case "date":
      return <input type="date" value={text} onChange={(e) => onChange(e.target.value)} />;
    case "datetime":
      return (
        <input type="datetime-local" value={text} onChange={(e) => onChange(e.target.value)} />
      );
    case "ref":
      return (
        <select value={text} onChange={(e) => onChange(e.target.value)}>
          <option value="">–</option>
          {things.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      );
    case "multi_ref":
      return (
        <select
          multiple
          value={value as string[]}
          onChange={(e) => onChange([...e.target.selectedOptions].map((o) => o.value))}
        >
          {things.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      );
    default:
      return <input value={text} onChange={(e) => onChange(e.target.value)} />;
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
      return new Date(input as string).getTime();
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

function useVersionFields(db: Database, typeId: string, schemaVersion: number, reload: number) {
  const [fields, setFields] = useState<LogField[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `reload` triggers the reload.
  useEffect(() => {
    getLogTypeVersionFields(db, typeId, schemaVersion).then(setFields);
  }, [db, typeId, schemaVersion, reload]);
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

/** The titles of the things an entry refers to, deleted ones included. */
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
