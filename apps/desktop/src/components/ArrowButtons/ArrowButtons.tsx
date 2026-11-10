import { ActionIcon } from "@mantine/core";
import classes from "./ArrowButtons.module.css";

interface ArrowButtonsProps {
  backLabel: string;
  forwardLabel: string;
  onBack: () => void;
  onForward: () => void;
  canGoBack?: boolean;
  canGoForward?: boolean;
  /** Extra class on the pair, such as to move its divider to the other side. */
  className?: string;
}

/**
 * A ‹ › pair for the app's bars (bottom bar history, Home's date headers),
 * filling the bar's height. Shared so every pair looks and behaves the same.
 */
export function ArrowButtons({
  backLabel,
  forwardLabel,
  onBack,
  onForward,
  canGoBack = true,
  canGoForward = true,
  className,
}: ArrowButtonsProps) {
  return (
    <div className={className ? `${classes.root} ${className}` : classes.root}>
      <ActionIcon
        aria-label={backLabel}
        className={classes.button}
        disabled={!canGoBack}
        onClick={onBack}
      >
        ‹
      </ActionIcon>
      <ActionIcon
        aria-label={forwardLabel}
        className={classes.button}
        disabled={!canGoForward}
        onClick={onForward}
      >
        ›
      </ActionIcon>
    </div>
  );
}
