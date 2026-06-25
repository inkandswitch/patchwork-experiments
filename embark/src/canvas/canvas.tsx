import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
} from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument, useRepo } from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import {
  getDocumentDragPayload,
  getDragSource,
  hasDocumentDrag,
  type DocumentDragItem,
} from "./dnd";
import { deepCloneDocument } from "./deep-clone";
import {
  registerContextElement,
  type PatchworkContextElement,
} from "../lib/context";
import { readContext, useContextHandle } from "../lib/context-solid";
import { runSchemaResolver } from "./schema-resolver";
import { Highlight, Selection } from "./channels";
import "./styles.css";

// One embedded document placed on the canvas. `x`/`y` are the top-left corner
// in canvas pixels, `z` is the stacking order, and `toolId` optionally pins
// which tool renders it (otherwise the embedded doc's default tool is used).
export type EmbarkEmbed = {
  id: string;
  docUrl: AutomergeUrl;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  toolId?: string;
  // Locked embeds are pinned in place: the canvas won't move or resize them.
  // (Used by the parts-bin drawer; there's no UI yet to lock arbitrary embeds.)
  locked?: boolean;
};

export type EmbarkCanvasDoc = {
  "@patchwork": { type: "embark-canvas" };
  title: string;
  embeds: { [id: string]: EmbarkEmbed };
};

// Framelessness is intrinsic to a tool rather than configured per embed: these
// tools bring their own chrome, so they render without the canvas drag border /
// clipping and are dragged by grabbing their surface. Keyed by tool id; an
// embed with no explicit `toolId` falls back to its document's datatype, which
// for these tools matches the tool id.
const FRAMELESS_TOOLS = new Set<string>(["llm-card", "parts-bin"]);

// Likewise, some tools own their size (e.g. a fixed-size card) and shouldn't
// expose the canvas resize handle. Resolved the same way as FRAMELESS_TOOLS.
const NOT_RESIZABLE_TOOLS = new Set<string>(["llm-card"]);

const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 280;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 100;
// Offset stacked drops so dragging several docs in at once doesn't hide them.
const DROP_CASCADE = 28;
// How far a Cmd+D duplicate is nudged down-and-right from its original.
const DUPLICATE_OFFSET = 24;
// An inspect embed opens just to the right of the card it inspects.
const INSPECT_GAP = 24;
const INSPECT_WIDTH = 360;
const INSPECT_MIN_HEIGHT = 280;

// Tool entry point: Solid renders into the host element and returns its own
// disposer. Absolutely-positioned embeds need a positioned ancestor, so the
// host element (often `position: static`) is promoted once up front.
export const EmbarkCanvasTool: ToolRender = (handle, element) => {
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }

  // A <patchwork-context> owns the shared store and answers discovery requests
  // from anywhere in its subtree. Rendering the canvas *into* it makes it an
  // ancestor of every embed, so search boxes, sticker sources, editors, the
  // map, and dynamically-loaded card code all resolve to the same store. It is
  // `display: contents`, so it doesn't disturb the embeds' positioning.
  registerContextElement();
  const contextEl = document.createElement(
    "patchwork-context",
  ) as PatchworkContextElement;
  element.appendChild(contextEl);

  // Schema resolution is plain canvas code, not a provider: it reads requested
  // schemas from the context and writes match urls back. Mount discovery still
  // rides the `patchwork:mounted` / `patchwork:unmounted` events on `element`.
  const disposeResolver = runSchemaResolver(
    contextEl.store,
    element,
    element.repo,
  );

  const disposeRender = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <EmbarkCanvas handle={handle as DocHandle<EmbarkCanvasDoc>} />
      </RepoContext.Provider>
    ),
    contextEl,
  );

  return () => {
    disposeRender();
    disposeResolver();
    contextEl.remove();
  };
};

