import { createSignal, onMount } from "solid-js";
import type { BulletsDoc } from "../datatype.ts";

export function useLocalViewState(deps: {
  handleUrl: string;
  doc: BulletsDoc;
}) {
  const collapsedStorageKey = `bullets-collapsed:${deps.handleUrl}`;
  const embedsStorageKey = `bullets-embeds:${deps.handleUrl}`;

  const [collapsedNodes, setCollapsedNodes] = createSignal<Record<string, boolean>>({});
  const [expandedEmbeds, setExpandedEmbeds] = createSignal<Record<string, boolean>>({});

  onMount(() => {
    let collapsed: Record<string, boolean> = {};
    let embeds: Record<string, boolean> = {};
    try {
      const raw = localStorage.getItem(collapsedStorageKey);
      if (raw) collapsed = JSON.parse(raw);
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem(embedsStorageKey);
      if (raw) embeds = JSON.parse(raw);
    } catch { /* ignore */ }

    const nodes = deps.doc.nodes;
    if (nodes) {
      for (const [id, node] of Object.entries(nodes)) {
        if (!node) continue;
        if (!(id in collapsed) && node.collapsed) {
          collapsed[id] = true;
        }
        if (!(id in embeds) && node.embedExpanded) {
          embeds[id] = true;
        }
      }
    }

    setCollapsedNodes(collapsed);
    setExpandedEmbeds(embeds);
  });

  function persistCollapsed(state: Record<string, boolean>) {
    try { localStorage.setItem(collapsedStorageKey, JSON.stringify(state)); } catch { /* ignore */ }
  }

  function persistEmbeds(state: Record<string, boolean>) {
    try { localStorage.setItem(embedsStorageKey, JSON.stringify(state)); } catch { /* ignore */ }
  }

  function isNodeCollapsed(id: string): boolean {
    return collapsedNodes()[id] ?? false;
  }

  function setNodeCollapsed(id: string, value: boolean) {
    setCollapsedNodes((prev) => {
      const next = { ...prev, [id]: value };
      if (!value) delete next[id];
      persistCollapsed(next);
      return next;
    });
  }

  function toggleNodeCollapsed(id: string) {
    setCollapsedNodes((prev) => {
      const next = { ...prev };
      if (prev[id]) {
        delete next[id];
      } else {
        next[id] = true;
      }
      persistCollapsed(next);
      return next;
    });
  }

  function isEmbedExpanded(id: string): boolean {
    return expandedEmbeds()[id] ?? false;
  }

  function setEmbedExpanded(id: string, value: boolean) {
    setExpandedEmbeds((prev) => {
      const next = { ...prev, [id]: value };
      if (!value) delete next[id];
      persistEmbeds(next);
      return next;
    });
  }

  function toggleEmbedExpanded(id: string) {
    setExpandedEmbeds((prev) => {
      const next = { ...prev };
      if (prev[id]) {
        delete next[id];
      } else {
        next[id] = true;
      }
      persistEmbeds(next);
      return next;
    });
  }

  return {
    isNodeCollapsed,
    setNodeCollapsed,
    toggleNodeCollapsed,
    isEmbedExpanded,
    setEmbedExpanded,
    toggleEmbedExpanded,
  };
}
