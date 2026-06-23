import { createSignal, type Accessor } from "solid-js";
import type { DocHandle } from "@automerge/automerge-repo";
import type { BulletsDoc } from "../datatype.ts";

export function useFavorites(deps: {
  doc: BulletsDoc;
  handle: DocHandle<BulletsDoc>;
  reachableIds: Accessor<Set<string>>;
}) {
  const { doc, handle } = deps;

  const [showFavorites, setShowFavorites] = createSignal(false);
  let _skipNextFavClose = false;
  const [favDragIdx, setFavDragIdx] = createSignal<number | null>(null);
  const [favDropTarget, setFavDropTarget] = createSignal<{ idx: number; y: number } | null>(null);

  function toggleStar(id: string) {
    const reachable = deps.reachableIds();
    handle.change((d) => {
      const n = d.nodes[id];
      if (!n) return;
      n.starred = !n.starred;

      if (!d.starredIds) {
        d.starredIds = [];
        for (const [nid, node] of Object.entries(d.nodes)) {
          if (nid === d.rootId) continue;
          if (!reachable.has(nid)) continue;
          if (node?.starred) d.starredIds.push(nid);
        }
        return;
      }

      if (n.starred) {
        d.starredIds.push(id);
      } else {
        const idx = d.starredIds.indexOf(id);
        if (idx !== -1) d.starredIds.splice(idx, 1);
      }
    });
  }

  function getStarredNodes(): { id: string; content: string }[] {
    const reachable = deps.reachableIds();
    const ids = doc.starredIds;
    if (ids) {
      const results: { id: string; content: string }[] = [];
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        if (!reachable.has(id)) continue;
        const node = doc.nodes[id];
        if (node?.starred) {
          results.push({ id, content: node.content || "Untitled" });
        }
      }
      return results;
    }
    const results: { id: string; content: string }[] = [];
    if (!doc.nodes) return results;
    for (const [id, node] of Object.entries(doc.nodes)) {
      if (id === doc.rootId) continue;
      if (!reachable.has(id)) continue;
      if (node?.starred) {
        results.push({ id, content: node.content || "Untitled" });
      }
    }
    return results;
  }

  function handleFavDragStart(idx: number, e: DragEvent) {
    setFavDragIdx(idx);
    e.dataTransfer!.effectAllowed = "move";
  }

  function handleFavDragOver(e: DragEvent, favPanelRef: HTMLDivElement) {
    e.preventDefault();
    e.dataTransfer!.dropEffect = "move";
    if (favDragIdx() === null) return;

    const items = Array.from(favPanelRef.querySelectorAll<HTMLElement>(".bullets-favorites-item"));
    const mouseY = e.clientY;

    let gapIdx = items.length;
    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (mouseY < rect.top + rect.height / 2) {
        gapIdx = i;
        break;
      }
    }

    const panelRect = favPanelRef.getBoundingClientRect();
    let indicatorY: number;
    if (items.length === 0) {
      indicatorY = 0;
    } else if (gapIdx === 0) {
      indicatorY = items[0].getBoundingClientRect().top - panelRect.top;
    } else if (gapIdx >= items.length) {
      indicatorY = items[items.length - 1].getBoundingClientRect().bottom - panelRect.top;
    } else {
      const aboveRect = items[gapIdx - 1].getBoundingClientRect();
      const belowRect = items[gapIdx].getBoundingClientRect();
      indicatorY = (aboveRect.bottom + belowRect.top) / 2 - panelRect.top;
    }

    setFavDropTarget({ idx: gapIdx, y: indicatorY });
  }

  function handleFavDrop(e: DragEvent) {
    e.preventDefault();
    const fromIdx = favDragIdx();
    const target = favDropTarget();
    setFavDragIdx(null);
    setFavDropTarget(null);

    if (fromIdx === null || target === null) return;
    const toIdx = target.idx;
    if (fromIdx === toIdx || fromIdx === toIdx - 1) return;

    handle.change((d) => {
      if (!d.starredIds) return;
      const id = d.starredIds[fromIdx];
      d.starredIds.splice(fromIdx, 1);
      const adjustedIdx = fromIdx < toIdx ? toIdx - 1 : toIdx;
      d.starredIds.splice(adjustedIdx, 0, id);
    });
  }

  function handleFavDragEnd() {
    setFavDragIdx(null);
    setFavDropTarget(null);
  }

  function handleFavDragLeave(e: DragEvent, favPanelRef: HTMLDivElement) {
    if (!favPanelRef.contains(e.relatedTarget as Node)) {
      setFavDropTarget(null);
    }
  }

  return {
    showFavorites,
    setShowFavorites,
    isSkipNextFavClose: () => _skipNextFavClose,
    setSkipNextFavClose: (v: boolean) => { _skipNextFavClose = v; },
    favDragIdx,
    favDropTarget,
    toggleStar,
    getStarredNodes,
    handleFavDragStart,
    handleFavDragOver,
    handleFavDrop,
    handleFavDragEnd,
    handleFavDragLeave,
  };
}
