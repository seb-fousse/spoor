// Rule 3 applies to the POC pages, though rules 1, 2 and 4 don't.
import { queryKeys } from "@data/queryKeys";
import { useDatabase } from "@platform/DatabaseProvider";
import { createInMemoryDatabase } from "@spoor/core/testing"; // lint-expect: lint/style/noRestrictedImports "tests only"
import { useQuery } from "@tanstack/react-query";

export const used = [queryKeys, useDatabase, createInMemoryDatabase, useQuery];
export const formatted = new Date(0).toLocaleString();
