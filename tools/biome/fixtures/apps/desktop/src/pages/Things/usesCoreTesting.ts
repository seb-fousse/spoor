// Rule 3 applies to the POC pages, now in their own folders, as well as rule 6.
import { Icon } from "@components/Icon/Icon"; // lint-expect: lint/style/noRestrictedImports "@components/<Name>"
import { createInMemoryDatabase } from "@spoor/core/testing"; // lint-expect: lint/style/noRestrictedImports "tests only"

export const used = [Icon, createInMemoryDatabase];
