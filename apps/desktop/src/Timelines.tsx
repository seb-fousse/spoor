import {
  Alert,
  Button,
  Checkbox,
  Group,
  NativeSelect,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { DateTimePicker } from "@mantine/dates";
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
import dayjs from "dayjs";
import { type FormEvent, useEffect, useState } from "react";
import { Trash } from "./Trash";

/**
 * Proof-of-concept Timelines screen: every core read and write, built from
 * plain Mantine components. Its only job is to show the slice works end to end
 * over IPC; the real UI replaces it.
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
    <Stack component="section" gap="sm">
      <Title order={2}>Timelines</Title>
      {error && <Alert color="red">{error}</Alert>}

      <TimelineForm
        onCreate={(name, exclusive) => run(() => createTimeline(db, { name, exclusive }))}
      />
      <Stack gap={4}>
        {timelines.map((t) => (
          <Group key={t.id} gap="xs">
            <Button
              size="xs"
              variant={t.id === selectedId ? "light" : "subtle"}
              onClick={() => setSelectedId(t.id)}
            >
              {t.name}
            </Button>
            <Text size="sm" c="dimmed">
              {t.exclusive ? "exclusive" : "non-exclusive"}
              {t.archivedAt !== null && " · archived"}
            </Text>
            <Button
              size="xs"
              variant="default"
              onClick={() => run(() => setTimelineArchived(db, t.id, t.archivedAt === null))}
            >
              {t.archivedAt === null ? "Archive" : "Unarchive"}
            </Button>
            <Button
              size="xs"
              variant="light"
              color="red"
              onClick={() => run(() => deleteTimeline(db, t.id))}
            >
              Delete
            </Button>
          </Group>
        ))}
      </Stack>
      <Trash
        items={trashed.map((t) => ({ id: t.id, label: t.name, deletionId: t.deletionId }))}
        onRestore={(deletionId) => run(() => restoreTimelineRecords(db, deletionId))}
      />

      {selected && <TimelineDetail db={db} timeline={selected} version={version} run={run} />}
    </Stack>
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
      <Group gap="xs" align="center">
        <TextInput
          size="xs"
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="New timeline"
          aria-label="New timeline"
        />
        <Checkbox
          size="xs"
          label="exclusive"
          checked={exclusive}
          onChange={(e) => setExclusive(e.currentTarget.checked)}
        />
        <Button type="submit" size="xs">
          Add
        </Button>
      </Group>
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
    <Stack gap="sm">
      <Title order={3}>{timeline.name}</Title>

      <Title order={4}>Categories</Title>
      <form onSubmit={addCategory}>
        <Group gap="xs" align="flex-end">
          <TextInput
            size="xs"
            value={categoryName}
            onChange={(e) => setCategoryName(e.currentTarget.value)}
            placeholder="New category"
            aria-label="New category"
          />
          <Button type="submit" size="xs">
            Add
          </Button>
        </Group>
      </form>
      <Stack gap={4}>
        {categories.map((c) => (
          <Group key={c.id} gap="xs">
            <Text size="sm">{c.name}</Text>
            {c.archivedAt !== null && (
              <Text size="sm" c="dimmed">
                archived
              </Text>
            )}
            <Button size="xs" variant="default" onClick={() => run(() => startInterval(db, c.id))}>
              Start now
            </Button>
            <Button
              size="xs"
              variant="default"
              onClick={() => run(() => setCategoryArchived(db, c.id, c.archivedAt === null))}
            >
              {c.archivedAt === null ? "Archive" : "Unarchive"}
            </Button>
            <Button
              size="xs"
              variant="light"
              color="red"
              onClick={() => run(() => deleteCategory(db, c.id))}
            >
              Delete
            </Button>
          </Group>
        ))}
      </Stack>

      <Title order={4}>Intervals</Title>
      <IntervalForm
        categories={categories}
        onCreate={(categoryId, startAt, endAt) =>
          run(() => createInterval(db, { categoryId, startAt, endAt }))
        }
      />
      <Stack gap={4}>
        {intervals.map((i) => (
          <Group key={i.id} gap="xs">
            <Text size="sm">{describe(i)}</Text>
            <Text size="sm" c="dimmed">
              ({i.timeZone})
            </Text>
            {i.endAt === null && (
              <Button size="xs" variant="default" onClick={() => run(() => stopInterval(db, i.id))}>
                Stop
              </Button>
            )}
            <Button
              size="xs"
              variant="light"
              color="red"
              onClick={() => run(() => deleteInterval(db, i.id))}
            >
              Delete
            </Button>
          </Group>
        ))}
      </Stack>

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
    </Stack>
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
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // DateTimePicker values are "YYYY-MM-DD HH:mm:ss" strings, which dayjs parses as device-local time.
    onCreate(categoryId, dayjs(start).valueOf(), end ? dayjs(end).valueOf() : null);
  };
  return (
    <form onSubmit={submit}>
      <Group gap="xs" align="flex-end">
        {/* NativeSelect, not Select: Mantine's Select input is read-only, so `required` would not stop an empty submit. */}
        <NativeSelect
          size="xs"
          aria-label="Category"
          value={categoryId}
          onChange={(e) => setCategoryId(e.currentTarget.value)}
          required
          data={[
            { value: "", label: "Category…" },
            ...categories
              .filter((c) => c.archivedAt === null)
              .map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
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
          placeholder="Empty: ongoing"
          clearable
          value={end}
          onChange={setEnd}
        />
        {/* The pickers are not native inputs, so `required` cannot stop an empty start. */}
        <Button type="submit" size="xs" disabled={!start}>
          Add
        </Button>
      </Group>
    </form>
  );
}

function formatTime(instant: number): string {
  return new Date(instant).toLocaleString();
}
