// Rule 6: Home's other concern folders reach the grid through its barrel too.
import { TimelineFilter } from "../grid";
import { useGridData } from "../grid/useGridData"; // lint-expect: lint/style/noRestrictedImports "./grid"

export const used: unknown[] = [TimelineFilter, useGridData];
