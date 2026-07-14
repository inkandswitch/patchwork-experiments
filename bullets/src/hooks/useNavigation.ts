import { createSignal, createEffect, createMemo, batch, type Accessor } from "solid-js";
import type { DocHandle } from "@automerge/automerge-repo";
import type { BulletsDoc } from "../datatype.ts";
import type { ContextMenuState } from "../components/ContextMenu.tsx";
import type { ToolContext } from "../tool-context.ts";
import {
  findParentId,
  isAutomergeUrl,
  isYouTubeUrl,
  isImageBullet,
  extractTags,
} from "../tree-utils.ts";

export function useNavigation(deps: {
  handle: DocHandle<BulletsDoc>;
  doc: BulletsDoc;
  reachableIds: Accessor<Set<string>>;
  ctx: ToolContext;
  setNodeCollapsed: (id: string, value: boolean) => void;
  setEmbedExpanded: (id: string, value: boolean) => void;
  getTitleRef: () => HTMLHeadingElement | undefined;
  getDisplayText: (id: string, content: string) => string;
}) {
  const { handle, doc } = deps;

  // Context state
  const contextStorageKey = `bullets-context:${handle.url}`;
  const [contextId, _setContextId] = createSignal<string | null>(null);

  function setContextId(id: string | null) {
    _setContextId(id);
    if (id) {
      localStorage.setItem(contextStorageKey, id);
    } else {
      localStorage.removeItem(contextStorageKey);
    }
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set("bullet-id", id);
    } else {
      url.searchParams.delete("bullet-id");
    }
    window.history.replaceState(null, "", url.toString());
  }

  const [navHistory, setNavHistory] = createSignal<string[]>([]);

  // Focus state
  const [focusedBulletId, _setFocusedBulletId] = createSignal<string | null>(null);
  const [focusedParentHint, setFocusedParentHint] = createSignal<string | null>(null);
  const [focusCursorOffset, setFocusCursorOffset] = createSignal<number | null>(null);

  function setFocusedBulletId(id: string | null, parentHint?: string, cursorOffset?: number) {
    batch(() => {
      setFocusedParentHint(parentHint ?? null);
      setFocusCursorOffset(cursorOffset ?? null);
      _setFocusedBulletId(id);
    });
  }

  const [contextMenu, setContextMenu] = createSignal<ContextMenuState>(null);

  // Tag state
  const [activeTag, setActiveTag] = createSignal<string | null>(null);

  const allTags = createMemo(() => {
    const reachable = deps.reachableIds();
    const tagSet = new Set<string>();
    if (!doc.nodes) return [];
    for (const [id, node] of Object.entries(doc.nodes)) {
      if (id === doc.rootId) continue;
      if (!reachable.has(id)) continue;
      if (!node) continue;
      for (const tag of extractTags(node.content)) {
        tagSet.add(tag);
      }
    }
    return [...tagSet].sort();
  });

  const tagResults = createMemo(() => {
    const tag = activeTag();
    if (!tag) return [];
    if (!doc.nodes) return [];
    const reachable = deps.reachableIds();
    const results: { id: string; content: string }[] = [];
    for (const [id, node] of Object.entries(doc.nodes)) {
      if (id === doc.rootId) continue;
      if (!reachable.has(id)) continue;
      if (!node) continue;
      if (extractTags(node.content).includes(tag)) {
        results.push({ id, content: deps.getDisplayText(id, node.content) });
      }
    }
    return results;
  });

  function openTag(tag: string) {
    const currentCtx = contextId();
    if (activeTag()) {
      setNavHistory((h) => [...h, "__tag__:" + activeTag()!]);
    } else if (currentCtx) {
      setNavHistory((h) => [...h, currentCtx]);
    } else {
      setNavHistory((h) => [...h, "__home__"]);
    }
    setActiveTag(tag);
  }

  // The ID of the node currently displayed as root
  const contextRootId = () => contextId() ?? doc.rootId;

  // Redirect to home if the current context becomes unreachable
  createEffect(() => {
    const ctx = contextId();
    if (ctx && !deps.reachableIds().has(ctx)) {
      setContextId(null);
    }
  });

  // Auto-create an empty bullet when context root has zero children
  createEffect(() => {
    if (!doc.nodes) return;
    const rootId = contextRootId();
    const root = doc.nodes[rootId];
    if (root && root.children.length === 0) {
      const newId = crypto.randomUUID();
      handle.change((d) => {
        if (d.nodes[rootId].children.length === 0) {
          d.nodes[newId] = { content: "", starred: false, children: [] };
          d.nodes[rootId].children.push(newId);
        }
      });
      setFocusedBulletId(newId);
    }
  });

  // Focus recovery: when the focused bullet is deleted by a peer
  createEffect(() => {
    const reachable = deps.reachableIds();
    const el = document.activeElement;
    if (!el) return;
    const row = (el as HTMLElement).closest?.(".bullet-row[data-bullet-id]") as HTMLElement | null;
    if (!row) return;
    const bulletId = row.dataset.bulletId;
    if (!bulletId) return;
    if (!reachable.has(bulletId)) {
      const list = row.closest(".bullets-list");
      if (!list) return;
      const allContents = Array.from(list.querySelectorAll<HTMLElement>(".bullet-content"));
      const idx = allContents.findIndex(c => (c.closest(".bullet-row") as HTMLElement | null)?.dataset?.bulletId === bulletId);
      const target = allContents[idx - 1] ?? allContents[idx + 1];
      if (target) {
        target.focus();
      }
    }
  });

  function focusTitle() {
    const titleRef = deps.getTitleRef();
    if (!titleRef) return;
    titleRef.focus();
    const range = document.createRange();
    const sel = window.getSelection();
    if (titleRef.childNodes.length > 0) {
      range.setStartAfter(titleRef.lastChild!);
    } else {
      range.setStart(titleRef, 0);
    }
    range.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function goToContext(id: string) {
    if (!deps.reachableIds().has(id)) return;
    deps.ctx.clearSelection();
    if (activeTag()) {
      setNavHistory((h) => [...h, "__tag__:" + activeTag()!]);
      setActiveTag(null);
    } else {
      const currentCtx = contextId();
      if (currentCtx) {
        setNavHistory((h) => [...h, currentCtx]);
      } else {
        setNavHistory((h) => [...h, "__home__"]);
      }
    }
    setContextId(id);
    const content = doc.nodes[id]?.content ?? "";
    if (
      (isAutomergeUrl(content) && customElements.get("patchwork-view") !== undefined) ||
      isYouTubeUrl(content)
    ) {
      deps.setEmbedExpanded(id, true);
    }
    if (!isAutomergeUrl(content) && !isYouTubeUrl(content) && !isImageBullet(content, doc.nodes[id]?.contentType)) {
      requestAnimationFrame(() => focusTitle());
    }
  }

  function goBack() {
    deps.ctx.clearSelection();
    const history = navHistory();
    if (history.length === 0) {
      if (activeTag()) {
        setActiveTag(null);
      }
      return;
    }

    const reachable = deps.reachableIds();
    let prev: string | undefined;
    let sliceIdx = history.length;
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      if (entry === "__home__" || entry.startsWith("__tag__:") || reachable.has(entry)) {
        prev = entry;
        sliceIdx = i;
        break;
      }
    }

    if (prev === undefined) {
      setNavHistory([]);
      setActiveTag(null);
      setContextId(null);
      return;
    }

    setNavHistory((h) => h.slice(0, sliceIdx));
    if (prev.startsWith("__tag__:")) {
      setActiveTag(prev.slice(8));
    } else if (prev === "__home__") {
      setActiveTag(null);
      setContextId(null);
    } else {
      setActiveTag(null);
      setContextId(prev);
    }
  }

  function goUp() {
    deps.ctx.clearSelection();
    setActiveTag(null);
    const id = contextId();
    if (!id) return;
    deps.setNodeCollapsed(id, false);
    const parentId = findParentId(doc, id);
    if (!parentId || parentId === doc.rootId) {
      goHome();
    } else {
      const currentCtx = contextId();
      if (currentCtx) {
        setNavHistory((h) => [...h, currentCtx]);
      }
      setContextId(parentId);
    }
  }

  function goHome() {
    deps.ctx.clearSelection();
    setActiveTag(null);
    const id = contextId();
    if (id) {
      deps.setNodeCollapsed(id, false);
    }
    const currentCtx = contextId();
    if (currentCtx) {
      setNavHistory((h) => [...h, currentCtx]);
    }
    setContextId(null);
  }

  function addBulletAtEnd() {
    const newId = crypto.randomUUID();
    const targetId = contextRootId();
    const insertIdx = doc.nodes[targetId]?.children.length ?? 0;
    deps.ctx.pushUndoOps([
      { type: "create-node", nodeId: newId },
      { type: "splice-in", parentId: targetId, childId: newId, index: insertIdx },
    ]);
    handle.change((d) => {
      d.nodes[newId] = { content: "", starred: false, children: [] };
      d.nodes[targetId].children.push(newId);
    });
    setFocusedBulletId(newId);
  }

  /** Restore context from URL or localStorage. Call once at mount time. */
  function restoreContext() {
    const reachable = deps.reachableIds();
    const params = new URLSearchParams(window.location.search);
    const bulletId = params.get("bullet-id");
    if (bulletId && doc.nodes[bulletId] && reachable.has(bulletId)) {
      setContextId(bulletId);
    } else {
      const saved = localStorage.getItem(contextStorageKey);
      if (saved && doc.nodes[saved] && reachable.has(saved)) {
        _setContextId(saved);
      }
    }
  }

  deps.ctx.setFocusedBulletId = setFocusedBulletId;

  return {
    contextId,
    contextRootId,
    navHistory,
    focusedBulletId,
    focusedParentHint,
    focusCursorOffset,
    setFocusedBulletId,
    contextMenu,
    setContextMenu,
    activeTag,
    setActiveTag,
    allTags,
    tagResults,
    openTag,
    goToContext,
    focusTitle,
    goBack,
    goUp,
    goHome,
    addBulletAtEnd,
    restoreContext,
  };
}
