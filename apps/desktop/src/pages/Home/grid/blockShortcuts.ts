import { ownsKey, shortcutHandler } from "@keyboard";
import { IS_MAC } from "@platform/os";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

interface BlockKeys {
  /** Asks to delete the block (it confirms first). */
  onDelete: () => void;
  /** Copies the block, to paste elsewhere. */
  onCopy: () => void;
  /** Opens the block's category popover. */
  onOpen: () => void;
  /** Drops the selection. */
  onDeselect: () => void;
}

/**
 * The keys of a selected block on Home's grid, for its focused segment:
 * ⌫ or Delete asks to delete it, ⌘C (Ctrl+C elsewhere) copies it, Enter
 * opens its popover, Esc deselects it.
 * Each key it handles is taken with `preventDefault`. A key a field needs,
 * such as ⌫ in a text field, is never handled.
 */
export function blockKeyHandler(
  { onDelete, onCopy, onOpen, onDeselect }: BlockKeys,
  mac = IS_MAC,
): (event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>) => void {
  const shortcuts = shortcutHandler(
    [
      ["deleteBlock", onDelete],
      ["deleteBlockForward", onDelete],
      ["copyBlock", onCopy],
    ],
    mac,
  );
  return (event) => {
    if (event.defaultPrevented || ownsKey(event.target, event.key)) return;
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (plain && event.key === "Enter") {
      event.preventDefault();
      onOpen();
    } else if (plain && event.key === "Escape") {
      event.preventDefault();
      onDeselect();
    } else {
      shortcuts(event);
    }
  };
}
