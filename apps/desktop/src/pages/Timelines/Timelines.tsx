import { effect, useConfirmDelete } from "@components/ConfirmDelete";
import { useTimelineDetail, useTimelineList, useTimelinesWrite } from "@data/timelines";
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
import { useDatabase } from "@platform/DatabaseProvider";
import {
  createCategory,
  createInterval,
  createTimeline,
  deleteCategory,
  deleteInterval,
  deleteTimeline,
  previewCategoryDeletion,
  previewTimelineDeletion,
  setCategoryArchived,
  setTimelineArchived,
  startInterval,
  stopInterval,
  type Timeline,
  type TimelineCategory,
  type TimelineInterval,
} from "@spoor/core";
import dayjs from "dayjs";
import { type FormEvent, useState } from "react";

/**
 * Proof-of-concept Timelines screen: every core read and write, built from
 * plain Mantine components. Its only job is to show the slice works end to end
 * over IPC; the real UI replaces it.
 */
export function Timelines() {
  const db = useDatabase();
  const list = useTimelineList();
  const timelines = list.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const write = useTimelinesWrite();

  // Runs a write; the mutation shows any error and reloads what it changed.
  const run = (action: () => Promise<unknown>) => write.mutate(action);
  // The last write's error (cleared by the next write), else the list's.
  const error = write.error?.message ?? list.error?.message ?? null;

  const [confirmDelete, deleteDialog] = useConfirmDelete(run);

  const selected = timelines.find((t) => t.id === selectedId);
  const askDelete = (t: Timeline) =>
    confirmDelete(
      `the ${t.name} timeline`,
      () => deleteTimeline(db, t.id),
      async () => {
        const n = await previewTimelineDeletion(db, t.id);
        return [
          effect("deletes", n.categories, "category", "categories"),
          effect("deletes", n.intervals, "interval"),
        ];
      },
    );

  return (
    <Stack component="section" gap="sm">
      <Title order={2}>Timelines</Title>
      {error && <Alert color="red">{error}</Alert>}
      {deleteDialog}

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
            <Button size="xs" variant="light" color="red" onClick={() => askDelete(t)}>
              Delete
            </Button>
          </Group>
        ))}
      </Stack>

      {selected && <TimelineDetail timeline={selected} run={run} />}
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
  timeline,
  run,
}: {
  timeline: Timeline;
  run: (action: () => Promise<unknown>) => void;
}) {
  const db = useDatabase();
  const detail = useTimelineDetail(timeline.id);
  const categories = detail.categories.data ?? [];
  const intervals = detail.intervals.data ?? [];
  // The page's error shows write failures; these reads report their own.
  const readError = detail.categories.error ?? detail.intervals.error;
  const [categoryName, setCategoryName] = useState("");
  const [confirmDelete, deleteDialog] = useConfirmDelete(run);

  const names = new Map(categories.map((c) => [c.id, c.name]));
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
      {readError && <Alert color="red">{readError.message}</Alert>}
      {deleteDialog}

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
              onClick={() =>
                confirmDelete(
                  `the ${c.name} category`,
                  () => deleteCategory(db, c.id),
                  async () => [
                    effect(
                      "deletes",
                      (await previewCategoryDeletion(db, c.id)).intervals,
                      "interval",
                    ),
                  ],
                )
              }
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
              onClick={() =>
                confirmDelete(`the interval ${describe(i)}`, () => deleteInterval(db, i.id))
              }
            >
              Delete
            </Button>
          </Group>
        ))}
      </Stack>
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
