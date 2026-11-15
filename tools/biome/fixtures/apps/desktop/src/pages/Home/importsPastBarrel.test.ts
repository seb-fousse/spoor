// Rule 6 applies to tests too: a test sits next to its file, inside the module.
import { useDatabase } from "@platform/DatabaseProvider";
import { splitPoint } from "./grid/edit/blockEdit"; // lint-expect: lint/style/noRestrictedImports "./grid"

export const used: unknown[] = [useDatabase, splitPoint];