function EmbarkCanvas(props: { handle: DocHandle<EmbarkCanvasDoc> }) {
  const repo = useRepo();
  const [doc] = useDocument<EmbarkCanvasDoc>(() => props.handle.url);
  const [canvasEl, setCanvasEl] = createSignal<HTMLDivElement>();
  const [isDraggingOver, setIsDraggingOver] = createSignal(false);
  // Selection is per-user view state, so it lives in a local signal rather
  // than in the shared document.
  const [selectedId, setSelectedId] = createSignal<string | null>(null);

  // Promote the selected embed's document into the shared `Selection` channel
  // so decorators (the editor's mention highlight, the map's pins) can read it
  // without prop-drilling. Single writer, so the slice is just the one url.
  const selectionHandle = useContextHandle(() => canvasEl(), Selection);
  createEffect(() => {
    const id = selectedId();
    const url = id ? doc()?.embeds[id]?.docUrl : undefined;
    selectionHandle.change((slice) => {
      const entries = slice as Record<string, true>;
      for (const key of Object.keys(entries)) delete entries[key];
      if (url) entries[url] = true;
    });
  });

  // Read the shared `Highlight` channel so an embed whose document is being
  // emphasized elsewhere (a hovered mention, a map pin, a context-viewer token)
  // glows. Highlight keys can be sub-document urls, so compare by document id.
  const highlight = readContext(() => canvasEl(), Highlight);
  const highlightedDocIds = createMemo(() => {
    const ids = new Set<string>();
    for (const url of Object.keys(highlight())) {
      if (isValidAutomergeUrl(url)) ids.add(parseAutomergeUrl(url).documentId);
    }
    return ids;
  });

  // Holding Shift temporarily exposes the resize handle on tools that are
  // normally fixed-size (e.g. the llm-card). Tracked at the window so it stays
  // in sync regardless of which element has focus.
  const [shiftHeld, setShiftHeld] = createSignal(false);
  const syncShift = (event: KeyboardEvent) => setShiftHeld(event.shiftKey);
  const clearShift = () => setShiftHeld(false);
  window.addEventListener("keydown", syncShift);
  window.addEventListener("keyup", syncShift);
  window.addEventListener("blur", clearShift);
  onCleanup(() => {
    window.removeEventListener("keydown", syncShift);
    window.removeEventListener("keyup", syncShift);
    window.removeEventListener("blur", clearShift);
  });

  // Selecting focuses the canvas root so it — not an embedded document —
  // receives key events. That's what lets Backspace/Delete remove the selected
  // embed without also firing while you type inside an embed. Selecting also
  // raises the embed to the top so it isn't left hidden behind its neighbors.
  const selectEmbed = (id: string) => {
    setSelectedId(id);
    canvasEl()?.focus();
    props.handle.change((canvas) => {
      const target = canvas.embeds[id];
      if (!target) return;
      const top = highestZ(canvas.embeds);
      if (target.z < top) target.z = top + 1;
    });
  };

  const deleteEmbed = (id: string) => {
    props.handle.change((canvas) => {
      delete canvas.embeds[id];
    });
    setSelectedId(null);
  };

  // Cmd/Ctrl+D: duplicate the selected embed. The document is deep-copied (so
  // the copy — and everything it links to — is fully independent of the
  // original) and dropped slightly down-and-right. Positions are re-read inside
  // the change since the deep copy awaits.
  const duplicateEmbed = async (id: string) => {
    const source = doc()?.embeds[id];
    if (!source) return;
    const clonedUrl = await deepCloneDocument(repo, source.docUrl);
    const newId = crypto.randomUUID();
    props.handle.change((canvas) => {
      const src = canvas.embeds[id];
      if (!src) return;
      // Automerge rejects an explicit `undefined`, so only carry over the
      // optional fields the source actually has.
      const copy: EmbarkEmbed = {
        id: newId,
        docUrl: clonedUrl,
        x: src.x + DUPLICATE_OFFSET,
        y: src.y + DUPLICATE_OFFSET,
        width: src.width,
        height: src.height,
        z: highestZ(canvas.embeds) + 1,
      };
      if (src.toolId !== undefined) copy.toolId = src.toolId;
      if (src.locked !== undefined) copy.locked = src.locked;
      canvas.embeds[newId] = copy;
    });
    selectEmbed(newId);
  };

  // Right-click menu state: which embed was clicked, its resolved tool id (so
  // items can enable per datatype), and the click point in canvas-local space.
  const [menu, setMenu] = createSignal<ContextMenu | null>(null);

  const openMenu = (
    embedId: string,
    clientX: number,
    clientY: number,
    toolId: string | undefined,
  ) => {
    const rect = canvasEl()?.getBoundingClientRect();
    setMenu({
      embedId,
      toolId,
      x: rect ? clientX - rect.left : clientX,
      y: rect ? clientY - rect.top : clientY,
    });
  };

  // Inspect: drop a fresh embed beside the clicked card that renders the same
  // document with the inspect tool (showing its spec + code).
  const inspectEmbed = (id: string) => {
    setMenu(null);
    props.handle.change((canvas) => {
      const source = canvas.embeds[id];
      if (!source) return;
      const newId = crypto.randomUUID();
      canvas.embeds[newId] = {
        id: newId,
        docUrl: source.docUrl,
        x: source.x + source.width + INSPECT_GAP,
        y: source.y,
        width: INSPECT_WIDTH,
        height: Math.max(source.height, INSPECT_MIN_HEIGHT),
        z: highestZ(canvas.embeds) + 1,
        toolId: "inspect",
      };
    });
  };

  // Escape closes the context menu wherever focus happens to be.
  const onWindowKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") setMenu(null);
  };
  window.addEventListener("keydown", onWindowKeyDown);
  onCleanup(() => window.removeEventListener("keydown", onWindowKeyDown));

  // Stable render order (by id) so <For> never reorders the DOM nodes — that
  // would tear down and remount the embedded <patchwork-view>. Stacking is
  // handled purely with z-index instead.
  const embeds = () =>
    Object.values(doc()?.embeds ?? {}).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );

  const dropDocuments = async (event: DragEvent) => {
    setIsDraggingOver(false);
    const payload = getDocumentDragPayload(event.dataTransfer);
    if (!payload) return;
    event.preventDefault();

    // Read everything off the drag synchronously — the dataTransfer is cleared
    // once we await the deep copy below.
    const fromPartsBin = getDragSource(event.dataTransfer) === "parts-bin";
    const rect = canvasEl()?.getBoundingClientRect();
    const dropX = rect ? event.clientX - rect.left : event.clientX;
    const dropY = rect ? event.clientY - rect.top : event.clientY;

    // Items dragged out of the parts bin are deep-copied so the new embed (and
    // every doc it links to) is fully independent of the bin's template. Plain
    // document drags stay as references to the existing document.
    const items = fromPartsBin
      ? await Promise.all(
          payload.map(async (item) => ({
            ...item,
            url: await deepCloneDocument(repo, item.url),
          })),
        )
      : payload;

    props.handle.change((canvas) => {
      let z = highestZ(canvas.embeds);
      items.forEach((item, index) => {
        const id = crypto.randomUUID();
        const cascade = index * DROP_CASCADE;
        canvas.embeds[id] = {
          id,
          docUrl: item.url,
          // Top-left corner sits at the drop point (not centered on it).
          x: dropX + cascade,
          y: dropY + cascade,
          // A parts-bin example may carry the size it was captured at.
          width: item.width ?? DEFAULT_WIDTH,
          height: item.height ?? DEFAULT_HEIGHT,
          z: ++z,
        };
      });
    });
  };

  return (
    <div
      ref={setCanvasEl}
      class="embark-canvas"
      classList={{ "embark-canvas--drag-over": isDraggingOver() }}
      tabindex={0}
      on:keydown={(event) => {
        // Ignore keys bubbling out of an embedded document; only act when the
        // canvas root itself holds focus (target === currentTarget). Selecting
        // an embed focuses the root, so the shortcuts work right after a click.
        if (event.target !== event.currentTarget) return;
        const id = selectedId();
        if (!id) return;

        // Cmd/Ctrl+D duplicates the selected embed (deep copy).
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "d"
        ) {
          event.preventDefault();
          void duplicateEmbed(id);
          return;
        }

        if (event.key !== "Backspace" && event.key !== "Delete") return;
        event.preventDefault();
        deleteEmbed(id);
      }}
      on:pointerdown={(event) => {
        // Any press outside the menu dismisses it (the menu stops propagation
        // on its own pointerdown, so it survives clicks on itself).
        setMenu(null);
        // Embeds stop propagation in their own handlers, so a press that
        // reaches the canvas root is on empty space — clear the selection.
        if (event.target === event.currentTarget) setSelectedId(null);
      }}
      on:dragover={(event) => {
        if (!hasDocumentDrag(event.dataTransfer)) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
        setIsDraggingOver(true);
      }}
      on:dragleave={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !(event.currentTarget as HTMLElement).contains(next)) {
          setIsDraggingOver(false);
        }
      }}
      on:drop={dropDocuments}
    >
      <For each={embeds()}>
        {(embed) => (
          <EmbedView
            embed={embed}
            handle={props.handle}
            selected={selectedId() === embed.id}
            highlighted={highlightedDocIds().has(docIdOf(embed.docUrl))}
            shiftHeld={shiftHeld()}
            onSelect={() => selectEmbed(embed.id)}
            onDelete={() => deleteEmbed(embed.id)}
            onContextMenu={(clientX, clientY, toolId) =>
              openMenu(embed.id, clientX, clientY, toolId)
            }
          />
        )}
      </For>
      <Show when={embeds().length === 0}>
        <div class="embark-canvas__empty">
          Drag documents here to embed them
        </div>
      </Show>

      {/* Right-click menu. Its only action is Inspect, which works for any
          document (raw tab, plus spec/code for LLM cards). It's disabled on
          inspect embeds themselves to avoid inspecting an inspector. */}
      <Show when={menu()}>
        {(activeMenu) => (
          <div
            class="embark-canvas__menu"
            style={{ left: `${activeMenu().x}px`, top: `${activeMenu().y}px` }}
            on:pointerdown={(event) => event.stopPropagation()}
            on:contextmenu={(event) => event.preventDefault()}
          >
            <button
              type="button"
              class="embark-canvas__menu-item"
              disabled={activeMenu().toolId === "inspect"}
              on:click={() => inspectEmbed(activeMenu().embedId)}
            >
              Inspect
            </button>
          </div>
        )}
      </Show>
      <div style={{ position: "absolute", bottom: 0, right: 0 }}>v0.0.11</div>
    </div>
  );
}

