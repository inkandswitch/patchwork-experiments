import type { AutomergeUrl } from "@automerge/automerge-repo";
import { useDocument } from "@automerge/automerge-repo-react-hooks";
import type { HasPatchworkMetadata } from "@inkandswitch/patchwork-filesystem";
import {
  DatatypeDescription,
  DatatypeImplementation,
  getFallbackTool,
  getRegistry,
  getSupportedToolsForType,
  type ToolDescription,
} from "@inkandswitch/patchwork-plugins";
import { PluginRegistry } from "@inkandswitch/patchwork-plugins/dist/registry/registry";
import { useEffect, useMemo, useState } from "react";

/**
 * Resolve a human-readable title for a document by loading its datatype and
 * calling `getTitle`. Falls back to a short document id while loading.
 */
export function useDocTitle(url?: AutomergeUrl): string {
  const [doc] = useDocument<HasPatchworkMetadata>(url);
  const [title, setTitle] = useState<string>("");

  useEffect(() => {
    if (!url || !doc) {
      return;
    }
    const type = doc["@patchwork"]?.type;
    if (!type) {
      return;
    }

    let cancelled = false;
    const registry = getRegistry("patchwork:datatype") as PluginRegistry<
      DatatypeDescription,
      DatatypeImplementation
    >;
    registry.load(type).then((datatype) => {
      if (cancelled || !datatype) {
        return;
      }
      setTitle(datatype.module.getTitle(doc));
    });

    return () => {
      cancelled = true;
    };
  }, [url, doc]);

  if (title) return title;
  if (!url) return "";
  return url.replace(/^automerge:/, "").slice(0, 8);
}

export type ContextTool = {
  id: string;
  name: string;
  icon?: string;
};

/**
 * Discover the tools tagged `context-tool` (comments, history, etc.), refreshing
 * as plugins register. These are openable as on-demand context panels.
 */
export function useContextTools(): ContextTool[] {
  const [registryVersion, setRegistryVersion] = useState(0);

  useEffect(() => {
    const registry = getRegistry("patchwork:tool");
    return registry.on("changed", () => setRegistryVersion((v) => v + 1));
  }, []);

  return useMemo(() => {
    const registry = getRegistry<ToolDescription>("patchwork:tool");
    return registry
      .filter((tool) => (tool.tags ?? []).includes("context-tool"))
      .map((tool) => ({ id: tool.id, name: tool.name ?? tool.id, icon: tool.icon }));
    // registryVersion intentionally re-triggers resolution on registry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registryVersion]);
}

export type SupportedTools = {
  /** Listed tools that can render this document, sorted by relevance. */
  tools: ToolDescription[];
  /** Id of the tool used when no explicit tool is chosen. */
  fallbackId: string | undefined;
};

/**
 * Resolve the tools that can render a document, refreshing as plugins register
 * or the document's type changes.
 */
export function useSupportedTools(url?: AutomergeUrl): SupportedTools {
  const [doc] = useDocument<HasPatchworkMetadata>(url);
  const type = doc?.["@patchwork"]?.type;
  const [registryVersion, setRegistryVersion] = useState(0);

  useEffect(() => {
    const registry = getRegistry("patchwork:tool");
    return registry.on("changed", () => setRegistryVersion((v) => v + 1));
  }, []);

  const tools = useMemo(() => {
    if (!type) return [];
    return getSupportedToolsForType(type).filter(
      (tool) => !(tool as ToolDescription).unlisted,
    ) as unknown as ToolDescription[];
    // registryVersion intentionally re-triggers resolution on registry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, registryVersion]);

  const fallbackId = useMemo(() => {
    if (!doc || !type) return undefined;
    try {
      return getFallbackTool(doc)?.id;
    } catch {
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, type, registryVersion]);

  return { tools, fallbackId };
}
