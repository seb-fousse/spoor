import { Kbd, Tooltip } from "@mantine/core";
import { cloneElement, Fragment, type ReactElement } from "react";
import { describeShortcut } from "./format";
import type { ShortcutId } from "./shortcuts";

interface ShortcutTooltipProps {
  /** The shortcut that does what `children` does; without one, `children` renders as it is. */
  shortcut: ShortcutId | undefined;
  /** One element that takes a ref, such as a button. */
  children: ReactElement<{ "aria-keyshortcuts"?: string }>;
}

/**
 * Shows `shortcut` in a tooltip under `children` on hover, one `Kbd` per key
 * joined with "+" (⌥ + ←, or a lone ← for a single key), and tells assistive
 * tech about it with `aria-keyshortcuts`.
 */
export function ShortcutTooltip({ shortcut, children }: ShortcutTooltipProps) {
  if (!shortcut) return children;
  const { keys, ariaKeys } = describeShortcut(shortcut);
  return (
    <Tooltip
      label={
        // Kept left-to-right whatever the page's direction.
        <span dir="ltr">
          {keys.map((key, i) => (
            <Fragment key={key}>
              {i > 0 && " + "}
              <Kbd>{key}</Kbd>
            </Fragment>
          ))}
        </span>
      }
      position="bottom"
      withArrow={false}
      openDelay={250}
    >
      {cloneElement(children, { "aria-keyshortcuts": ariaKeys })}
    </Tooltip>
  );
}