// A single embed: a grab strip on top to move it, the embedded document
// filling the body, and an invisible corner that resizes it. Move and resize
// share one pointer-capture interaction distinguished by `mode`.
function EmbedView(props: {
  embed: EmbarkEmbed;
  handle: DocHandle<EmbarkCanvasDoc>;
  selected: boolean;
  highlighted: boolean;
  shiftHeld: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onContextMenu: (
    clientX: number,
    clientY: number,
    toolId: string | undefined,
  ) => void;
}) {
  let rootEl: HTMLDivElement | undefined;
  let interaction: Interaction | null = null;
  // Native-DnD bridge for a move: the DataTransfer describing this embed's
  // document, plus the drop target currently under the cursor. Null for resizes
  // and moves that haven't started.
  let drag: DragBridge | null = null;

  const beginInteraction = (mode: InteractionMode) => (event: PointerEvent) => {
    // Locked embeds can't be moved or resized — leave the event alone so the
    // tool inside keeps full control of its own interactions.
    if (props.embed.locked) return;
    event.preventDefault();
    event.stopPropagation();
    props.onSelect();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture(event.pointerId);
    interaction = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: props.embed.x,
      originY: props.embed.y,
      originWidth: props.embed.width,
      originHeight: props.embed.height,
    };
    // Only a move can be dropped onto another embed; prime the DnD bridge so
    // pointermove can advertise this embed to drop targets under the cursor.
    drag =
      mode === "move"
        ? {
            data: buildDragData(),
            overEl: null,
            overEmbed: null,
            accepted: false,
          }
        : null;
  };

  const onPointerMove = (event: PointerEvent) => {
    const state = interaction;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startClientX;
    const dy = event.clientY - state.startClientY;
    props.handle.change((canvas) => {
      const target = canvas.embeds[props.embed.id];
      if (!target) return;
      if (state.mode === "move") {
        target.x = state.originX + dx;
        target.y = state.originY + dy;
      } else {
        target.width = Math.max(MIN_WIDTH, state.originWidth + dx);
        target.height = Math.max(MIN_HEIGHT, state.originHeight + dy);
      }
    });
    if (state.mode === "move" && drag) {
      updateDragOver(event.clientX, event.clientY);
    }
  };

  const endInteraction = (event: PointerEvent) => {
    const state = interaction;
    if (!state || state.pointerId !== event.pointerId) return;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    interaction = null;

    // Resizes, and moves that never hovered a drop target, just leave the embed
    // where it landed (the live position updates already happened).
    const bridge = drag;
    drag = null;
    if (state.mode !== "move" || !bridge) return;

    // Released over the bare canvas, or over an embed that didn't accept the
    // drop: clear any lingering hover state and keep the embed where it landed.
    if (!bridge.overEl || !bridge.accepted) {
      if (bridge.overEl) {
        dispatchDragEvent(
          "dragleave",
          bridge.overEl,
          event.clientX,
          event.clientY,
          bridge.data,
        );
      }
      return;
    }

    // Hand the document to the drop target and let it choose the effect through
    // the native DnD API: "move" means it claimed the embed (delete it here),
    // anything else (e.g. "copy") means it took a copy, so the original springs
    // back to where the drag began.
    dispatchDragEvent(
      "drop",
      bridge.overEl,
      event.clientX,
      event.clientY,
      bridge.data,
    );
    if (bridge.data.dropEffect === "move") {
      props.onDelete();
      return;
    }

    const dx = event.clientX - state.startClientX;
    const dy = event.clientY - state.startClientY;
    props.handle.change((canvas) => {
      const target = canvas.embeds[props.embed.id];
      if (!target) return;
      target.x = state.originX;
      target.y = state.originY;
    });
    // The reset above moves the element to its origin synchronously, so animate
    // the transform from the drop point back to zero for the spring-back.
    rootEl?.animate(
      [
        { transform: `translate(${dx}px, ${dy}px)` },
        { transform: "translate(0px, 0px)" },
      ],
      { duration: 240, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
  };

  // Build the drag payload describing this embed's document, in the same shape a
  // real document drag carries — so a drop target (e.g. a parts bin) handles
  // canvas embeds with no special-casing.
  const buildDragData = (): DataTransfer => {
    const data = new DataTransfer();
    const item: DocumentDragItem = {
      url: props.embed.docUrl,
      width: props.embed.width,
      height: props.embed.height,
      ...(props.embed.toolId !== undefined && { toolId: props.embed.toolId }),
    };
    data.setData(
      "text/x-patchwork-dnd",
      JSON.stringify({ source: "canvas", items: [item] }),
    );
    data.setData("text/x-patchwork-urls", JSON.stringify([props.embed.docUrl]));
    data.effectAllowed = "copyMove";
    return data;
  };

  // Keep the hovered drop target informed with dragleave/dragover (so it can
  // highlight and advertise its drop effect), tracking whether it accepts.
  const updateDragOver = (clientX: number, clientY: number) => {
    if (!drag) return;
    const overEl = dropElementUnder(clientX, clientY);
    const overEmbed = overEl?.closest(".embark-embed") ?? null;
    if (overEmbed !== drag.overEmbed) {
      if (drag.overEl) {
        dispatchDragEvent(
          "dragleave",
          drag.overEl,
          clientX,
          clientY,
          drag.data,
        );
      }
      drag.overEmbed = overEmbed;
      drag.accepted = false;
    }
    drag.overEl = overEl;
    if (overEl) {
      drag.accepted = dispatchDragEvent(
        "dragover",
        overEl,
        clientX,
        clientY,
        drag.data,
      );
    }
  };

  // The topmost element under the cursor that belongs to a *different* embed, or
  // null when that's the bare canvas (dragging over empty space is a no-op).
  // elementsFromPoint is needed because the dragged embed sits on top; it also
  // skips pointer-events:none chrome, so it lands on a bin's panel directly.
  const dropElementUnder = (
    clientX: number,
    clientY: number,
  ): Element | null => {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      if (rootEl && rootEl.contains(el)) continue; // skip the dragged embed
      const embed = el.closest(".embark-embed");
      return embed && embed !== rootEl ? el : null;
    }
    return null;
  };

  // Dispatch a synthetic DnD event at a target and report whether it accepted
  // the drop (preventDefault). The same DataTransfer rides every phase, so the
  // target's dropEffect set on "drop" is readable back afterwards.
  const dispatchDragEvent = (
    type: "dragover" | "dragleave" | "drop",
    target: Element,
    clientX: number,
    clientY: number,
    data: DataTransfer,
  ): boolean => {
    const event = new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      dataTransfer: data,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };

  // Framelessness / resizability are properties of the rendering tool: use the
  // pinned `toolId` when set, otherwise fall back to the document's datatype
  // (which equals the default tool id for these tools). The doc loads async, so
  // these may settle a frame after mount.
  const [embedDoc] = useDocument<{ "@patchwork"?: { type?: string } }>(
    () => props.embed.docUrl,
  );
  const toolId = () => props.embed.toolId ?? embedDoc()?.["@patchwork"]?.type;
  const frameless = () => {
    const id = toolId();
    return id !== undefined && FRAMELESS_TOOLS.has(id);
  };
  const locked = () => props.embed.locked === true;
  // Tools in NOT_RESIZABLE_TOOLS own their size, so the handle is normally
  // hidden — but holding Shift exposes it anyway (locked embeds stay pinned).
  const baseResizable = () => {
    const id = toolId();
    return id === undefined || !NOT_RESIZABLE_TOOLS.has(id);
  };
  const resizable = () => {
    if (locked()) return false;
    return baseResizable() || props.shiftHeld;
  };

  // Frameless embeds have no handle bar, so the whole surface moves them. The
  // embedded tool opts a region out of dragging by calling stopPropagation on
  // its pointerdown (then this never fires). Framed embeds move from the bar
  // only, so the surface press is ignored there.
  const beginMove = beginInteraction("move");
  const onSurfacePointerDown = (event: PointerEvent) => {
    if (!frameless()) return;
    beginMove(event);
  };

  return (
    <div
      ref={rootEl}
      class="embark-embed"
      classList={{
        "embark-embed--selected": props.selected,
        "embark-embed--highlighted": props.highlighted,
        "embark-embed--frameless": frameless(),
        "embark-embed--locked": locked(),
      }}
      style={{
        left: `${props.embed.x}px`,
        top: `${props.embed.y}px`,
        width: `${props.embed.width}px`,
        height: `${props.embed.height}px`,
        "z-index": props.embed.z,
      }}
      on:contextmenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onSelect();
        props.onContextMenu(event.clientX, event.clientY, toolId());
      }}
      on:dragover={(event) => event.stopPropagation()}
      on:dragleave={(event) => event.stopPropagation()}
      on:drop={(event) => event.stopPropagation()}
    >
      <Show when={!frameless()}>
        <div
          class="embark-embed__handle"
          title="Drag to move"
          on:pointerdown={beginMove}
          on:pointermove={onPointerMove}
          on:pointerup={endInteraction}
          on:pointercancel={endInteraction}
        >
          <GripIcon />
          <button
            type="button"
            class="embark-embed__delete"
            title="Remove from canvas"
            aria-label="Remove from canvas"
            on:pointerdown={(event) => event.stopPropagation()}
            on:click={(event) => {
              event.stopPropagation();
              props.onDelete();
            }}
          >
            <CloseIcon />
          </button>
        </div>
      </Show>
      <div
        class="embark-embed__view"
        on:pointerdown={onSurfacePointerDown}
        on:pointermove={onPointerMove}
        on:pointerup={endInteraction}
        on:pointercancel={endInteraction}
      >
        <patchwork-view
          doc-url={props.embed.docUrl}
          tool-id={props.embed.toolId}
        />
      </div>
      <Show when={resizable()}>
        <div
          class="embark-embed__resize"
          classList={{ "embark-embed__resize--forced": !baseResizable() }}
          title="Drag to resize"
          on:pointerdown={beginInteraction("resize")}
          on:pointermove={onPointerMove}
          on:pointerup={endInteraction}
          on:pointercancel={endInteraction}
        />
      </Show>
    </div>
  );
}

