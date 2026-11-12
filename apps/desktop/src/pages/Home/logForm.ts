import type { LogType } from "@spoor/core";

/** The log types an entry can be created for directly: live and not a child type. */
export function topLevelTypes(types: LogType[]): LogType[] {
  return types.filter((t) => t.parentTypeId === null && t.archivedAt === null);
}

/** The live child types of `parentTypeId`, whose entries are added inside a parent entry. */
export function childTypes(types: LogType[], parentTypeId: string): LogType[] {
  return types.filter((t) => t.parentTypeId === parentTypeId && t.archivedAt === null);
}
