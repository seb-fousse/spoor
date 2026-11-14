import type { ReadResult } from "@data/readResult";
import { Alert, Loader } from "@mantine/core";
import { type ReactNode, useId } from "react";
import classes from "./RailPanel.module.css";

interface RailPanelProps {
  title: string;
  /** Beside the title, such as "3/7 recorded". Left out until there is one. */
  count?: ReactNode;
  /** At the header's right edge, such as a button to add one. */
  action?: ReactNode;
  /**
   * The list's read: a query's result, or the fields of several combined. A
   * loader shows while it is `pending`, and its error at the top of the body.
   * While its data is a placeholder, the list shows another day's items until
   * the active day's load: shown, but not usable.
   */
  read: Pick<ReadResult<unknown>, "status" | "error" | "isPlaceholderData">;
  /** The title of a failed read's error, such as "Could not load logs". */
  errorTitle: string;
  /** Shown above the list, such as a note that there is nothing yet. */
  empty?: ReactNode;
  /** Laid out by the list, such as a column of cards. */
  listClassName: string;
  /** The list's items. */
  children: ReactNode;
}

/**
 * One half of Home's rail, the observations or the logs: a header with its
 * title, count and action, then a scrolling body with any error, a loader
 * while nothing has loaded, the empty state, and the list.
 */
export function RailPanel({
  title,
  count,
  action,
  read,
  errorTitle,
  empty,
  listClassName,
  children,
}: RailPanelProps) {
  const titleId = useId();
  const stale = read.isPlaceholderData;
  return (
    <section className={classes.rail} aria-labelledby={titleId}>
      <header className={classes.header}>
        <h2 id={titleId} className={classes.title}>
          {title}
        </h2>
        {count !== undefined && (
          <span className={classes.count} aria-live="polite">
            {count}
          </span>
        )}
        {action}
      </header>

      <div className={classes.body}>
        {read.error && (
          <Alert color="red" title={errorTitle}>
            {read.error.message}
          </Alert>
        )}
        {read.status === "pending" && <Loader size="sm" />}
        {empty}
        <div
          className={`${classes.list} ${listClassName}`}
          data-stale={stale || undefined}
          inert={stale}
        >
          {children}
        </div>
      </div>
    </section>
  );
}