// Six-dot grip glyph for the move handle; inherits the handle's text color.
function GripIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <circle cx="5" cy="9" r="1.2" />
      <circle cx="12" cy="9" r="1.2" />
      <circle cx="19" cy="9" r="1.2" />
      <circle cx="5" cy="15" r="1.2" />
      <circle cx="12" cy="15" r="1.2" />
      <circle cx="19" cy="15" r="1.2" />
    </svg>
  );
}

// Thin "x" glyph for the delete button; inherits the button's text color.
function CloseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

// An open right-click menu: the embed it targets, that embed's resolved tool
// id, and the anchor point in canvas-local pixels.
type ContextMenu = {
  embedId: string;
  toolId: string | undefined;
  x: number;
  y: number;
};

type InteractionMode = "move" | "resize";

type Interaction = {
  mode: InteractionMode;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  originWidth: number;
  originHeight: number;
};

// Live state for a move's native-DnD bridge: the DataTransfer offered to drop
// targets, the element/embed currently under the cursor, and whether that target
// accepted the latest dragover.
type DragBridge = {
  data: DataTransfer;
  overEl: Element | null;
  overEmbed: Element | null;
  accepted: boolean;
};

// The document id of an embed's url, used to match against the (possibly
// sub-document) urls in the Highlight channel. Falls back to the raw url when it
// can't be parsed so a malformed url simply never matches.
function docIdOf(url: AutomergeUrl): string {
  return isValidAutomergeUrl(url) ? parseAutomergeUrl(url).documentId : url;
}

// Largest z across all embeds (0 when empty), used to place fresh/raised
// embeds on top.
function highestZ(embeds: { [id: string]: EmbarkEmbed }): number {
  let max = 0;
  for (const embed of Object.values(embeds)) {
    if (embed.z > max) max = embed.z;
  }
  return max;
}
