// The POC pages are exempt from rules 1, 2 and 4 until they're replaced (#149).
import { queryKeys } from "@data/queryKeys";
import { useDatabase } from "@platform/DatabaseProvider";
import { useQuery } from "@tanstack/react-query";

export const used = [queryKeys, useDatabase, useQuery];
export const formatted = new Date(0).toLocaleString();
