import { Menu } from "@mantine/core";
import type { CSSProperties } from "react";
import classes from "./TimelineGrid.module.css";

interface BlockMenuProps {
  /** Where the menu opens: the pointer, as a fraction down the day and pixels from the sub-column's left. */
  top: number;
  left: number;
  /** "Split at 10:30", or `null` when the block can't be split there. */
  splitLabel: string | null;
  onSplit: () => void;
  /** Esc, a click outside, or a pick: the menu closes. */
  onClose: () => void;
}

/**
 * The menu releasing the right button on a block opens, at the pointer (see
 * `useSplitAim`). Its one item cuts
 * the block in two at the 15-minute mark nearest the pointer; it is disabled
 * when no mark falls inside the block.
 */
export function BlockMenu({ top, left, splitLabel, onSplit, onClose }: BlockMenuProps) {
  return (
    <Menu
      opened
      onChange={(opened) => {
        if (!opened) onClose();
      }}
      position="bottom-start"
      offset={2}
      shadow="md"
      width={180}
    >
      <Menu.Target>
        <div
          className={classes.menuAnchor}
          style={{ "--top": top, "--left": `${left}px` } as CSSProperties}
        />
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item
          leftSection={<ScissorsIcon />}
          disabled={splitLabel === null}
          title={splitLabel === null ? "No 15-minute mark inside the block here" : undefined}
          onClick={onSplit}
        >
          {splitLabel ?? "Split"}
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/** Open scissors, drawn like the app's other inline icons. */
function ScissorsIcon() {
  return (
    <svg
      aria-hidden="true"
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
    </svg>
  );
}
