import type { AutomergeUrl } from "@automerge/automerge-repo";
import { stringifyAutomergeUrl, isValidAutomergeUrl, isValidDocumentId } from "@automerge/automerge-repo";

export type ParsedEmbedUrl = {
  docUrl: AutomergeUrl;
  toolId?: string;
  type?: string;
};

/**
 * Parse a URL string into doc, tool, and type.
 * Supports:
 * - Full patchwork URL: https://tiny.patchwork.../#doc=xxx&type=yyy&tool=zzz
 * - Automerge URL: automerge:xxx
 * - Raw document ID: xxx
 */
export function parseEmbedUrl(input: string): ParsedEmbedUrl | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Full URL with hash (e.g. https://tiny.patchwork.inkandswitch.com/#doc=3z1vo...&type=tool-sketch&tool=raw)
  // Or just fragment: #doc=xxx&type=yyy&tool=zzz
  if (trimmed.includes("#")) {
    try {
      const parseable = trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://dummy.example${trimmed.startsWith("#") ? "" : "/"}${trimmed}`;
      const url = new URL(parseable);
      const hash = url.hash.slice(1); // remove #
      const params = new URLSearchParams(hash);
      const doc = params.get("doc");
      if (!doc) return null;

      const docUrl = parseDocIdToUrl(doc);
      if (!docUrl) return null;

      const result: ParsedEmbedUrl = { docUrl };
      const type = params.get("type");
      const tool = params.get("tool");
      if (type) result.type = type;
      if (tool) result.toolId = tool;
      return result;
    } catch {
      return null;
    }
  }

  // Automerge URL or raw document ID
  const docUrl = parseDocIdToUrl(trimmed);
  if (!docUrl) return null;

  // For automerge URL or raw ID, don't specify type or tool
  return { docUrl };
}

function parseDocIdToUrl(input: string): AutomergeUrl | null {
  if (isValidAutomergeUrl(input)) {
    return input;
  }
  if (isValidDocumentId(input)) {
    return stringifyAutomergeUrl({ documentId: input });
  }
  return null;
}
