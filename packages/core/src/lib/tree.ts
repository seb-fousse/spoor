/** `rootId` and everything below it, level by level, as listed by `childrenOf`. */
export async function tree(
  rootId: string,
  childrenOf: (parentIds: string[]) => Promise<string[]>,
): Promise<string[]> {
  const ids = [rootId];
  for (let level = [rootId]; level.length > 0; ) {
    level = (await childrenOf(level)).filter((id) => !ids.includes(id));
    ids.push(...level);
  }
  return ids;
}
