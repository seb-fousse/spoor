// Rule 6 in the grid's tests: siblings directly, other modules through their barrels.
import { useDatabase } from "@platform/DatabaseProvider";
import { Home } from "@pages/Home/Home"; // lint-expect: lint/style/noRestrictedImports "@pages/<Name>"
import { daysWindow } from "../../grid/layout/dragRange";
import { splitPoint } from "./blockEdit";

export const used: unknown[] = [useDatabase, Home, daysWindow, splitPoint];
