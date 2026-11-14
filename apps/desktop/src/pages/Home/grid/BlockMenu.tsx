import { Icon } from "@components/Icon";
import { describeShortcut, type ShortcutId, shortcutLabel } from "@keyboard";
import { Kbd, Menu } from "@mantine/core";
import type { CSSProperties, ReactNode } from "react";
import classes from "./TimelineGrid.module.css";

/**
 * The keys that do what a menu item does: the first shown by the item, and
 * all of them given to `aria-keyshortcuts`.
 */
function keysOf(first: ShortcutId, ...more: ShortcutId[]) {
  return {
    label: shortcutLabel(first),
    aria: [first, ...more].map((id) => describeShortcut(id).ariaKeys).join(" "),
  };
}

const DELETE_KEYS = keysOf("deleteBlock", "deleteBlockForward");
const COPY_KEYS = keysOf("copyBlock");
const SPLIT_KEYS = keysOf("splitBlock");
const PASTE_KEYS = keysOf("pasteBlock");

/** An item's keys, on its right. */
function itemKeys(keys: { label: string; aria: string }) {
  return {
    rightSection: <Kbd className={classes.menuKey}>{keys.label}</Kbd>,
    "aria-keyshortcuts": keys.aria,
  };
}

interface GridMenuProps {
  /** Where the menu opens: the pointer, as a fraction down the day and pixels from the sub-column's left. */
  top: number;
  left: number;
  /** Esc, a click outside, or a pick: the menu closes. */
  onClose: () => void;
}

/** A menu on the grid, open at the pointer in a sub-column. */
function GridMenu({ top, left, onClose, children }: GridMenuProps & { children: ReactNode }) {
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
      <Menu.Dropdown>{children}</Menu.Dropdown>
    </Menu>
  );
}

interface BlockMenuProps extends GridMenuProps {
  /** "Split at 10:30", or `null` when the block can't be split there. */
  splitLabel: string | null;
  onSplit: () => void;
  /** Copies the block, or `null` when it can't be: it is ongoing, so it has no length yet. */
  onCopy: (() => void) | null;
  /** Deletes the block, at once. */
  onDelete: () => void;
}

/**
 * The menu releasing the right button on a block opens, at the pointer (see
 * `useSplitAim`). "Split" cuts the block in two at the 15-minute mark nearest
 * the pointer; it is disabled when no mark falls inside the block. "Copy"
 * copies it, to paste elsewhere (see `PasteMenu`); it is disabled for an
 * ongoing block. "Delete block" deletes it at once. Each item shows the key
 * that does the same on a selected block (C splits it at the pointer).
 */
export function BlockMenu({ splitLabel, onSplit, onCopy, onDelete, ...menu }: BlockMenuProps) {
  return (
    <GridMenu {...menu}>
      <Menu.Item
        leftSection={<ScissorsIcon />}
        {...itemKeys(SPLIT_KEYS)}
        disabled={splitLabel === null}
        title={splitLabel === null ? "No 15-minute mark inside the block here" : undefined}
        onClick={onSplit}
      >
        {splitLabel ?? "Split"}
      </Menu.Item>
      <Menu.Item
        leftSection={<CopyIcon />}
        {...itemKeys(COPY_KEYS)}
        disabled={onCopy === null}
        title={onCopy === null ? "An ongoing block has no length to copy" : undefined}
        onClick={onCopy ?? undefined}
      >
        Copy
      </Menu.Item>
      <Menu.Divider />
      <Menu.Item
        color="red"
        leftSection={<TrashIcon />}
        {...itemKeys(DELETE_KEYS)}
        onClick={onDelete}
      >
        Delete block
      </Menu.Item>
    </GridMenu>
  );
}

interface PasteMenuProps extends GridMenuProps {
  /** "Paste at 14:00", where the paste lands, or why it can't be pasted here. */
  paste: { label: string } | { reason: string };
  onPaste: () => void;
}

/**
 * The menu a right click in an empty stretch of a sub-column opens, at the
 * pointer (see `usePasteMenu`). "Paste at 14:00" draws the copied block
 * there, or at the nearest spot where it fits; it is disabled, saying why,
 * when it can't be pasted here. It shows the key that pastes at the pointer.
 */
export function PasteMenu({ paste, onPaste, ...menu }: PasteMenuProps) {
  const refused = "reason" in paste;
  return (
    <GridMenu {...menu}>
      <Menu.Item
        leftSection={<ClipboardIcon />}
        {...itemKeys(PASTE_KEYS)}
        disabled={refused}
        title={refused ? paste.reason : undefined}
        onClick={onPaste}
      >
        {refused ? "Paste" : paste.label}
      </Menu.Item>
    </GridMenu>
  );
}

/** The menu items' icons, 14px. */
const ICON_SIZE = 14;

/** A bin. */
function TrashIcon() {
  return (
    <Icon size={ICON_SIZE}>
      <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </Icon>
  );
}

/** Open scissors. */
function ScissorsIcon() {
  return (
    <Icon size={ICON_SIZE}>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
    </Icon>
  );
}

/** Two overlapping sheets. */
function CopyIcon() {
  return (
    <Icon size={ICON_SIZE}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Icon>
  );
}

/** A clipboard. */
function ClipboardIcon() {
  return (
    <Icon size={ICON_SIZE}>
      <rect x="8" y="2" width="8" height="4" rx="1" />
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    </Icon>
  );
}
