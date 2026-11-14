// Rules 1 and 2: tests may import the database, query keys and TanStack Query's hooks.
import { queryKeys } from "@data/queryKeys";
import { useDatabase } from "@platform/DatabaseProvider";
import { useQuery } from "@tanstack/react-query";

export const used = [queryKeys, useDatabase, useQuery];
