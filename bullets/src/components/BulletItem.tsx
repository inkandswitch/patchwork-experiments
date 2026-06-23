import {
  For,
  Show,
  createEffect,
  createSignal,
  on,
  onCleanup,
  onMount,
  type Accessor,
} from "solid-js";
import { updateText } from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";
import type { BulletsDoc, UndoOp } from "../datatype.ts";
import {
  isAutomergeUrl,
  isYouTubeUrl,
  extractYouTubeVideoId,
  isImageDataUrl,
  imageTypeLabel,
  isImageBullet,
} from "../tree-utils.ts";
import { isNodeInSet } from "../instance-keys.ts";
import {
  renderContentWithLinks,
  hasRichContent,
  restoreCursor,
  focusBulletContent,
} from "../dom-utils.ts";
import { createBulletKeyHandler } from "../bullet-keyboard.ts";
import { AutomergeEmbed } from "./AutomergeEmbed.tsx";

export function BulletItem(props: {
  nodeId: string;
  parentId: string;
  childIndex: Accessor<number>;
  doc: BulletsDoc;
  handle: DocHandle<BulletsDoc>;
  depth: number;
  contextRootId: Accessor<string>;
  onNavigate: (id: string) => void;
  focusedId: Accessor<string | null>;
  focusedParentHint: Accessor<string | null>;
  focusCursorOffset: Accessor<number | null>;
  setFocusedId: (id: string | null, parentHint?: string, cursorOffset?: number) => void;
  onContextMenu: (e: MouseEvent, bulletId: string, parentId: string, childIndex: number) => void;
  draggedId: Accessor<string | null>;
  setDraggedId: (id: string | null) => void;
  pushUndoOps: (ops: UndoOp[], focusId?: string | null) => void;
  markTextEdit: () => void;
  selectedIds: Accessor<Set<string>>;
  extendSelection: (fromId: string, fromParentId: string, direction: "up" | "down") => void;
  clearSelection: () => void;
  indentSelection: () => void;
  outdentSelection: () => void;
  deleteSelection: () => void;
  onToggleStar: (id: string) => void;
  resolveDocTitle: (url: string) => Accessor<string>;
  resolveYouTubeTitle: (url: string) => Accessor<string>;
  resolveImageSrc: (url: string) => Accessor<string | null>;
  isNodeMirrored: (id: string) => boolean;
  onTagClick: (tag: string) => void;
  onComplete: (id: string) => void;
  showCompleted: () => boolean;
  focusTitle: () => void;
  isNodeCollapsed: (id: string) => boolean;
  setNodeCollapsed: (id: string, value: boolean) => void;
  toggleNodeCollapsed: (id: string) => void;
  isEmbedExpanded: (id: string) => boolean;
  setEmbedExpanded: (id: string, value: boolean) => void;
  toggleEmbedExpanded: (id: string) => void;
}) {
  let contentRef!: HTMLSpanElement;
  const [contentFocused, setContentFocused] = createSignal(false);

  const node = () => props.doc.nodes[props.nodeId];
  const hasChildren = () => node()?.children.length > 0;
  const isCollapsed = () => props.isNodeCollapsed(props.nodeId);
  const isAmUrl = () => isAutomergeUrl(node()?.content ?? "") && node()?.contentType !== "image";
  const isYtUrl = () => isYouTubeUrl(node()?.content ?? "");
  const ytVideoId = () => extractYouTubeVideoId(node()?.content ?? "");
  const isImageUrl = () => isImageBullet(node()?.content ?? "", node()?.contentType);
  const imageSrc = () => {
    const n = node();
    if (!n) return null;
    if (isImageDataUrl(n.content)) return n.content.trim();
    if (n.contentType === "image" && isAutomergeUrl(n.content.trim())) {
      return props.resolveImageSrc(n.content.trim())();
    }
    return null;
  };
  const isPatchworkMode = () => customElements.get("patchwork-view") !== undefined;
  const canEmbed = () => isAmUrl() && isPatchworkMode();
  const embedExpanded = () => props.isEmbedExpanded(props.nodeId);
  const isCompleted = () => !!node()?.completed;
  const isStarred = () => node()?.starred ?? false;
  const isSpecial = () => isAmUrl() || isYtUrl() || isImageUrl();
  const showTitle = () => (isAmUrl() || isYtUrl()) && !contentFocused();

  // Composite key for this specific instance (nodeId::parentId)
  const instanceKey = () => props.nodeId + "::" + props.parentId;
  const isSelected = () => props.selectedIds().has(instanceKey());
  const isNodeInSelection = (nodeId: string) => isNodeInSet(props.selectedIds(), nodeId);

  // Auto-expand embed when content transitions to an automerge URL (e.g. paste).
  // Deferred so mount uses the persisted state.
  createEffect(on(canEmbed, (curr, prev) => {
    if (curr && !prev) {
      props.setEmbedExpanded(props.nodeId, true);
    }
  }, { defer: true }));

  // Sync contenteditable text from Automerge doc.
  // Images show a type label; web URLs render as clickable links when not focused.
  // Skip DOM update while user is actively editing to prevent cursor jumps (#7).
  createEffect(() => {
    const text = node()?.content ?? "";
    // Track these so this effect re-runs when the bullet re-mounts
    // after toggling show-completed visibility.
    isCompleted();
    props.showCompleted();
    if (!contentRef) return;
    if (isImageUrl()) {
      if (contentFocused()) return;
      const label = node()?.title || imageTypeLabel(text);
      if (contentRef.textContent !== label) contentRef.textContent = label;
      return;
    }
    if (contentFocused()) return;
    if (contentRef.textContent === text) return;
    if (hasRichContent(text)) {
      renderContentWithLinks(contentRef, text);
    } else {
      contentRef.textContent = text;
    }
  });

  // Focus management
  // When focusedParentHint is set, only the instance with matching parentId focuses.
  // When null, any instance can match (for non-mirrored operations like creating new bullets).
  createEffect(() => {
    const hint = props.focusedParentHint();
    const cursorOffset = props.focusCursorOffset();
    if (props.focusedId() === props.nodeId && (!hint || hint === props.parentId) && contentRef) {
      contentRef.focus();
      if (cursorOffset !== null) {
        restoreCursor(contentRef, cursorOffset);
      } else {
        const range = document.createRange();
        const sel = window.getSelection();
        if (contentRef.childNodes.length > 0) {
          range.setStartAfter(contentRef.lastChild!);
        } else {
          range.setStart(contentRef, 0);
        }
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
      contentRef.scrollIntoView({ block: "nearest" });
      props.setFocusedId(null);
    }
  });

  onMount(() => {
    const hint = props.focusedParentHint();
    if (props.focusedId() === props.nodeId && (!hint || hint === props.parentId) && contentRef) {
      contentRef.focus();
    }
  });

  // When a peer moves the subtree containing this bullet, SolidJS destroys
  // this component and recreates it under the new parent.  Detect that we
  // were focused at destruction time and request re-focus so the new
  // instance picks it up.
  onCleanup(() => {
    if (contentRef && document.activeElement === contentRef) {
      props.setFocusedId(props.nodeId);
    }
  });

  function handleContentFocus() {
    setContentFocused(true);
    // Strip rendered links/tags when entering edit mode
    if (contentRef.querySelector("a.bullet-link") || contentRef.querySelector(".bullet-tag")) {
      const text = node()?.content ?? "";
      contentRef.textContent = text;
    }
  }

  function handleContentBlur() {
    setContentFocused(false);
    const text = node()?.content ?? "";
    if (!isAmUrl() && !isImageUrl() && hasRichContent(text)) {
      renderContentWithLinks(contentRef, text);
    }
  }

  function handleContentMouseDown(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName === "A" && target.classList.contains("bullet-link")) {
      e.preventDefault();
      e.stopPropagation();
      const href = (target as HTMLAnchorElement).href;
      if (href) window.open(href, "_blank", "noopener");
    }
    if (target.classList.contains("bullet-tag")) {
      e.preventDefault();
      e.stopPropagation();
      const tag = target.dataset.tag;
      if (tag) props.onTagClick(tag);
    }
  }

  function handleInput() {
    props.clearSelection();
    props.markTextEdit();
    const newContent = contentRef.textContent || "";
    if (isImageUrl()) {
      props.handle.change((doc) => {
        const n = doc.nodes[props.nodeId];
        if (n) {
          if (typeof n.title === "string") {
            updateText(doc, ["nodes", props.nodeId, "title"], newContent);
          } else {
            n.title = newContent;
          }
        }
      });
      return;
    }
    props.handle.change((doc) => {
      const n = doc.nodes[props.nodeId];
      if (n) updateText(doc, ["nodes", props.nodeId, "content"], newContent);
    });

    // Render tags immediately when user types space after a tag
    if (!isAmUrl() && !isImageUrl() && hasRichContent(newContent)) {
      // Check if the character just before cursor is a space following a tag
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const preRange = document.createRange();
        preRange.selectNodeContents(contentRef);
        preRange.setEnd(range.startContainer, range.startOffset);
        const cursorOffset = preRange.toString().length;
        const textBefore = newContent.slice(0, cursorOffset);
        if (/\s$/.test(textBefore) && /#[a-zA-Z0-9_-]+\s$/.test(textBefore)) {
          renderContentWithLinks(contentRef, newContent);
          // Restore cursor position
          restoreCursor(contentRef, cursorOffset);
        }
      }
    }
  }

  const handleKeyDown = createBulletKeyHandler({
    nodeId: props.nodeId,
    parentId: props.parentId,
    contextRootId: props.contextRootId,
    doc: props.doc,
    handle: props.handle,
    getContentRef: () => contentRef,
    isImageUrl,
    hasChildren,
    isCollapsed,
    selectedIds: props.selectedIds,
    extendSelection: props.extendSelection,
    indentSelection: props.indentSelection,
    outdentSelection: props.outdentSelection,
    deleteSelection: props.deleteSelection,
    clearSelection: props.clearSelection,
    pushUndoOps: props.pushUndoOps,
    setFocusedId: props.setFocusedId,
    setNodeCollapsed: props.setNodeCollapsed,
    focusTitle: props.focusTitle,
  });

  function handleToggleCollapse() {
    props.toggleNodeCollapsed(props.nodeId);
  }

  let didDrag = false;

  function handleDotClick() {
    if (didDrag) return;
    if (isCompleted()) return;
    props.onNavigate(props.nodeId);
  }

  function handleDragStart(e: DragEvent) {
    didDrag = true;
    // If dragging a non-selected bullet, clear the selection
    if (props.selectedIds().size > 0 && !isSelected()) {
      props.clearSelection();
    }
    e.dataTransfer!.effectAllowed = "move";
    const row = (e.target as HTMLElement).closest(".bullet-row") as HTMLElement;
    if (row) {
      e.dataTransfer!.setDragImage(row, 10, row.clientHeight / 2);
    }
    requestAnimationFrame(() => props.setDraggedId(props.nodeId));
  }

  function handleTitleClick() {
    setContentFocused(true);
    contentRef.textContent = node()?.content ?? "";
    focusBulletContent(contentRef);
  }

  function handleDragEnd() {
    setTimeout(() => { didDrag = false; }, 0);
  }

  return (
    <Show when={node()}>
      <Show when={props.showCompleted() || !isCompleted()}>
      <div
        class={`bullet-item${(props.draggedId() === props.nodeId || (props.draggedId() && isSelected() && isNodeInSelection(props.draggedId()!))) ? " dragging" : ""}${isCompleted() ? " completed" : ""}`}
        data-depth={props.depth}
      >
        <div class={`bullet-row${isSpecial() ? " link-row" : ""}${isSelected() ? " selected" : ""}${isCompleted() ? " completed" : ""}`} data-bullet-id={props.nodeId} data-parent-id={props.parentId}>
          <div class="bullet-controls">
            <span
              class={`bullet-triangle ${hasChildren() ? "has-children" : ""} ${isCollapsed() ? "collapsed" : ""}`}
              onClick={handleToggleCollapse}
            >
              {hasChildren() ? (isCollapsed() ? "\u25B6" : "\u25BC") : ""}
            </span>
            <span
              class={`bullet-dot${hasChildren() && isCollapsed() ? " has-collapsed-children" : ""}${props.isNodeMirrored(props.nodeId) ? " mirrored" : ""}`}
              draggable={true}
              onClick={handleDotClick}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
              onContextMenu={(e) => {
                e.preventDefault();
                props.onContextMenu(e, props.nodeId, props.parentId, props.childIndex());
              }}
            />
          </div>
          <Show when={canEmbed() || isYtUrl() || isImageUrl()}>
            <span
              class={`embed-toggle ${embedExpanded() ? "expanded" : ""}`}
              onClick={() => props.toggleEmbedExpanded(props.nodeId)}
            >
              {embedExpanded() ? "\u25BC" : "\u25B6"}
            </span>
          </Show>
          <span
            ref={(el) => {
              contentRef = el;
              // Initialize content immediately so re-mounts (e.g. show-completed toggle)
              // display text even if the reactive content-sync effect doesn't re-fire.
              const text = node()?.content ?? "";
              if (isImageUrl()) {
                el.textContent = node()?.title || imageTypeLabel(text);
              } else if (hasRichContent(text)) {
                renderContentWithLinks(el, text);
              } else {
                el.textContent = text;
              }
              el.addEventListener("keydown", handleKeyDown);
              el.addEventListener("mousedown", handleContentMouseDown);
              el.addEventListener("focus", handleContentFocus);
              el.addEventListener("blur", handleContentBlur);
            }}
            class={`bullet-content${showTitle() ? " link-hidden" : ""}${isAmUrl() ? " automerge-url" : ""}${isImageUrl() && !node()?.title ? " image-label" : ""}`}
            contentEditable={!isCompleted()}
            onInput={handleInput}
            onContextMenu={(e) => {
              e.preventDefault();
              props.onContextMenu(e, props.nodeId, props.parentId, props.childIndex());
            }}
          />
          <Show when={showTitle() && isAmUrl()}>
            <span class="bullet-am-title" onClick={handleTitleClick}>
              {props.resolveDocTitle(node().content.trim())()}
            </span>
          </Show>
          <Show when={showTitle() && isYtUrl()}>
            <span class="bullet-am-title" onClick={handleTitleClick}>
              {props.resolveYouTubeTitle(node().content.trim())()}
            </span>
          </Show>
          <span
            class={`bullet-star${isStarred() ? " starred" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              props.onToggleStar(props.nodeId);
            }}
            title={isStarred() ? "Unstar" : "Star"}
          >
            <svg viewBox="0 0 24 24" width="14" height="14">
              <path
                d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                fill={isStarred() ? "currentColor" : "none"}
                stroke="currentColor"
                stroke-width="1.5"
              />
            </svg>
          </span>
        </div>
        <Show when={canEmbed() && embedExpanded()}>
          <div class="automerge-embed-wrapper">
            <AutomergeEmbed docUrl={node().content.trim()} />
          </div>
        </Show>
        <Show when={isYtUrl() && embedExpanded() && ytVideoId()}>
          <div class="automerge-embed-wrapper">
            <iframe
              class="youtube-embed"
              src={`https://www.youtube.com/embed/${ytVideoId()}`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowfullscreen
            />
          </div>
        </Show>
        <Show when={isImageUrl() && embedExpanded() && imageSrc()}>
          <div class="automerge-embed-wrapper">
            <img class="bullet-image-embed" src={imageSrc()!} />
          </div>
        </Show>
        <Show when={hasChildren() && !isCollapsed()}>
          <div class="bullet-children">
            <For each={node().children}>
              {(childId, index) => (
                <BulletItem
                  nodeId={childId}
                  parentId={props.nodeId}
                  childIndex={index}
                  doc={props.doc}
                  handle={props.handle}
                  depth={props.depth + 1}
                  contextRootId={props.contextRootId}
                  onNavigate={props.onNavigate}
                  focusedId={props.focusedId}
                  focusedParentHint={props.focusedParentHint}
                  focusCursorOffset={props.focusCursorOffset}
                  setFocusedId={props.setFocusedId}
                  onContextMenu={props.onContextMenu}
                  draggedId={props.draggedId}
                  setDraggedId={props.setDraggedId}
                  pushUndoOps={props.pushUndoOps}
                  markTextEdit={props.markTextEdit}
                  selectedIds={props.selectedIds}
                  extendSelection={props.extendSelection}
                  clearSelection={props.clearSelection}
                  indentSelection={props.indentSelection}
                  outdentSelection={props.outdentSelection}
                  deleteSelection={props.deleteSelection}
                  onToggleStar={props.onToggleStar}
                  resolveDocTitle={props.resolveDocTitle}
                  resolveYouTubeTitle={props.resolveYouTubeTitle}
                  resolveImageSrc={props.resolveImageSrc}
                  isNodeMirrored={props.isNodeMirrored}
                  onTagClick={props.onTagClick}
                  onComplete={props.onComplete}
                  showCompleted={props.showCompleted}
                  focusTitle={props.focusTitle}
                  isNodeCollapsed={props.isNodeCollapsed}
                  setNodeCollapsed={props.setNodeCollapsed}
                  toggleNodeCollapsed={props.toggleNodeCollapsed}
                  isEmbedExpanded={props.isEmbedExpanded}
                  setEmbedExpanded={props.setEmbedExpanded}
                  toggleEmbedExpanded={props.toggleEmbedExpanded}
                />
              )}
            </For>
          </div>
        </Show>
      </div>
      </Show>
    </Show>
  );
}
