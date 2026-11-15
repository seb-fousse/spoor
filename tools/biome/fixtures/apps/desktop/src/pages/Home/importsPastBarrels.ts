// Rule 6: nothing outside a module imports past its barrel. Biome matches the
// specifier as written, so nothing here has to resolve.
import { TimelineGrid } from "./grid/TimelineGrid"; // lint-expect: lint/style/noRestrictedImports "./grid"
import { splitPoint } from "./grid/edit/blockEdit"; // lint-expect: lint/style/noRestrictedImports "./grid"
import type { GridBlock } from "./grid/layout/gridLayout"; // lint-expect: lint/style/noRestrictedImports "./grid"
import { Icon } from "@components/Icon/Icon"; // lint-expect: lint/style/noRestrictedImports "@components/<Name>"
import { describeValues } from "@components/LogEntryForm/formatEntry"; // lint-expect: lint/style/noRestrictedImports "@components/<Name>"
import { Home } from "@pages/Home/Home"; // lint-expect: lint/style/noRestrictedImports "@pages/<Name>"
// Reported once, as a page's internals.
import { TimelineFilter } from "@pages/Home/grid/filter/TimelineFilter"; // lint-expect: lint/style/noRestrictedImports "@pages/<Name>"

export { BlockMenu } from "./grid/menus/BlockMenu"; // lint-expect: lint/style/noRestrictedImports "./grid"

export const used: unknown[] = [TimelineGrid, splitPoint, Icon, describeValues, Home, TimelineFilter];
export type Used = GridBlock;
export const lazy = () => import("./grid/useGridData"); // lint-expect: lint/style/noRestrictedImports "./grid"
