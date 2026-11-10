import { ActionIcon, Kbd, Tooltip } from "@mantine/core";
import type { ReactElement } from "react";
import classes from "./ArrowButtons.module.css";

/** A keyboard shortcut that does what a button does. */
export interface Shortcut {
  /** As shown in the tooltip, such as "⌥←". */
  label: string;
  /** In `aria-keyshortcuts` form, such as "Alt+ArrowLeft". */
  ariaKeys: string;
}

interface ArrowButtonsProps {
  backLabel: string;
  forwardLabel: string;
  onBack: () => void;
  onForward: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  /** Keys that do the same as ‹, shown in a tooltip under it. */
  backShortcut?: Shortcut;
  /** Keys that do the same as ›, shown in a tooltip under it. */
  forwardShortcut?: Shortcut;
  /** Extra class on the pair, such as to move its divider to the other side. */
  className?: string;
}

/**
 * A ‹ › pair for the app's bars (bottom bar history, Home's date headers),
 * filling the bar's height. Shared so every pair looks and behaves the same.
 * A button with a shortcut shows it on hover.
 */
export function ArrowButtons({
  backLabel,
  forwardLabel,
  onBack,
  onForward,
  canGoBack = true,
  canGoForward = true,
  backShortcut,
  forwardShortcut,
  className,
}: ArrowButtonsProps) {
  return (
    <div className={className ? `${classes.root} ${className}` : classes.root}>
      <WithShortcut shortcut={backShortcut}>
        <ActionIcon
          aria-label={backLabel}
          aria-keyshortcuts={backShortcut?.ariaKeys}
          className={classes.button}
          disabled={!canGoBack}
          onClick={onBack}
        >
          ‹
        </ActionIcon>
      </WithShortcut>
      <WithShortcut shortcut={forwardShortcut}>
        <ActionIcon
          aria-label={forwardLabel}
          aria-keyshortcuts={forwardShortcut?.ariaKeys}
          className={classes.button}
          disabled={!canGoForward}
          onClick={onForward}
        >
          ›
        </ActionIcon>
      </WithShortcut>
    </div>
  );
}

/** `children` with a tooltip under it showing `shortcut`, or as it is without one. */
function WithShortcut({
  shortcut,
  children,
}: {
  shortcut: Shortcut | undefined;
  children: ReactElement;
}) {
  if (!shortcut) return children;
  return (
    <Tooltip
      label={<Kbd>{shortcut.label}</Kbd>}
      position="bottom"
      withArrow={false}
      openDelay={250}
    >
      {children}
    </Tooltip>
  );
}
