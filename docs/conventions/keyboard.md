# Keyboard

How shortcuts are declared, bound and shown. Everything here is exported from `@keyboard`.

The worked example is Home's day navigation: [`pages/Home/dayShortcuts.ts`](../../apps/desktop/src/pages/Home/dayShortcuts.ts) binds
the shortcuts page-wide, and [`pages/Home/LeftHeader.tsx`](../../apps/desktop/src/pages/Home/LeftHeader.tsx) shows them on its buttons.

## Every shortcut is in `SHORTCUTS`

[`keyboard/shortcuts.ts`](../../apps/desktop/src/keyboard/shortcuts.ts) holds every keyboard
shortcut in one table, by id, with its keys and a description. Code refers to a shortcut by
its id (`ShortcutId`), never by its keys.

- **Keys are Mantine hotkeys**, such as `"ArrowLeft"` or `"mod+C"`. `mod` is ⌘ on macOS and
  Ctrl elsewhere, and only that one.
- **`word` is our own token:** the modifier that moves the cursor by a word, ⌥ on macOS and Ctrl
  elsewhere.
- **`hotkey(id)` resolves them** for the platform.
- **The table's tests** check, on both platforms, that no two shortcuts share keys and that
  each has exactly one key besides its modifiers.

A widget's own keys, such as Enter to open a selected block's popover or Esc to deselect it,
aren't in the table. [`grid/edit/blockShortcuts.ts`](../../apps/desktop/src/pages/Home/grid/edit/blockShortcuts.ts)
handles them beside the block's shortcuts.

**Why:** in one table, clashes show up in one place and in the tests, and a shortcuts help
screen can be built from it.

- **Source:** the doc comment on `SHORTCUTS`
- **Lint:** none. [`shortcuts.test.ts`](../../apps/desktop/src/keyboard/shortcuts.test.ts) checks
  for clashes.
- **Example:** [`keyboard/shortcuts.ts`](../../apps/desktop/src/keyboard/shortcuts.ts) itself

## Bind shortcuts with `useShortcuts` or `shortcutHandler`

A shortcut does nothing until something binds a handler to its id. A binding is a
`ShortcutBinding`, `[id, handler]`.

- **Page-wide, while a component is mounted:** `useShortcuts(bindings)`. Home binds its day keys
  this way. A new array each render is fine.
- **Only while one element has focus:** `onKeyDown={shortcutHandler(bindings)}`. The grid's day
  headers and a selected block bind their keys this way.
- **App-wide:** Mantine's `useHotkeys`, given `hotkey(id)`. Nothing is bound app-wide yet.
- **Bindings shared by several places** are built by a function, such as `dayShortcuts(dispatch)`
  in [`pages/Home/dayShortcuts.ts`](../../apps/desktop/src/pages/Home/dayShortcuts.ts), which Home
  and the grid's day headers both use.

Both bindings call `preventDefault` on the keys they handle. `useShortcuts` skips a key that
another handler already took, so an element's own `shortcutHandler` wins over the page's.

- **Source:** [`keyboard/useShortcuts.ts`](../../apps/desktop/src/keyboard/useShortcuts.ts)
- **Lint:** none
- **Example:** [`pages/Home/dayShortcuts.ts`](../../apps/desktop/src/pages/Home/dayShortcuts.ts)

## Leave a key to the element that needs it: `ownsKey`

[`ownsKey(target, key)`](../../apps/desktop/src/keyboard/ownsKey.ts) says whether a key should
go to the element it was pressed in instead of running a shortcut:

- a field you type into needs every key;
- a widget that moves with the arrow keys, Home, End, Page Up and Page Down needs those: a
  select, a menu, a slider, a splitter, a dialog and the like.

`useShortcuts` checks it for you. A handler of your own that runs shortcuts checks it too, as
`blockKeyHandler` does.

**Why:** ⌫ in a text field deletes a character, never the selected block.

- **Source:** [`keyboard/ownsKey.ts`](../../apps/desktop/src/keyboard/ownsKey.ts)
- **Lint:** none
- **Example:** the text-field test in
  [`keyboard/useShortcuts.test.tsx`](../../apps/desktop/src/keyboard/useShortcuts.test.tsx)

## Show shortcuts the platform's way

Never write a key symbol by hand. Show a shortcut from its id:

- **On a button:** wrap it in `<ShortcutTooltip shortcut={id}>`. It shows the keys in a tooltip,
  one `Kbd` per key, and sets the button's `aria-keyshortcuts`. `ArrowButtons` takes a
  `backShortcut` and a `forwardShortcut` for this.
- **In running text or a menu:** `shortcutLabel(id)`, such as "⌘+C" or "Ctrl+C".
- **Anything else:** `describeShortcut(id)`, which gives each key's label and the
  `aria-keyshortcuts` form.

**Why:** the keys differ by platform, and assistive tech should hear them too.

- **Source:** [`keyboard/format.ts`](../../apps/desktop/src/keyboard/format.ts),
  [`keyboard/ShortcutTooltip.tsx`](../../apps/desktop/src/keyboard/ShortcutTooltip.tsx)
- **Lint:** none
- **Example:** [`pages/Home/LeftHeader.tsx`](../../apps/desktop/src/pages/Home/LeftHeader.tsx)

The platform comes from `IS_MAC` in [`platform/os.ts`](../../apps/desktop/src/platform/os.ts).
`hotkey`, `shortcutHandler`, `describeShortcut` and `shortcutLabel` also take a `mac` flag, so
tests can check both platforms.
