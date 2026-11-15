// Rule 3: app code doesn't import core's test helpers. Rule 1 still applies beside it.
import { useDatabase } from "@platform/DatabaseProvider"; // lint-expect: lint/style/noRestrictedImports "src/data/"
import { createInMemoryDatabase } from "@spoor/core/testing"; // lint-expect: lint/style/noRestrictedImports "tests only"

export const used = [useDatabase, createInMemoryDatabase];
