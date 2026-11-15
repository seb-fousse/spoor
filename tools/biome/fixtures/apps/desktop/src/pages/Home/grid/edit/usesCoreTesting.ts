// Rule 3 applies inside the grid, whose own override repeats rules 1 to 3.
import { createInMemoryDatabase } from "@spoor/core/testing"; // lint-expect: lint/style/noRestrictedImports "tests only"

export const used = [createInMemoryDatabase];
