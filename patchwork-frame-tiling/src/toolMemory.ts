import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolPreferences } from "./types";

/**
 * Tool memory: which tool the user last chose for a document or datatype, so
 * newly-opened panels can default to it. Stored on the user's account document
 * ({@link ToolPreferences}) rather than locally, so the preference syncs across
 * the user's devices.
 *
 * Two scopes, checked most-specific first by {@link resolvePreferredTool}:
 *   - per *document* (keyed by url): "I always view this doc in the map editor"
 *   - per *datatype* (keyed by `@patchwork.type`): "I prefer the table for sheets"
 */

/**
 * Resolve the tool a panel should use, in precedence order:
 *   1. the panel's explicit choice (`explicitToolId`)
 *   2. the last tool chosen for *this document*
 *   3. the last tool chosen for *this datatype*
 *   4. the datatype's default tool (`fallbackId`)
 *
 * Remembered ids are only honored when they're among the currently `supported`
 * tools, so a stale preference can't select a tool that can't render the doc.
 * While the supported list is still loading (empty), an explicit choice is
 * trusted as-is and we otherwise defer to the fallback.
 */
export function resolvePreferredTool({
  explicitToolId,
  url,
  type,
  supportedIds,
  fallbackId,
  preferences,
}: {
  explicitToolId: string | undefined;
  url: AutomergeUrl;
  type: string | undefined;
  supportedIds: Set<string>;
  fallbackId: string | undefined;
  preferences: ToolPreferences | undefined;
}): string | undefined {
  if (explicitToolId) return explicitToolId;
  if (supportedIds.size === 0) return fallbackId;

  const forDoc = preferences?.byDoc?.[url];
  if (forDoc && supportedIds.has(forDoc)) return forDoc;

  const forType = type ? preferences?.byType?.[type] : undefined;
  if (forType && supportedIds.has(forType)) return forType;

  return fallbackId;
}

/**
 * Record an explicit tool choice for both the document and its datatype by
 * mutating an account-doc draft in place. Call inside `handle.change(...)`.
 */
export function rememberToolInDoc(
  doc: { toolPreferences?: ToolPreferences },
  url: AutomergeUrl,
  type: string | undefined,
  toolId: string,
): void {
  if (!doc.toolPreferences) doc.toolPreferences = {};
  const prefs = doc.toolPreferences;
  if (!prefs.byDoc) prefs.byDoc = {};
  prefs.byDoc[url] = toolId;
  if (type) {
    if (!prefs.byType) prefs.byType = {};
    prefs.byType[type] = toolId;
  }
}
