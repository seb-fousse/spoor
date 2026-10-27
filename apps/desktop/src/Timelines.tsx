import {
  createCategory,
  createInterval,
  createTimeline,
  type Database,
  deleteCategory,
  deleteInterval,
  deleteTimeline,
  listCategories,
  listIntervals,
  listTimelines,
  restoreTimelineRecords,
  setCategoryArchived,
  setTimelineArchived,
  startInterval,
  stopInterval,
  type Timeline,
  type TimelineCategory,
  type TimelineInterval,
} from "@spoor/core";
import { type FormEvent, useEffect, useState } from "react";

/**
 * Proof-of-concept Timelines screen: every core read and write, wired to plain
 * HTML controls. Its only job is to show the slice works end to end over IPC;
 * the real UI replaces it.
 */
export function Timelines({ db }: { db: Database }) {
  const [timelines, setTimelines] = useState<Timeline[]>([]);
  const [trashed, setTrashed] = useState<Timeline[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // Runs a write, shows any error, and reloads everything.
  const run = (action: () => Promise<unknown>) => {
    setError(null);
    action()
      .catch((e: Error) => setError(e.message))
      .finally(() => setVersion((v) => v + 1));
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` triggers the reload.
  useEffect(() => {
    Promise.all([listTimelines(db), listTimelines(db, { trashed: true })])
      .then(([live, trash]) => {
        setTimelines(live);
        setTrashed(trash);
      })
      .catch((e: Error) => setError(e.message));
  }, [db, version]);

  const selected = timelines.find((t) => t.id === selectedId);

  return (
    <section className="timelines">
      <h2>Timelines</h2>
      {error && <p className="error">{error}</p>}

      <TimelineForm
        onCreate={(name, exclusive) => run(() => createTimeline(db, { name, exclusive }))}
      />
      <ul>
        {timelines.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => setSelectedId(t.id)}>
              {t.id === selectedId ? <strong>{t.name}</strong> : t.name}
            </button>{" "}
            {t.exclusive ? "exclusive" : "non-exclusive"}
            {t.archivedAt !== null && " · archived"}{" "}
            <button
              type="button"
              onClick={() => run(() => setTimelineArchived(db, t.id, t.archivedAt === null))}
            >
              {t.archivedAt === null ? "Archive" : "Unarchive"}
            </button>{" "}
            <button type="button" onClick={() => run(() => deleteTimeline(db, t.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>
      <Trash
        items={trashed.map((t) => ({ id: t.id, label: t.name, deletionId: t.deletionId }))}
        onRestore={(deletionId) => run(() => restoreTimelineRecords(db, deletionId))}
      />

      {selected && <TimelineDetail db={db} timeline={selected} version={version} run={run} />}
    </section>
  );
}

function TimelineForm({ onCreate }: { onCreate: (name: string, exclusive: boolean) => void }) {
  const [name, setName] = useState("");
  const [exclusive, setExclusive] = useState(true);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onCreate(name, exclusive);
    setName("");
  };
  return (
    <form onSubmit={submit}>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New timeline" />
      <label>
        <input
          type="checkbox"
          checked={exclusive}
          onChange={(e) => setExclusive(e.target.checked)}
        />{" "}
        exclusive
      </label>{" "}
      <button type="submit">Add</button>
    </form>
  );
}

function TimelineDetail({
  db,
  timeline,
  version,
  run,
}: {
  db: Database;
  timeline: Timeline;
  version: number;
  run: (action: () => Promise<unknown>) => void;
}) {
  const [categories, setCategories] = useState<TimelineCategory[]>([]);
  const [trashedCategories, setTrashedCategories] = useState<TimelineCategory[]>([]);
  const [intervals, setIntervals] = useState<TimelineInterval[]>([]);
  const [trashedIntervals, setTrashedIntervals] = useState<TimelineInterval[]>([]);
  const [categoryName, setCategoryName] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` triggers the reload.
  useEffect(() => {
    Promise.all([
      listCategories(db, timeline.id),
      listCategories(db, timeline.id, { trashed: true }),
      listIntervals(db, timeline.id),
      listIntervals(db, timeline.id, { trashed: true }),
    ]).then(([c, tc, i, ti]) => {
      setCategories(c);
      setTrashedCategories(tc);
      setIntervals(i);
      setTrashedIntervals(ti);
    });
  }, [db, timeline.id, version]);

  // Trashed intervals may belong to trashed categories, so look in both lists.
  const names = new Map([...categories, ...trashedCategories].map((c) => [c.id, c.name]));
  const describe = (i: TimelineInterval) =>
    `${names.get(i.categoryId) ?? "?"}: ${formatTime(i.startAt)} → ${i.endAt === null ? "ongoing" : formatTime(i.endAt)}`;

  const addCategory = (e: FormEvent) => {
    e.preventDefault();
    run(() => createCategory(db, timeline.id, { name: categoryName }));
    setCategoryName("");
  };

  return (
    <div>
      <h3>{timeline.name}</h3>

      <h4>Categories</h4>
      <form onSubmit={addCategory}>
        <input
          value={categoryName}
          onChange={(e) => setCategoryName(e.target.value)}
          placeholder="New category"
        />{" "}
        <button type="submit">Add</button>
      </form>
      <ul>
        {categories.map((c) => (
          <li key={c.id}>
            {c.name}
            {c.archivedAt !== null && " · archived"}{" "}
            <button type="button" onClick={() => run(() => startInterval(db, c.id))}>
              Start now
            </button>{" "}
            <button
              type="button"
              onClick={() => run(() => setCategoryArchived(db, c.id, c.archivedAt === null))}
            >
              {c.archivedAt === null ? "Archive" : "Unarchive"}
            </button>{" "}
            <button type="button" onClick={() => run(() => deleteCategory(db, c.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>

      <h4>Intervals</h4>
      <IntervalForm
        categories={categories}
        onCreate={(categoryId, startAt, endAt) =>
          run(() => createInterval(db, { categoryId, startAt, endAt }))
        }
      />
      <ul>
        {intervals.map((i) => (
          <li key={i.id}>
            {describe(i)} <small>({i.timeZone})</small>{" "}
            {i.endAt === null && (
              <button type="button" onClick={() => run(() => stopInterval(db, i.id))}>
                Stop
              </button>
            )}{" "}
            <button type="button" onClick={() => run(() => deleteInterval(db, i.id))}>
              Delete
            </button>
          </li>
        ))}
      </ul>

      <Trash
        items={[
          ...trashedCategories.map((c) => ({
            id: c.id,
            label: `Category ${c.name}`,
            deletionId: c.deletionId,
          })),
          ...trashedIntervals.map((i) => ({
            id: i.id,
            label: describe(i),
            deletionId: i.deletionId,
          })),
        ]}
        onRestore={(deletionId) => run(() => restoreTimelineRecords(db, deletionId))}
      />
    </div>
  );
}

function IntervalForm({
  categories,
  onCreate,
}: {
  categories: TimelineCategory[];
  onCreate: (categoryId: string, startAt: number, endAt: number | null) => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // `datetime-local` values parse as device-local time.
    onCreate(categoryId, new Date(start).getTime(), end ? new Date(end).getTime() : null);
  };
  return (
    <form onSubmit={submit}>
      <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
        <option value="">Category…</option>
        {categories
          .filter((c) => c.archivedAt === null)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
      </select>{" "}
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
        title="Empty: ongoing"
      />{" "}
      <button type="submit">Add</button>
    </form>
  );
}

export function Trash({
  items,
  onRestore,
}: {
  items: { id: string; label: string; deletionId: string | null }[];
  onRestore: (deletionId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <details>
      <summary>Trash ({items.length})</summary>
      <ul>
        {items.map((item) => (
          <li key={item.id}>
            {item.label}{" "}
            <button type="button" onClick={() => item.deletionId && onRestore(item.deletionId)}>
              Restore
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

function formatTime(instant: number): string {
  return new Date(instant).toLocaleString();
}
