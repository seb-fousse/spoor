// Rules 1 and 2: the data hooks import the database and TanStack Query's hooks.
import { useDatabase } from "@platform/DatabaseProvider";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys as aliased } from "@data/queryKeys";
import { queryKeys } from "./queryKeys";

export const used = [useDatabase, useQuery, useMutation, useQueryClient, aliased, queryKeys];

// Rule 4 still applies here.
export const formatted = new Date(0).toLocaleString(); // lint-expect: plugin "lib/format"
