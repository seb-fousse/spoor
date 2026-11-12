import { describeValues, formatTime, useFields, useRefTitles } from "@components/LogEntryForm";
import { Alert, Button, Loader, Text } from "@mantine/core";
import type { Database, DayLogEntry, LocalDate } from "@spoor/core";
import { useState } from "react";
import classes from "./LogRail.module.css";
import { NewLogModal } from "./NewLogModal";
import { useDayLogs } from "./useDayLogs";

interface LogRailProps {
  db: Database;
  /** The active day, whose logs are listed and which new entries start on. */
  day: LocalDate;
}

/** The day's logs by log type, with a modal card to add one. */
export function LogRail({ db, day }: LogRailProps) {
  const [modalOpen, setModalOpen] = useState(false);
  // `stale`: the previous day's list, while the active day's loads.
  const { data, error, isPending: loading, isPlaceholderData: stale } = useDayLogs(db, day);
  const groups = data ?? [];

  const empty = data !== undefined && groups.length === 0;
  const count = groups.reduce((n, g) => n + g.entries.length, 0);
  const open = () => setModalOpen(true);

  return (
    <section className={classes.rail} aria-labelledby="logs-title">
      <header className={classes.header}>
        <h2 id="logs-title" className={classes.title}>
          Logs
        </h2>
        <span className={classes.count}>{data !== undefined && count}</span>
        <Button size="compact-xs" variant="default" onClick={open}>
          New
        </Button>
      </header>

      <div className={classes.body}>
        {error && (
          <Alert color="red" title="Could not load logs">
            {error.message}
          </Alert>
        )}
        {loading && <Loader size="sm" />}
        {empty && (
          <div className={classes.empty}>
            <Text c="dimmed">No logs created yet.</Text>
            <Button size="xs" variant="light" onClick={open}>
              Create one
            </Button>
          </div>
        )}
        {groups.length > 0 && (
          <div className={classes.groups} data-stale={stale || undefined} inert={stale}>
            {groups.map(({ logType, entries }) => (
              <section key={logType.id} className={classes.group} aria-label={logType.name}>
                <h3 className={classes.groupTitle}>{logType.name}</h3>
                <ul className={classes.entries}>
                  {entries.map((entry) => (
                    <li key={entry.id}>
                      <EntryRow db={db} entry={entry} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      <NewLogModal
        db={db}
        opened={modalOpen}
        day={day}
        onClose={() => setModalOpen(false)}
      />
    </section>
  );
}

function EntryRow({ db, entry }: { db: Database; entry: DayLogEntry }) {
  // Field definitions never change under the rail, so they load once per entry.
  const fields = useFields(db, entry.logTypeId);
  const titles = useRefTitles(db, fields, entry);
  const values = describeValues(fields, entry, titles);
  return (
    <div className={classes.entry}>
      {/* Entries are on the day the rail shows, so a time appears only for older ones that have one. */}
      {entry.resolved.precision === "instant" && (
        <span className={classes.time}>{formatTime(entry)}</span>
      )}
      <span className={classes.values}>{values || "No values"}</span>
      {entry.children.length > 0 && (
        <ul className={classes.children}>
          {entry.children.map((child) => (
            <li key={child.id}>
              <ChildRow db={db} child={child} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChildRow({ db, child }: { db: Database; child: DayLogEntry["children"][number] }) {
  const fields = useFields(db, child.logTypeId);
  const titles = useRefTitles(db, fields, child);
  return <span className={classes.values}>{describeValues(fields, child, titles) || "·"}</span>;
}
