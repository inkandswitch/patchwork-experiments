import type { DiscoveredView, EnrichedConfigMap, PatchworkViewElement } from "./types.js";

const SLOT_DEFS: { fieldName: string; kind: "single" | "array" }[] = [
  { fieldName: "frameToolId", kind: "single" },
  { fieldName: "accountSidebarToolId", kind: "single" },
  { fieldName: "contextSidebarToolId", kind: "single" },
  { fieldName: "contextToolIds", kind: "array" },
  { fieldName: "documentToolbarToolIds", kind: "array" },
];

export async function tryReadAccountDoc(
  views: DiscoveredView[],
  toolElement: PatchworkViewElement
): Promise<EnrichedConfigMap | null> {
  try {
    const repo = toolElement.repo;
    if (!repo) return null;

    const accountUrl = views.find((v) => v.depth === 0)?.docUrl;
    if (!accountUrl) return null;

    const handle = await repo.find(accountUrl as any);
    const doc = handle.doc() as Record<string, unknown> | undefined;
    if (!doc) return null;

    const map: EnrichedConfigMap = new Map();
    for (const def of SLOT_DEFS) {
      const value = doc[def.fieldName];
      if (def.kind === "single" && typeof value === "string") {
        map.set(value, { fieldName: def.fieldName, kind: def.kind, currentValue: value });
      } else if (def.kind === "array" && Array.isArray(value)) {
        for (const id of value) {
          if (typeof id === "string") {
            map.set(id, { fieldName: def.fieldName, kind: def.kind, currentValue: value as string[] });
          }
        }
      }
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

export function getAccountDocUrl(views: DiscoveredView[]): string | null {
  return views.find((v) => v.depth === 0)?.docUrl ?? null;
}
