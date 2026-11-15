// The examples get src/'s rules: examples/data/ may use the database, query keys and
// TanStack Query's hooks, like src/data/, but not core's test helpers.
import { useDatabase } from "@platform/DatabaseProvider";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@data/queryKeys";
import { createInMemoryDatabase } from "@spoor/core/testing"; // lint-expect: lint/style/noRestrictedImports "tests only"

export const used = [useDatabase, useQuery, useMutation, useQueryClient, queryKeys];
export const testing = createInMemoryDatabase;

// Rule 4 still applies here.
export const formatted = new Date(0).toLocaleString(); // lint-expect: plugin "lib/format"
