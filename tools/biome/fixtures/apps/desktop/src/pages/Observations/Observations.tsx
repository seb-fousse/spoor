// The POC pages are exempt from rules 1, 2 and 4 until they're replaced (#149),
// but not from rule 6.
import { FieldList } from "@components/FieldList/FieldList"; // lint-expect: lint/style/noRestrictedImports "@components/<Name>"
import { useDatabase } from "@platform/DatabaseProvider";
import { useQuery } from "@tanstack/react-query";

export const used: unknown[] = [FieldList, useDatabase, useQuery];
export const formatted = new Date(0).toLocaleString();
