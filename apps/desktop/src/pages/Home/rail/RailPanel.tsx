import { Alert, Loader } from "@mantine/core";
import { type ReactNode, useId } from "react";
import classes from "./RailPanel.module.css";

interface RailPanelProps {
  title: string;
  /** Beside the title, such as "3/7 recorded". Left out until there is one. */
  count?: ReactNode;
  /** At the header's right edge, such as a button to add one. */
  action?: ReactNode;
  /** A failed load or save, shown at the top of the body. */
  error: { title: string; message: string } | null;
  /** Nothing has loaded yet, and nothing has failed. */
  loading: boolean;
  /** Shown above the list, such as a note that there is nothing yet. */
  empty?: ReactNode;
  /** The list shows another day's items while the active day's load: shown, but not usable. */
  stale: boolean;
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
  error,
  loading,
  empty,
  stale,
  listClassName,
  children,
}: RailPanelProps) {
  const titleId = useId();
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
        {error && (
          <Alert color="red" title={error.title}>
            {error.message}
          </Alert>
        )}
        {loading && <Loader size="sm" />}
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
