import infoHtml from "./info.html?raw";
import type { Patch } from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";
import { makeDocumentProjection } from "@automerge/automerge-repo-solid-primitives";
import { createSignal, createMemo, For, Show, onMount, onCleanup, untrack } from "solid-js";
import type { BulletsDoc } from "./datatype.ts";
import {
  findParentId,
  isAutomergeUrl,
  isYouTubeUrl,
  imageTypeLabel,
  isImageBullet,
  getReachableIds,
} from "./tree-utils.ts";
import { STRUCTURAL_DEBOUNCE_MS } from "./constants.ts";
import { BulletItem } from "./components/BulletItem.tsx";
import { NavigationBar } from "./components/NavigationBar.tsx";
import { ContextMenu } from "./components/ContextMenu.tsx";
import { useLocalViewState } from "./hooks/useLocalViewState.ts";
import { useTitleResolvers } from "./hooks/useTitleResolvers.ts";
import { useUndoRedo } from "./hooks/useUndoRedo.ts";
import { useNavigation } from "./hooks/useNavigation.ts";
import { useSelection } from "./hooks/useSelection.ts";
import { useFavorites } from "./hooks/useFavorites.ts";
import { useSearch } from "./hooks/useSearch.ts";
// DISABLED: mirroring feature temporarily disabled, will be re-enabled later
// import { useMirrors } from "./hooks/useMirrors.ts";
import { useTreeRepair } from "./hooks/useTreeRepair.ts";
import { useMigration } from "./hooks/useMigration.ts";
import { isDocFromFuture } from "./schema.ts";
import { useClipboard } from "./hooks/useClipboard.ts";
import { useDragDrop } from "./hooks/useDragDrop.ts";
import { createToolContext } from "./tool-context.ts";
import { TitleEditor } from "./features/TitleEditor.tsx";
import "./style.css";

/** Returns true if any patch touches children arrays, rootId, or mirroredIds. */
function hasStructuralChange(patches: Patch[]): boolean {
  return patches.some(
    (p) =>
      p.path.includes("children") ||
      p.path[0] === "rootId" ||
      p.path[0] === "mirroredIds",
  );
}

declare const __BULLETS_VERSION__: string;
const BULLETS_VERSION = __BULLETS_VERSION__;

