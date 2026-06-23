/** Instance keys encode "nodeId::parentId" to disambiguate mirrors in selection */
export function ikey(nodeId: string, parentId: string): string {
  return nodeId + "::" + parentId;
}

export function nodeOf(key: string): string {
  return key.substring(0, key.indexOf("::"));
}

export function parentOf(key: string): string {
  return key.substring(key.indexOf("::") + 2);
}

export function isNodeInSet(set: Set<string>, nodeId: string): boolean {
  for (const key of set) {
    if (key.startsWith(nodeId + "::")) return true;
  }
  return false;
}
