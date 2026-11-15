# Components

Where UI code goes, how it's named, and how it's styled.

The worked examples are [`components/ErrorAlert/`](../../apps/desktop/src/components/ErrorAlert/), a component folder with its
test and its `index.ts`, and [`components/ArrowButtons/`](../../apps/desktop/src/components/ArrowButtons/), one with its CSS module.

## Every shared component has its own folder

A shared component lives in `components/<Name>/`: `Name.tsx`, `Name.module.css` if it has
styles, its tests, and an `index.ts` that exports its public parts. A component that is one
file gets a folder too. Import it as `@components/<Name>`.

**Why:** moving a file within its folder never changes an import path, and one rule beats a
rule per folder.

- **Source:** [#145](https://github.com/seb-fousse/spoor/issues/145), rule 1
- **Lint:** rule 6 reports an import past the barrel, such as `@components/Icon/Icon`
- **Example:** [`components/ErrorAlert/`](../../apps/desktop/src/components/ErrorAlert/)

## Every page has its own folder

A page lives in `pages/<Name>/`, with `Name.tsx` and an `index.ts`. Import it as
`@pages/<Name>`.

- **Source:** [#145](https://github.com/seb-fousse/spoor/issues/145), rule 2
- **Lint:** rule 6 reports an import past the barrel, such as `@pages/Home/Home`
- **Example:** [`pages/Settings/`](../../apps/desktop/src/pages/Settings)

## Inside a page, folders are by concern

A page's files are grouped by what they're about, not one folder per component. Home has
`grid/`, `logs/`, `observations/` and `rail/`, with the files loose inside each.

- **A concern folder gets an `index.ts` only when it has internals** the rest of the page
  shouldn't reach into. Home's `grid/` does: the rest of Home imports `./grid`, never
  `./grid/edit/…`.
- **Otherwise, import the file directly**, as Home does with `./logs/LogRail`.
- **Files that serve the whole page stay at its root.** Home's `LeftHeader` and `RightHeader`
  are the two halves of its header row, share `Home.module.css`, and drive Home's own day
  state.

- **Source:** [#145](https://github.com/seb-fousse/spoor/issues/145), rule 3;
  [#158](https://github.com/seb-fousse/spoor/pull/158)
- **Lint:** rule 6 reports a relative import into `grid/` from outside it
- **Example:** [`pages/Home/grid/index.ts`](../../apps/desktop/src/pages/Home/grid/index.ts)

## Barrels only at module boundaries

- **These have a barrel:** `@spoor/core`, each `components/<Name>/`, each page, `keyboard/`,
  `theme/`, and concern folders with internals, such as Home's `grid/`.
- **A barrel lists its exports by name.** No `export *`.
- **A barrel exports only the public parts.** `pages/Home/index.ts` exports `Home` and
  `HomeStateProvider`, nothing else.
- **Inside a module, import the file you need**, never the module's own barrel.
- **From outside a module, import its barrel.** Never reach past it into its files.

Rule 6 doesn't cover `keyboard/` and `theme/`. Their aliases are exact (`@keyboard`,
`@theme`), so `tsc` already rejects a deeper alias import.

**Why:** a barrel is the module's public surface. Reaching past it couples callers to its
layout.

- **Source:** [#145](https://github.com/seb-fousse/spoor/issues/145), rule 4
- **Lint:** rule 6
- **Example:** [`components/ErrorAlert/index.ts`](../../apps/desktop/src/components/ErrorAlert/index.ts)

## File names

- **Components and their CSS modules are PascalCase:** `Name.tsx`, `Name.module.css`.
- **Hooks are `useThing.ts`.**
- **Other modules are camelCase.** A `.ts` file holds no component, so it's camelCase, except
  the theme's per-component overrides, `theme/components/<Name>/<Name>.ts`, named after the
  Mantine component they style.
- **Tests sit next to their file**, as `*.test.ts` or `*.test.tsx`. Integration tests are
  `*.integration.test.tsx`.
- **Core keeps its kebab-case names**, since it's a separate package.

Biome checks the part before the first dot, so `Name.test.tsx` passes when its file does. It
doesn't check CSS file names, so `Name.module.css` isn't enforced.

- **Source:** [#145](https://github.com/seb-fousse/spoor/issues/145), rule 5
- **Lint:** rule 7
- **Example:** the files in [`pages/Home/`](../../apps/desktop/src/pages/Home/)

## Mantine for controls, styled app-wide in `theme/components/`

Build controls from Mantine's components: `Button`, `ActionIcon`, `TextInput`, `Modal`,
`Alert` and the rest. To change how one looks or behaves everywhere, don't restyle it at each
call site. Give it an override in `theme/components/<Name>/`:

- **`<Name>.ts`** exports `<Name>Theme = <Name>.extend({ classNames, defaultProps })`, and
  [`theme/components/index.ts`](../../apps/desktop/src/theme/components/index.ts) registers
  it.
- **`<Name>.module.css`** names its classes after the component's Styles API selectors
  (`.root`, `.label`, …), so the module can be passed whole as `classNames`.
- **States are targeted through Mantine's data attributes**, such as `[data-active]` or
  `[data-variant="filled"]`.
- **"Every X should be variant Y" is a `defaultProps` entry.**

[`theme/components/Alert/`](../../apps/desktop/src/theme/components/Alert) is a small one.

- **Source:** Mantine, [Styles API](https://mantine.dev/styles/styles-api/); the comment in
  [`theme/components/index.ts`](../../apps/desktop/src/theme/components/index.ts)
- **Lint:** rule 7 allows the PascalCase `.ts` names
- **Example:** [`theme/components/Alert/`](../../apps/desktop/src/theme/components/Alert)

## CSS modules, with tokens and no raw colours

A component's own styles go in its CSS module. Colours come from the theme's `--app-*`
tokens, defined in [`theme/tokens.ts`](../../apps/desktop/src/theme/tokens.ts) with a value for
light mode and one for dark. Spacing and font sizes come from Mantine's variables, such as
`--mantine-spacing-sm`. Outside `theme/`, no CSS file has a raw colour. To add a token, give it
both values.

**Why:** a view built on tokens follows the colour scheme without any code of its own.

- **Source:** the comments in [`theme/index.ts`](../../apps/desktop/src/theme/index.ts) and
  [`theme/tokens.ts`](../../apps/desktop/src/theme/tokens.ts)
- **Lint:** none. Biome doesn't check colour values.
- **Example:** [`components/ArrowButtons/ArrowButtons.module.css`](../../apps/desktop/src/components/ArrowButtons/ArrowButtons.module.css)

## Inline `style` only for values computed at render

Use the `style` prop only for what's computed while rendering: geometry, such as a block's
`--top` and `--height` on the grid or a menu's position, and a record's own colour, such as a
category's palette swatch. Pass them as CSS custom properties where the CSS module can use
them. Everything fixed goes in the CSS module.

- **Source:** the grid, in [`pages/Home/grid/blocks/GridBlocks.tsx`](../../apps/desktop/src/pages/Home/grid/blocks/GridBlocks.tsx)
- **Lint:** none
- **Example:** `segmentStyle` in [`GridBlocks.tsx`](../../apps/desktop/src/pages/Home/grid/blocks/GridBlocks.tsx)

## Icons are drawn with `Icon`

[`components/Icon`](../../apps/desktop/src/components/Icon/Icon.tsx) draws a line icon like
the app's others: round 2-unit strokes on a 24-unit grid, in the text colour. Pass the shapes
as children. Give it a `size` in pixels, or a `className` that sizes it, such as to `1em`.
It's hidden from assistive tech, because an icon sits beside a label. Each icon is a small
named component next to where it's used, such as `ScissorsIcon` in
[`grid/menus/BlockMenu.tsx`](../../apps/desktop/src/pages/Home/grid/menus/BlockMenu.tsx).
There's no icon library.

- **Source:** [`components/Icon/Icon.tsx`](../../apps/desktop/src/components/Icon/Icon.tsx);
  [CONTRIBUTING.md](../../CONTRIBUTING.md) keeps dependencies few
- **Lint:** none
- **Example:** `ScissorsIcon` in [`BlockMenu.tsx`](../../apps/desktop/src/pages/Home/grid/menus/BlockMenu.tsx)
