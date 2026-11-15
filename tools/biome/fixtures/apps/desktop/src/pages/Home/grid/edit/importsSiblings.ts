// Rule 6: the grid's own files import each other directly, even by a path that
// names the folder.
import { useDatabase } from "@platform/DatabaseProvider"; // lint-expect: lint/style/noRestrictedImports "src/data/"
import { Icon } from "@components/Icon/Icon"; // lint-expect: lint/style/noRestrictedImports "@components/<Name>"
import { dayShortcuts } from "../../dayShortcuts";
import { daysWindow } from "../../grid/layout/dragRange";
import { layoutGrid } from "../layout/gridLayout";
import { splitPoint } from "./blockEdit";

export const used: unknown[] = [useDatabase, Icon, dayShortcuts, daysWindow, layoutGrid, splitPoint];
