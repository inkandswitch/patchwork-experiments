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
import { slotId } from "./slots";
import { resolvePreferredTool } from "./toolMemory";
import type { ToolPreferences, ToolSlot } from "./types";

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

export type SlotTool = {
  id: string;
  name: string;
  icon?: string;
  /** The configured slot itself, so callers can render/open it correctly. */
  slot: ToolSlot;
};

/**
 * Resolve display metadata (name, icon) for a configured tool lane (tray /
 * contextbar), read from the shared frame config doc. A slot is either a
 * `[toolId, docId]` tuple (a `patchwork:tool`) or a bare component id (a
 * `patchwork:component`); labels come from whichever registry matches,
 * mirroring threepane's `ContextTabs`. Refreshes as plugins register — a
 * slot's name resolves the moment its plugin loads.
 */
export function useSlotTools(slots: ToolSlot[] | undefined): SlotTool[] {
  const [registryVersion, setRegistryVersion] = useState(0);

  useEffect(() => {
    const toolRegistry = getRegistry("patchwork:tool");
    const componentRegistry = getRegistry("patchwork:component");
    const bump = () => setRegistryVersion((v) => v + 1);
    const offTool = toolRegistry.on("changed", bump);
    const offComponent = componentRegistry.on("changed", bump);
    return () => {
      offTool();
      offComponent();
    };
  }, []);

  const slotsKey = (slots ?? []).map(slotId).join("\u0000");

  return useMemo(() => {
    if (!slots || slots.length === 0) return [];
    const toolRegistry = getRegistry<ToolDescription>("patchwork:tool");
    const componentRegistry = getRegistry<ToolDescription>("patchwork:component");
    return slots.map((slot) => {
      const id = slotId(slot);
      const description = toolRegistry.get(id) ?? componentRegistry.get(id);
      return {
        id,
        name: description?.name ?? id,
        icon: description?.icon,
        slot,
      };
    });
    // slotsKey + registryVersion drive recomputation as config or plugins change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slotsKey, registryVersion]);
}

export type SupportedTools = {
  /** Listed tools that can render this document, sorted by relevance. */
  tools: ToolDescription[];
  /** Id of the tool used when no explicit tool is chosen. */
  fallbackId: string | undefined;
  /** The document's `@patchwork.type`, used to key per-datatype preferences. */
  type: string | undefined;
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

  return { tools, fallbackId, type };
}

export type EffectiveTool = SupportedTools & {
  /**
   * The tool the panel should actually render, applying the preference chain
   * (explicit choice → last-for-doc → last-for-type → datatype default).
   */
  toolId: string | undefined;
};

/**
 * Resolve the effective tool for a panel: the explicit per-panel choice if set,
 * otherwise the remembered preference for this document, then this datatype,
 * then the datatype's default. Also returns the supported tools / fallback /
 * type so callers can render a picker without re-querying.
 */
export function useEffectiveTool(
  url: AutomergeUrl | undefined,
  explicitToolId: string | undefined,
  preferences: ToolPreferences | undefined,
): EffectiveTool {
  const supported = useSupportedTools(url);
  const { tools, fallbackId, type } = supported;

  const toolId = useMemo(() => {
    if (!url) return explicitToolId;
    const supportedIds = new Set(tools.map((tool) => tool.id));
    return resolvePreferredTool({
      explicitToolId,
      url,
      type,
      supportedIds,
      fallbackId,
      preferences,
    });
  }, [url, explicitToolId, tools, fallbackId, type, preferences]);

  return { ...supported, toolId };
}
