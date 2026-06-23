import { updateText } from "@automerge/automerge";
import type { DocHandle } from "@automerge/automerge-repo";
import { createSignal, createEffect, createMemo, Show, type Accessor } from "solid-js";
import type { BulletsDoc } from "../datatype.ts";
import type { ToolContext } from "../tool-context.ts";
import {
  isAutomergeUrl,
  isYouTubeUrl,
  extractYouTubeVideoId,
  isImageDataUrl,
  isImageBullet,
  imageTypeLabel,
} from "../tree-utils.ts";
import { AutomergeEmbed } from "../components/AutomergeEmbed.tsx";

export function TitleEditor(props: {
  doc: BulletsDoc;
  handle: DocHandle<BulletsDoc>;
  contextId: Accessor<string | null>;
  contextRootId: Accessor<string>;
  ctx: ToolContext;
  markTextEdit: () => void;
  focusTitle: () => void;
  isEmbedExpanded: (id: string) => boolean;
  toggleEmbedExpanded: (id: string) => void;
  resolveDocTitle: (url: string) => Accessor<string>;
  resolveYouTubeTitle: (url: string) => Accessor<string>;
  resolveImageSrc: (url: string) => Accessor<string | null>;
  onTitleRef: (el: HTMLHeadingElement) => void;
  setFocusedBulletId: (id: string | null, parentHint?: string, cursorOffset?: number) => void;
  containerRef: HTMLDivElement;
}) {
  const { doc, handle } = props;

  let titleRef!: HTMLHeadingElement;

  const [contextTitleFocused, setContextTitleFocused] = createSignal(false);

  const contextTitle = () => {
    const id = props.contextId();
    if (!id) return doc.title || "Untitled Bullets";
    const node = doc.nodes[id];
    const content = node?.content ?? "";
    if (isImageBullet(content, node?.contentType)) return node?.title || imageTypeLabel(content);
    return content;
  };

  const contextIsAmUrl = () => {
    const id = props.contextId();
    if (!id) return false;
    const node = doc.nodes[id];
    return isAutomergeUrl(node?.content ?? "") && node?.contentType !== "image";
  };
  const contextIsYtUrl = () => {
    const id = props.contextId();
    if (!id) return false;
    return isYouTubeUrl(doc.nodes[id]?.content ?? "");
  };
  const contextYtVideoId = () => {
    const id = props.contextId();
    if (!id) return null;
    return extractYouTubeVideoId(doc.nodes[id]?.content ?? "");
  };
  const contextIsImageUrl = () => {
    const id = props.contextId();
    if (!id) return false;
    const node = doc.nodes[id];
    return isImageBullet(node?.content ?? "", node?.contentType);
  };
  const contextIsPatchworkMode = () => customElements.get("patchwork-view") !== undefined;
  const contextCanEmbed = () => contextIsAmUrl() && contextIsPatchworkMode();
  const contextEmbedExpanded = () => {
    const id = props.contextId();
    if (!id) return false;
    return props.isEmbedExpanded(id);
  };
  const contextIsSpecial = () => contextIsAmUrl() || contextIsYtUrl() || contextIsImageUrl();
  const contextShowTitle = () => (contextIsAmUrl() || contextIsYtUrl()) && !contextTitleFocused();

  function handleContextTitleClick() {
    setContextTitleFocused(true);
    const id = props.contextId();
    if (id) {
      titleRef.textContent = doc.nodes[id]?.content ?? "";
    }
    props.focusTitle();
  }

  function handleTitleInput(e: InputEvent) {
    props.markTextEdit();
    const text = (e.target as HTMLElement).textContent || "";
    const id = props.contextId();
    if (!id) {
      handle.change((d) => { updateText(d, ["title"], text); });
    } else if (contextIsImageUrl()) {
      handle.change((d) => {
        const n = d.nodes[id];
        if (n) {
          if (typeof n.title === "string") {
            updateText(d, ["nodes", id, "title"], text);
          } else {
            n.title = text;
          }
        }
      });
    } else {
      handle.change((d) => {
        const n = d.nodes[id];
        if (n) updateText(d, ["nodes", id, "content"], text);
      });
    }
  }

  function handleTitleKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const first = props.containerRef?.querySelector(".bullets-list .bullet-content") as HTMLElement | null;
      if (first) first.focus();
    }
    if (e.key === "ArrowRight" && !e.shiftKey) {
      const sel = window.getSelection();
      if (sel && sel.isCollapsed && sel.rangeCount > 0 && titleRef) {
        const range = sel.getRangeAt(0);
        const preRange = document.createRange();
        preRange.selectNodeContents(titleRef);
        preRange.setEnd(range.startContainer, range.startOffset);
        const textLen = (titleRef.textContent || "").length;
        if (preRange.toString().length === textLen) {
          e.preventDefault();
          const first = props.containerRef?.querySelector(".bullets-list .bullet-content") as HTMLElement | null;
          if (first) {
            first.focus();
            const r = document.createRange();
            r.setStart(first, 0);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
          }
        }
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const newId = crypto.randomUUID();
      const rootId = props.contextRootId();
      props.ctx.pushUndoOps([
        { type: "create-node", nodeId: newId },
        { type: "splice-in", parentId: rootId, childId: newId, index: 0 },
      ]);
      handle.change((d) => {
        d.nodes[newId] = { content: "", starred: false, children: [] };
        d.nodes[rootId].children.splice(0, 0, newId);
      });
      props.setFocusedBulletId(newId);
    }
  }

  createEffect(() => {
    const text = contextTitle();
    if (titleRef && titleRef.textContent !== text) {
      titleRef.textContent = text;
    }
  });

  return (
    <>
      <div class={`bullets-title-row${contextIsSpecial() ? " link-row" : ""}`}>
        <Show when={!props.contextId()}>
          <svg class="bullets-home-icon" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 2L2 9h3v7h4v-5h2v5h4V9h3L10 2z" />
          </svg>
        </Show>
        <Show when={contextCanEmbed() || contextIsYtUrl() || contextIsImageUrl()}>
          <span
            class={`embed-toggle ${contextEmbedExpanded() ? "expanded" : ""}`}
            onClick={() => {
              const id = props.contextId();
              if (id) props.toggleEmbedExpanded(id);
            }}
          >
            {contextEmbedExpanded() ? "\u25BC" : "\u25B6"}
          </span>
        </Show>
        <h1
          ref={(el) => {
            titleRef = el;
            props.onTitleRef(el);
            el.textContent = contextTitle();
            el.addEventListener("focus", () => setContextTitleFocused(true));
            el.addEventListener("blur", () => setContextTitleFocused(false));
          }}
          class={`bullets-context-title${contextShowTitle() ? " link-hidden" : ""}${contextIsImageUrl() && !doc.nodes[props.contextId()!]?.title ? " image-label" : ""}`}
          contentEditable={true}
          onInput={handleTitleInput}
          onKeyDown={handleTitleKeyDown}
        />
        <Show when={contextShowTitle() && contextIsAmUrl()}>
          <span class="bullets-context-am-title" onClick={handleContextTitleClick}>
            {props.resolveDocTitle(doc.nodes[props.contextId()!].content.trim())()}
          </span>
        </Show>
        <Show when={contextShowTitle() && contextIsYtUrl()}>
          <span class="bullets-context-am-title" onClick={handleContextTitleClick}>
            {props.resolveYouTubeTitle(doc.nodes[props.contextId()!].content.trim())()}
          </span>
        </Show>
      </div>
      <Show when={contextCanEmbed() && contextEmbedExpanded()}>
        <div class="automerge-embed-wrapper context-embed">
          <AutomergeEmbed docUrl={doc.nodes[props.contextId()!].content.trim()} />
        </div>
      </Show>
      <Show when={contextIsYtUrl() && contextEmbedExpanded() && contextYtVideoId()}>
        <div class="automerge-embed-wrapper context-embed">
          <iframe
            class="youtube-embed"
            src={`https://www.youtube.com/embed/${contextYtVideoId()}`}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
          />
        </div>
      </Show>
      <Show when={contextIsImageUrl() && contextEmbedExpanded()}>
        {(() => {
          const node = doc.nodes[props.contextId()!];
          const content = node?.content?.trim() ?? "";
          const src = () => {
            if (isImageDataUrl(content)) return content;
            if (node?.contentType === "image" && isAutomergeUrl(content)) {
              return props.resolveImageSrc(content)();
            }
            return null;
          };
          return (
            <Show when={src()}>
              <div class="automerge-embed-wrapper context-embed">
                <img class="bullet-image-embed" src={src()!} />
              </div>
            </Show>
          );
        })()}
      </Show>
    </>
  );
}