export function BulletsTool(props: {
  handle: DocHandle<BulletsDoc>;
  element: HTMLElement;
}) {
  console.log(`[Bullets] version ${BULLETS_VERSION}`);

  // Fix: the main column flex item (2 levels up) has min-width: auto, which
  // lets bullet content push the flex layout and shift the left edge.
  // Setting min-width: 0 and overflow: hidden breaks that chain.
  props.element.style.overflow = "hidden";
  const mainColumn = props.element.parentElement?.parentElement;
  if (mainColumn) {
    mainColumn.style.minWidth = "0";
    mainColumn.style.overflow = "hidden";
  }

  const doc = makeDocumentProjection(props.handle);

  // Structural-change version counter: increments only when patches touch
  // children/rootId/mirroredIds, so content edits skip expensive DFS traversals.
  // Debounced so rapid remote sync messages coalesce into a single DFS run.
  const [structuralVersion, setStructuralVersion] = createSignal(0);
  let structuralTimer: number | undefined;
  const onStructuralChange = ({ patches }: { patches: Patch[] }) => {
    if (hasStructuralChange(patches)) {
      if (structuralTimer === undefined) {
        setStructuralVersion((v) => v + 1);
      }
      clearTimeout(structuralTimer);
      structuralTimer = window.setTimeout(() => {
        structuralTimer = undefined;
        setStructuralVersion((v) => v + 1);
      }, STRUCTURAL_DEBOUNCE_MS);
    }
  };
  props.handle.on("change", onStructuralChange);
  onCleanup(() => {
    props.handle.off("change", onStructuralChange);
    clearTimeout(structuralTimer);
    try { cleanupBlobUrls(); } catch {}
  });

  // Reachable node IDs. Only nodes reachable from rootId via children links.
  const reachableIds = createMemo(() => {
    structuralVersion();
    return untrack(() => getReachableIds(doc));
  });

  // DOM refs (owned by tool.tsx, passed to hooks as getters)
  let bulletsListRef!: HTMLDivElement;
  let containerRef!: HTMLDivElement;
  let titleRef!: HTMLHeadingElement;
  let favPanelRef!: HTMLDivElement;
  let searchInputRef!: HTMLInputElement;

  // --- Hook instantiation ---

  const {
    isNodeCollapsed, setNodeCollapsed, toggleNodeCollapsed,
    isEmbedExpanded, setEmbedExpanded, toggleEmbedExpanded,
  } = useLocalViewState({ handleUrl: props.handle.url, doc });

  const { resolveDocTitle, resolveYouTubeTitle, resolveImageSrc, cleanupBlobUrls } = useTitleResolvers({ element: props.element });

  // getDisplayText stays in tool.tsx since it depends on multiple hooks
  function getDisplayText(_id: string, content: string): string {
    const node = doc.nodes[_id];
    if (isImageBullet(content, node?.contentType)) return node?.title || imageTypeLabel(content);
    const trimmed = content.trim();
    if (isAutomergeUrl(trimmed)) {
      const title = resolveDocTitle(trimmed)();
      return title && title !== "..." ? title : content;
    }
    if (isYouTubeUrl(trimmed)) {
      const title = resolveYouTubeTitle(trimmed)();
      return title && title !== "Loading…" ? title : content;
    }
    return content;
  }

  const ctx = createToolContext();

  const { pushUndoOps, markTextEdit, handleUndoRedo, undo, redo } = useUndoRedo({
    handle: props.handle,
    doc,
    ctx,
  });

  const nav = useNavigation({
    handle: props.handle,
    doc,
    reachableIds,
    ctx,
    setNodeCollapsed,
    setEmbedExpanded,
    getTitleRef: () => titleRef,
    getDisplayText,
  });
  const {
    contextId, contextRootId, focusedBulletId, focusedParentHint, focusCursorOffset,
    setFocusedBulletId, contextMenu, setContextMenu, activeTag,
    allTags, tagResults, openTag, goToContext, focusTitle, goBack, goUp, goHome,
    addBulletAtEnd, restoreContext,
  } = nav;

  const sel = useSelection({
    handle: props.handle,
    doc,
    contextRootId,
    ctx,
    setNodeCollapsed,
    isNodeCollapsed,
    getBulletsListRef: () => bulletsListRef,
  });
  const {
    selectedIds, clearSelection, extendSelection, getSelectionRoots,
    indentSelection, outdentSelection, deleteSelection,
    handleListMouseDown, handleDocumentMouseMove, handleDocumentMouseUp,
    isSkipNextClickClear, resetSkipNextClickClear,
  } = sel;

  const fav = useFavorites({ doc, handle: props.handle, reachableIds });
  const {
    showFavorites, setShowFavorites, toggleStar, getStarredNodes,
    favDragIdx, favDropTarget, handleFavDragStart, handleFavDrop, handleFavDragEnd,
    handleFavDragOver, handleFavDragLeave,
    isSkipNextFavClose, setSkipNextFavClose,
  } = fav;

  const {
    showSearch, searchQuery, setSearchQuery, searchSelectedIdx, setSearchSelectedIdx,
    searchResults, navigateToResult, openSearch, closeSearch, handleSearchKey,
  } = useSearch({
    doc,
    reachableIds,
    goToContext,
    getDisplayText,
    closeFavorites: () => setShowFavorites(false),
    getSearchInputRef: () => searchInputRef,
  });

  // DISABLED: mirroring feature temporarily disabled, will be re-enabled later
  // const {
  //   mirrorClipboardId, setMirrorClipboardId, isNodeMirrored, copyAsMirror, handleMirrorKeys,
  // } = useMirrors({
  //   doc,
  //   handle: props.handle,
  //   contextRootId,
  //   ctx,
  // });
  const mirrorClipboardId = () => null;
  const setMirrorClipboardId = (_id: string | null) => {};
  const isNodeMirrored = (_id: string) => false;

  useMigration({ doc, handle: props.handle });
  useTreeRepair({ doc, handle: props.handle, structuralVersion });

  const { handleCopyEvent, handleCutEvent, handlePasteEvent, copyBullet } = useClipboard({
    doc,
    handle: props.handle,
    selectedIds,
    getSelectionRoots,
    deleteSelection,
    contextRootId,
    ctx,
    mirrorClipboardId,
    setMirrorClipboardId,
    setNodeCollapsed,
  });

  const {
    draggedId, setDraggedId, dropTarget, fileDragOver,
    handleDragOver, handleDrop, handleDragLeave, handleDragEnd,
    handleDocFileDragEnter, handleDocFileDragLeave, handleDocFileDragOver, handleDocFileDrop,
  } = useDragDrop({
    doc,
    handle: props.handle,
    contextRootId,
    ctx,
    selectedIds,
    getSelectionRoots,
    setNodeCollapsed,
    isNodeCollapsed,
    setEmbedExpanded,
    getBulletsListRef: () => bulletsListRef,
    getElement: () => props.element,
  });

  // --- Info panel ---
  const [showInfo, setShowInfo] = createSignal(false);

  // --- Completed bullets visibility ---
  const [showCompleted, setShowCompleted] = createSignal(false);

  function toggleComplete(id: string) {
    const node = doc.nodes[id];
    if (!node) return;
    const oldCompleted = !!node.completed;
    pushUndoOps([{ type: "set-completed", nodeId: id, oldCompleted }]);
    props.handle.change((d) => {
      const n = d.nodes[id];
      if (n) n.completed = !oldCompleted;
    });
  }

  // --- Mobile toolbar ---
  const [isTouchDevice] = createSignal(
    "ontouchstart" in window || navigator.maxTouchPoints > 0
  );
  const [mobileToolbarVisible, setMobileToolbarVisible] = createSignal(false);

  // Show mobile toolbar when a bullet content is focused on touch devices
  function handleFocusIn(e: FocusEvent) {
    if (!isTouchDevice()) return;
    const target = e.target as HTMLElement;
    if (target.classList?.contains("bullet-content")) {
      setMobileToolbarVisible(true);
    }
  }

  function handleFocusOut(_e: FocusEvent) {
    if (!isTouchDevice()) return;
    // Delay to allow clicks on toolbar buttons before hiding
    setTimeout(() => {
      const active = document.activeElement;
      if (!active) { setMobileToolbarVisible(false); return; }
      const inBullet = active.classList?.contains("bullet-content");
      const inToolbar = active.closest?.(".bullets-mobile-toolbar");
      if (!inBullet && !inToolbar) {
        setMobileToolbarVisible(false);
      }
    }, 100);
  }

  function mobileIndent() {
    const active = document.activeElement as HTMLElement;
    if (!active?.classList?.contains("bullet-content")) return;
    const row = active.closest(".bullet-row") as HTMLElement | null;
    const bulletId = row?.dataset.bulletId;
    if (!bulletId) return;
    // Simulate Tab key
    active.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
  }

  function mobileOutdent() {
    const active = document.activeElement as HTMLElement;
    if (!active?.classList?.contains("bullet-content")) return;
    active.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
  }

  function mobileComplete() {
    const active = document.activeElement as HTMLElement;
    if (!active?.classList?.contains("bullet-content")) return;
    const row = active.closest(".bullet-row") as HTMLElement | null;
    const bulletId = row?.dataset.bulletId;
    if (bulletId) toggleComplete(bulletId);
  }

  // --- Remaining functions that stay in tool.tsx ---

  function handleContextMenu(e: MouseEvent, bulletId: string, parentId: string, childIndex: number) {
    e.preventDefault();
    const container = (e.target as HTMLElement).closest(".bullets-container");
    if (container) {
      const rect = container.getBoundingClientRect();
      setContextMenu({
        x: e.clientX - rect.left + container.scrollLeft,
        y: e.clientY - rect.top + container.scrollTop,
        bulletId,
        parentId,
        childIndex,
      });
    } else {
      setContextMenu({ x: e.clientX, y: e.clientY, bulletId, parentId, childIndex });
    }
  }

  function closeContextMenu() {
    setContextMenu(null);
  }

  function handleGlobalClick(e: MouseEvent) {
    if (contextMenu()) {
      closeContextMenu();
    }
    if (showFavorites() && !isSkipNextFavClose()) {
      const inFavPanel = (e.target as HTMLElement).closest?.(".bullets-favorites-panel, .bullets-hamburger");
      if (!inFavPanel) {
        setShowFavorites(false);
      }
    }
    if (showSearch()) {
      const inSearch = (e.target as HTMLElement).closest?.(".bullets-search-panel, .bullets-search-btn");
      if (!inSearch) {
        closeSearch();
      }
    }
    if (showInfo()) {
      const inInfo = (e.target as HTMLElement).closest?.(".bullets-info-panel, .bullets-info-btn");
      if (!inInfo) {
        setShowInfo(false);
      }
    }
    if (isSkipNextClickClear()) {
      resetSkipNextClickClear();
      return;
    }
    if (selectedIds().size > 0) {
      clearSelection();
    }
  }

  function deleteBullet(id: string, parentId: string, _childIndex: number) {
    const currentParentId = findParentId(doc, id) ?? parentId;
    const parent = doc.nodes[currentParentId];
    if (!parent) return;
    const idx = parent.children.indexOf(id);
    if (idx === -1) return;

    pushUndoOps([{ type: "splice-out", parentId: currentParentId, childId: id, index: idx }]);
    props.handle.change((d) => {
      const p = d.nodes[currentParentId];
      if (!p) return;
      const i = p.children.indexOf(id);
      if (i !== -1) p.children.splice(i, 1);

      // DISABLED: mirroring feature temporarily disabled, will be re-enabled later
      // if (d.mirroredIds && d.mirroredIds.includes(id)) {
      //   let refCount = 0;
      //   for (const node of Object.values(d.nodes)) {
      //     if (!node) continue;
      //     for (const childId of node.children) {
      //       if (childId === id) refCount++;
      //     }
      //   }
      //   if (refCount === 0) {
      //     const mIdx = d.mirroredIds.indexOf(id);
      //     if (mIdx !== -1) d.mirroredIds.splice(mIdx, 1);
      //   }
      // }
    });
  }

  function copyLink(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("bullet-id", id);
    navigator.clipboard.writeText(url.toString());
  }

  // --- Event listener registration ---

  onMount(() => {
    document.addEventListener("click", handleGlobalClick);
    document.addEventListener("dragend", handleDragEnd);
    document.addEventListener("keydown", handleUndoRedo);
    document.addEventListener("keydown", (e: KeyboardEvent) => handleSearchKey(e, containerRef));
    // DISABLED: mirroring feature temporarily disabled, will be re-enabled later
    // document.addEventListener("keydown", handleMirrorKeys, true);
    document.addEventListener("copy", handleCopyEvent);
    document.addEventListener("cut", handleCutEvent);
    document.addEventListener("paste", handlePasteEvent, true);
    document.addEventListener("mousemove", handleDocumentMouseMove);
    document.addEventListener("mouseup", handleDocumentMouseUp);
    document.addEventListener("dragenter", handleDocFileDragEnter);
    document.addEventListener("dragleave", handleDocFileDragLeave);
    document.addEventListener("dragover", handleDocFileDragOver);
    document.addEventListener("drop", handleDocFileDrop);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);

    restoreContext();
  });

  onCleanup(() => {
    document.removeEventListener("click", handleGlobalClick);
    document.removeEventListener("dragend", handleDragEnd);
    document.removeEventListener("keydown", handleUndoRedo);
    // Note: the search key handler is an anonymous wrapper; cleanup relies on component unmount
    // DISABLED: mirroring feature temporarily disabled, will be re-enabled later
    // document.removeEventListener("keydown", handleMirrorKeys, true);
    document.removeEventListener("copy", handleCopyEvent);
    document.removeEventListener("cut", handleCutEvent);
    document.removeEventListener("paste", handlePasteEvent, true);
    document.removeEventListener("mousemove", handleDocumentMouseMove);
    document.removeEventListener("mouseup", handleDocumentMouseUp);
    document.removeEventListener("dragenter", handleDocFileDragEnter);
    document.removeEventListener("dragleave", handleDocFileDragLeave);
    document.removeEventListener("dragover", handleDocFileDragOver);
    document.removeEventListener("drop", handleDocFileDrop);
    document.removeEventListener("focusin", handleFocusIn);
    document.removeEventListener("focusout", handleFocusOut);
  });

  // --- JSX ---

  const docFromFuture = () => isDocFromFuture(doc);

  return (
    <div ref={containerRef} class={`bullets-container${fileDragOver() ? " file-drag-over" : ""}${docFromFuture() ? " read-only" : ""}${isTouchDevice() && mobileToolbarVisible() ? " mobile-toolbar-active" : ""}`}>
      <Show when={docFromFuture()}>
        <div class="bullets-version-gate">
          This document uses a newer format. Update the Bullets tool to edit.
        </div>
      </Show>
      <div class="bullets-top-bar">
        <NavigationBar
          contextId={contextId()}
          activeTag={activeTag()}
          onBack={goBack}
          onUp={goUp}
          onHome={goHome}
        />
        <div style={{ display: "flex", "align-items": "center", gap: "2px" }}>
          <button
            class={`bullets-info-btn${showInfo() ? " active" : ""}`}
            ref={(el) => {
              el.addEventListener("click", (e) => {
                e.stopPropagation();
                setShowInfo(!showInfo());
              });
            }}
            title="Help"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" width="16" height="16">
              <circle cx="10" cy="10" r="7.5" />
              <line x1="10" y1="9" x2="10" y2="14" />
              <circle cx="10" cy="6.5" r="0.75" fill="currentColor" stroke="none" />
            </svg>
          </button>
          <button
            class={`bullets-search-btn${showSearch() ? " active" : ""}`}
            ref={(el) => {
              el.addEventListener("click", (e) => {
                e.stopPropagation();
                if (showSearch()) {
                  closeSearch();
                } else {
                  openSearch();
                }
              });
            }}
            title="Search (Cmd+F)"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <circle cx="8.5" cy="8.5" r="5.5" />
              <line x1="12.5" y1="12.5" x2="17" y2="17" />
            </svg>
          </button>
          <button
            class={`bullets-completed-btn${showCompleted() ? " active" : ""}`}
            ref={(el) => {
              el.addEventListener("click", (e) => {
                e.stopPropagation();
                setShowCompleted(!showCompleted());
              });
            }}
            title={showCompleted() ? "Hide completed" : "Show completed"}
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <polyline points="4,10 8,14 16,6" />
            </svg>
          </button>
          <button
            class={`bullets-hamburger${showFavorites() ? " active" : ""}`}
            ref={(el) => {
              el.addEventListener("click", (e) => {
                e.stopPropagation();
                setShowFavorites(!showFavorites());
              });
            }}
            title="Favorites"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18">
              <rect x="2" y="4" width="16" height="2" rx="1" />
              <rect x="2" y="9" width="16" height="2" rx="1" />
              <rect x="2" y="14" width="16" height="2" rx="1" />
            </svg>
          </button>
        </div>
      </div>
      <Show when={showInfo()}>
        <div class="bullets-info-panel" innerHTML={infoHtml} />
      </Show>
      <Show when={showFavorites()}>
        <div
          class="bullets-favorites-panel"
          ref={favPanelRef}
          onDragOver={(e) => handleFavDragOver(e, favPanelRef)}
          onDrop={handleFavDrop}
          onDragLeave={(e) => handleFavDragLeave(e, favPanelRef)}
        >
          <div class="bullets-favorites-header">Favorites</div>
          <Show when={getStarredNodes().length === 0}>
            <div class="bullets-favorites-empty">No starred bullets</div>
          </Show>
          <For each={getStarredNodes()}>
            {(item, idx) => (
              <div
                class={`bullets-favorites-item${favDragIdx() === idx() ? " dragging" : ""}`}
                draggable={true}
                onDragStart={(e) => handleFavDragStart(idx(), e)}
                onDragEnd={handleFavDragEnd}
                onClick={() => {
                  goToContext(item.id);
                  setShowFavorites(false);
                }}
              >
                <span class="bullets-favorites-item-text">
                  {isImageBullet(item.content, doc.nodes[item.id]?.contentType)
                    ? (doc.nodes[item.id]?.title || imageTypeLabel(item.content))
                    : isAutomergeUrl(item.content)
                      ? resolveDocTitle(item.content.trim())()
                      : isYouTubeUrl(item.content)
                        ? resolveYouTubeTitle(item.content.trim())()
                        : item.content}
                </span>
                <span
                  class="bullet-star starred"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSkipNextFavClose(true);
                    setTimeout(() => { setSkipNextFavClose(false); }, 0);
                    toggleStar(item.id);
                  }}
                  title="Unstar"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill="currentColor" stroke="currentColor" stroke-width="1" />
                  </svg>
                </span>
              </div>
            )}
          </For>
          <Show when={favDropTarget() !== null && favDragIdx() !== null}>
            <div
              class="bullets-fav-drop-indicator"
              style={{
                top: `${favDropTarget()!.y}px`,
                left: "14px",
                right: "14px",
              }}
            />
          </Show>
          <Show when={allTags().length > 0}>
            <div class="bullets-favorites-header" style={{ "margin-top": "4px" }}>Tags</div>
            <For each={allTags()}>
              {(tag) => (
                <div class="bullets-favorites-item" onClick={() => { openTag(tag); setShowFavorites(false); }}>
                  <span class="bullets-favorites-item-text">#{tag}</span>
                </div>
              )}
            </For>
          </Show>
        </div>
      </Show>
      <Show when={showSearch()}>
        <div class="bullets-search-panel">
          <input
            ref={searchInputRef}
            class="bullets-search-input"
            type="text"
            placeholder="Search bullets..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                closeSearch();
              } else if (e.key === "ArrowDown") {
                e.preventDefault();
                const max = searchResults().length - 1;
                setSearchSelectedIdx((i) => Math.min(i + 1, max));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setSearchSelectedIdx((i) => Math.max(i - 1, -1));
              } else if (e.key === "Enter") {
                const idx = searchSelectedIdx();
                const results = searchResults();
                if (idx >= 0 && idx < results.length) {
                  navigateToResult(results[idx]);
                }
              }
            }}
          />
          <Show when={searchQuery().trim().length > 0}>
            <Show
              when={searchResults().length > 0}
              fallback={<div class="bullets-search-empty">No results</div>}
            >
              <For each={searchResults()}>
                {(result, idx) => (
                  <div
                    class={`bullets-search-result${searchSelectedIdx() === idx() ? " selected" : ""}`}
                    onClick={() => navigateToResult(result)}
                    onMouseEnter={() => setSearchSelectedIdx(idx())}
                  >
                    <span>
                      {result.displayText.slice(0, result.matchStart)}
                      <span class="bullets-search-match">
                        {result.displayText.slice(result.matchStart, result.matchStart + result.matchLength)}
                      </span>
                      {result.displayText.slice(result.matchStart + result.matchLength)}
                    </span>
                  </div>
                )}
              </For>
            </Show>
          </Show>
        </div>
      </Show>
      <Show when={!activeTag()}>
        <TitleEditor
          doc={doc}
          handle={props.handle}
          contextId={contextId}
          contextRootId={contextRootId}
          ctx={ctx}
          markTextEdit={markTextEdit}
          focusTitle={focusTitle}
          isEmbedExpanded={isEmbedExpanded}
          toggleEmbedExpanded={toggleEmbedExpanded}
          resolveDocTitle={resolveDocTitle}
          resolveYouTubeTitle={resolveYouTubeTitle}
          resolveImageSrc={resolveImageSrc}
          onTitleRef={(el) => { titleRef = el; }}
          setFocusedBulletId={setFocusedBulletId}
          containerRef={containerRef}
        />
      </Show>
      <Show when={activeTag()} fallback={
        <>
          <div
            class="bullets-list"
            ref={bulletsListRef}
            onMouseDown={handleListMouseDown}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onDragLeave={handleDragLeave}
          >
            <For each={doc.nodes?.[contextRootId()]?.children}>
              {(childId, index) => (
                <BulletItem
                  nodeId={childId}
                  parentId={contextRootId()}
                  childIndex={index}
                  doc={doc}
                  handle={props.handle}
                  depth={0}
                  contextRootId={contextRootId}
                  onNavigate={goToContext}
                  focusedId={focusedBulletId}
                  focusedParentHint={focusedParentHint}
                  focusCursorOffset={focusCursorOffset}
                  setFocusedId={setFocusedBulletId}
                  onContextMenu={handleContextMenu}
                  draggedId={draggedId}
                  setDraggedId={setDraggedId}
                  pushUndoOps={pushUndoOps}
                  markTextEdit={markTextEdit}
                  selectedIds={selectedIds}
                  extendSelection={extendSelection}
                  clearSelection={clearSelection}
                  indentSelection={indentSelection}
                  outdentSelection={outdentSelection}
                  deleteSelection={deleteSelection}
                  onToggleStar={toggleStar}
                  resolveDocTitle={resolveDocTitle}
                  resolveYouTubeTitle={resolveYouTubeTitle}
                  resolveImageSrc={resolveImageSrc}
                  isNodeMirrored={isNodeMirrored}
                  onTagClick={openTag}
                  onComplete={toggleComplete}
                  showCompleted={showCompleted}
                  focusTitle={focusTitle}
                  isNodeCollapsed={isNodeCollapsed}
                  setNodeCollapsed={setNodeCollapsed}
                  toggleNodeCollapsed={toggleNodeCollapsed}
                  isEmbedExpanded={isEmbedExpanded}
                  setEmbedExpanded={setEmbedExpanded}
                  toggleEmbedExpanded={toggleEmbedExpanded}
                />
              )}
            </For>
            <Show when={dropTarget()}>
              <div
                class="bullets-drop-indicator"
                style={{
                  top: `${dropTarget()!.indicatorY}px`,
                  left: `${dropTarget()!.indicatorLeft}px`,
                  right: "0",
                }}
              />
            </Show>
          </div>
          <button class="bullets-add-btn" onClick={addBulletAtEnd} title="Add bullet">
            +
          </button>
        </>
      }>
        <div class="bullets-tag-header">#{activeTag()}</div>
        <div class="bullets-tag-results">
          <For each={tagResults()}>
            {(result) => (
              <div class="bullets-tag-result" onClick={() => goToContext(result.id)}>
                {result.content}
              </div>
            )}
          </For>
          <Show when={tagResults().length === 0}>
            <div class="bullets-search-empty">No bullets with this tag</div>
          </Show>
        </div>
      </Show>
      <ContextMenu
        state={contextMenu()}
        isCompleted={(id) => !!doc.nodes[id]?.completed}
        onDelete={deleteBullet}
        onComplete={toggleComplete}
        onCopyBullet={copyBullet}
        onCopyLink={copyLink}
        // DISABLED: mirroring feature temporarily disabled, will be re-enabled later
        // onCopyAsMirror={copyAsMirror}
        onCopyAsMirror={() => {}}
        onClose={closeContextMenu}
      />
      <Show when={isTouchDevice() && mobileToolbarVisible()}>
        <div class="bullets-mobile-toolbar">
          <button
            class="bullets-mobile-toolbar-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={mobileOutdent}
            title="Outdent"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
              <polyline points="15,6 9,12 15,18" />
              <line x1="9" y1="12" x2="21" y2="12" />
            </svg>
          </button>
          <button
            class="bullets-mobile-toolbar-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={mobileIndent}
            title="Indent"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
              <polyline points="9,6 15,12 9,18" />
              <line x1="3" y1="12" x2="15" y2="12" />
            </svg>
          </button>
          <button
            class="bullets-mobile-toolbar-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={undo}
            title="Undo"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
              <polyline points="4,8 4,14 10,14" />
              <path d="M4,14 C4,14 6,6 14,6 C18,6 20,9 20,12 C20,15 18,18 14,18" />
            </svg>
          </button>
          <button
            class="bullets-mobile-toolbar-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={redo}
            title="Redo"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
              <polyline points="20,8 20,14 14,14" />
              <path d="M20,14 C20,14 18,6 10,6 C6,6 4,9 4,12 C4,15 6,18 10,18" />
            </svg>
          </button>
          <button
            class="bullets-mobile-toolbar-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={mobileComplete}
            title="Complete"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="20" height="20">
              <polyline points="5,12 10,17 19,7" />
            </svg>
          </button>
        </div>
      </Show>
    </div>
  );
}
