import { getHotkeyHandler } from "@mantine/hooks";
import { IS_MAC } from "@platform/os";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from "react";
import { ownsKey } from "./ownsKey";
import { hotkey, type ShortcutId } from "./shortcuts";

/** A shortcut and what it does. */
export type ShortcutBinding = [ShortcutId, (event: KeyboardEvent) => void];

/**
 * A keydown handler for an element that runs `bindings`, calling
 * `preventDefault` on the keys it handles. For keys that should only work
 * while that element has focus.
 */
export function shortcutHandler(
  bindings: ShortcutBinding[],
  mac = IS_MAC,
): (event: KeyboardEvent | ReactKeyboardEvent<HTMLElement>) => void {
  return getHotkeyHandler(bindings.map(([id, handler]) => [hotkey(id, mac), handler]));
}

/**
 * Runs `bindings` while the calling component is mounted, wherever focus is,
 * for a page's own shortcuts. Leaves alone keys a field or widget needs (see
 * `ownsKey`), and keys some other handler already took with `preventDefault`,
 * so an element's own `shortcutHandler` wins. App-wide shortcuts use Mantine's
 * `useHotkeys` with `hotkey(id)` instead.
 */
export function useShortcuts(bindings: ShortcutBinding[]) {
  // The latest bindings, so callers can pass a new array every render
  // without the listener being re-added each time.
  const latest = useRef(bindings);
  useEffect(() => {
    latest.current = bindings;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || ownsKey(event.target, event.key)) return;
      shortcutHandler(latest.current)(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
