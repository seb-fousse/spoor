import { describeShortcut } from "@keyboard";
import { Kbd, Menu } from "@mantine/core";
import type { CSSProperties } from "react";
import classes from "./TimelineGrid.module.css";

/** The keys that delete a selected block: shown by "Delete block", which does the same. */
const DELETE_KEYS = {
  label: describeShortcut("deleteBlock").keys.join("+"),
  aria: [describeShortcut("deleteBlock"), describeShortcut("deleteBlockForward")]
    .map((d) => d.ariaKeys)
    .join(" "),
};

interface BlockMenuProps {
  /** Where the menu opens: the pointer, as a fraction down the day and pixels from the sub-column's left. */
  top: number;
  left: number;
  /** "Split at 10:30", or `null` when the block can't be split there. */
  splitLabel: string | null;
  onSplit: () => void;
  /** Asks to delete the block (it confirms first). */
  onDelete: () => void;
  /** Esc, a click outside, or a pick: the menu closes. */
  onClose: () => void;
}

/**
 * The menu releasing the right button on a block opens, at the pointer (see
 * `useSplitAim`). "Split" cuts the block in two at the 15-minute mark nearest
 * the pointer; it is disabled when no mark falls inside the block. "Delete
 * block" asks to delete it, and shows the key that does the same on a
 * selected block.
 */
export function BlockMenu({ top, left, splitLabel, onSplit, onDelete, onClose }: BlockMenuProps) {
  return (
    <Menu
      opened
      onChange={(opened) => {
        if (!opened) onClose();
      }}
      position="bottom-start"
      offset={2}
      shadow="md"
      width={200}
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
        <Menu.Divider />
        <Menu.Item
          color="red"
          leftSection={<TrashIcon />}
          rightSection={<Kbd className={classes.menuKey}>{DELETE_KEYS.label}</Kbd>}
          aria-keyshortcuts={DELETE_KEYS.aria}
          onClick={onDelete}
        >
          Delete block
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/** A bin, drawn like the app's other inline icons. */
function TrashIcon() {
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
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
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
