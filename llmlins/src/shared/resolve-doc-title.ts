import { getRegistry } from "@inkandswitch/patchwork-plugins";
import type { DocHandle, Repo } from "@automerge/automerge-repo";

export type { Repo };

/**
 * Resolve a human-readable title for a patchwork document.
 *
 * Reads the `datatype` field from the handle's doc, loads the matching
 * datatype plugin, and calls `getTitle()`. Falls back to `'Untitled Doc'`
 * at any failure point.
 *
 * If you only have a URL (not a DocHandle), call `repo.find(url)` first —
 * `repo` is available as `element.repo` in the `mount` function.
 */
export async function resolveDocTitle(handle: DocHandle<Record<string, unknown>>): Promise<string> {
  try {
    await handle.whenReady();
    const doc = handle.doc();
    if (!doc) return "Untitled Doc";

    const patchwork = doc["@patchwork"] as { type?: string } | undefined;
    const datatypeId = patchwork?.type;
    if (!datatypeId) return "Untitled Doc";

    const registry = getRegistry("patchwork:datatype");
    const datatype = await registry.load(datatypeId);
    return datatype?.module.getTitle?.(doc) ?? "Untitled Doc";
  } catch {
    return "Untitled Doc";
  }
}
