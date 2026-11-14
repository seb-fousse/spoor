// Rule 1: only the data hooks import useDatabase. Biome matches the specifier as
// written, so nothing here has to resolve.
import { DatabaseProvider } from "@platform/DatabaseProvider";
import { useDatabase } from "@platform/DatabaseProvider"; // lint-expect: lint/style/noRestrictedImports "src/data/"

export const used = [DatabaseProvider, useDatabase];
