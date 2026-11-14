import { describeValues, formatTime } from "@components/LogEntryForm";
import { EMPTY_FIELDS, useDayLogs, useFields } from "@data/logs";
import type { ReadResult } from "@data/readResult";
import { useTimeZone } from "@data/settings";
import { EMPTY_TITLES, useRefTitles } from "@data/things";
import { Button, Text } from "@mantine/core";
import type { DayLogEntry, LocalDate } from "@spoor/core";
import { useState } from "react";
import { RailPanel } from "../rail/RailPanel";
import classes from "./LogRail.module.css";
import { NewLogModal } from "./NewLogModal";

interface LogRailProps {
  /** The active day, whose logs are listed and which new entries start on. */
  day: LocalDate;
}

/** The day's logs by log type, with a modal card to add one. */
export function LogRail({ day }: LogRailProps) {
  const [modalOpen, setModalOpen] = useState(false);
  // While the active day's list loads, the previous day's shows, stale.
  const logs = useDayLogs(day);
  // Datetime values show in the `time_zone` setting, so, like the grid, the
  // list waits for the zone, and a zone that fails to load is the rail's error.
  const zone = useTimeZone();
  const timeZone = zone.data;
  const data = timeZone !== undefined ? logs.data : undefined;
  const error = logs.error ?? zone.error;
  const read: Pick<ReadResult<unknown>, "status" | "error" | "isPlaceholderData"> = {
    status: error ? "error" : data === undefined ? "pending" : "success",
    error,
    isPlaceholderData: logs.isPlaceholderData,
  };
  const groups = data ?? [];

  const count = groups.reduce((n, g) => n + g.entries.length, 0);
  const open = () => setModalOpen(true);

  return (
    <>
      <RailPanel
        title="Logs"
        count={data !== undefined ? count : undefined}
        action={
          <Button size="compact-xs" variant="default" onClick={open}>
            New
          </Button>
        }
        read={read}
        errorTitle="Could not load logs"
        empty={
          data !== undefined &&
          groups.length === 0 && (
            <div className={classes.empty}>
              <Text c="dimmed">No logs created yet.</Text>
              <Button size="xs" variant="light" onClick={open}>
                Create one
              </Button>
            </div>
          )
        }
        listClassName={classes.groups}
      >
        {timeZone !== undefined &&
          groups.map(({ logType, entries }) => (
            <section key={logType.id} className={classes.group} aria-label={logType.name}>
              <h3 className={classes.groupTitle}>{logType.name}</h3>
              <ul className={classes.entries}>
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <EntryRow entry={entry} timeZone={timeZone} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
      </RailPanel>

      <NewLogModal opened={modalOpen} day={day} onClose={() => setModalOpen(false)} />
    </>
  );
}

/** `timeZone`: the `time_zone` setting, which datetime values show in. */
function EntryRow({ entry, timeZone }: { entry: DayLogEntry; timeZone: string }) {
  // Field definitions never change under the rail, so they load once per entry.
  const fields = useFields(entry.logTypeId).data ?? EMPTY_FIELDS;
  const titles = useRefTitles(fields, entry).data ?? EMPTY_TITLES;
  const values = describeValues(fields, entry, titles, timeZone);
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
              <ChildRow child={child} timeZone={timeZone} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChildRow({
  child,
  timeZone,
}: {
  child: DayLogEntry["children"][number];
  timeZone: string;
}) {
  const fields = useFields(child.logTypeId).data ?? EMPTY_FIELDS;
  const titles = useRefTitles(fields, child).data ?? EMPTY_TITLES;
  return (
    <span className={classes.values}>{describeValues(fields, child, titles, timeZone) || "·"}</span>
  );
}
