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
  onMount,
} from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument, useRepo } from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import { OpenDocumentEvent } from "@inkandswitch/patchwork-elements";
import {
  getDocumentDragPayload,
  hasDocumentDrag,
  type DocumentDragItem,
} from "./dnd";
import {
  registerContextElement,
  readContext,
  useContextHandle,
  type PatchworkContextElement,
} from "@embark/context";
import { Highlight, Selection } from "@embark/selection";
import { renderComponentEmbed } from "./component-embed";
import {
  resolveInspectTarget,
  isFolderDoc,
  type InspectDoc,
  type InspectTarget,
} from "@embark/inspect";
import { runSchemaResolver } from "@embark/schema";
import { wasEmbedClaimed } from "./drop-claim";
import "./styles.css";

// One embedded item placed on the canvas. `x`/`y` are the top-left corner in
// canvas pixels, `z` is the stacking order, and `toolId` optionally pins which
// tool renders it (otherwise the embedded doc's default tool is used).
//
// An embed renders either a document (`docUrl`) or a standalone
// `patchwork:component` (`componentUrl` — a stable, head-less module url that is
// imported and run directly, with no backing document). Exactly one is set.
export type EmbarkEmbed = {
  id: string;
  docUrl?: AutomergeUrl;
  componentUrl?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  toolId?: string;
  // Locked embeds are pinned in place: the canvas won't move or resize them.
  // (Used by the parts-bin drawer; there's no UI yet to lock arbitrary embeds.)
  locked?: boolean;
  // Per-embed frame override, toggled from the right-click "Show frame" menu:
  // `true` forces the canvas frame (drag bar + border), `false` makes the embed
  // frameless (dragged by its surface). Unset falls back to the tool's default
  // (see FRAMELESS_TOOLS).
  showFrame?: boolean;
};

export type EmbarkCanvasDoc = {
  "@patchwork": { type: "embark-canvas" };
  title: string;
  embeds: { [id: string]: EmbarkEmbed };
};

// Per-tool default framelessness: these tools bring their own chrome, so they
// render without the canvas drag border / clipping and are dragged by grabbing
// their surface. This is only the default — a per-embed `showFrame` overrides
// it (see the right-click "Show frame" toggle). Keyed by tool id; an embed with
// no explicit `toolId` falls back to its document's datatype, which for these
// tools matches the tool id.
const FRAMELESS_TOOLS = new Set<string>(["parts-bin"]);

// Auto-size tools report their own intrinsic size and change it as their state
// changes (e.g. the deck, which grows when fanned and shrinks when folded).
// Their embed omits the stored width/height and shrink-wraps the content
// instead (see `.embark-embed--autosize`), so the card resizes dynamically.
const AUTOSIZE_TOOLS = new Set<string>(["deck"]);

const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 280;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 100;
// How far a frameless surface press must travel before it becomes a move.
// Below this it stays a plain click and reaches the tool (e.g. the deck's
// cover toggling its fan).
const SURFACE_DRAG_THRESHOLD = 4;
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
  const [doc] = useDocument<EmbarkCanvasDoc>(() => props.handle.url);
  const repo = useRepo();
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

  // Cmd/Ctrl+D: duplicate the selected embed. The copy references the same
  // document (or shared, head-less component url) as the original — there is no
  // deep copy — and is dropped slightly down-and-right.
  const duplicateEmbed = (id: string) => {
    const newId = crypto.randomUUID();
    props.handle.change((canvas) => {
      const src = canvas.embeds[id];
      if (!src) return;
      // Automerge rejects an explicit `undefined`, so only carry over the
      // optional fields the source actually has.
      const copy: EmbarkEmbed = {
        id: newId,
        x: src.x + DUPLICATE_OFFSET,
        y: src.y + DUPLICATE_OFFSET,
        width: src.width,
        height: src.height,
        z: highestZ(canvas.embeds) + 1,
      };
      if (src.docUrl !== undefined) copy.docUrl = src.docUrl;
      if (src.componentUrl !== undefined) copy.componentUrl = src.componentUrl;
      if (src.toolId !== undefined) copy.toolId = src.toolId;
      if (src.locked !== undefined) copy.locked = src.locked;
      if (src.showFrame !== undefined) copy.showFrame = src.showFrame;
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
    inspectable: boolean,
  ) => {
    const rect = canvasEl()?.getBoundingClientRect();
    setMenu({
      embedId,
      toolId,
      inspectable,
      x: rect ? clientX - rect.left : clientX,
      y: rect ? clientY - rect.top : clientY,
    });
  };

  // The live framed state of a menu's target: an explicit `showFrame` wins,
  // otherwise the tool's default (frameless tools default to no frame). Reads
  // doc() so the checkmark reflects the current value when the menu opens.
  const menuShowsFrame = (target: ContextMenu): boolean => {
    const embed = doc()?.embeds[target.embedId];
    if (embed?.showFrame !== undefined) return embed.showFrame;
    return !(target.toolId !== undefined && FRAMELESS_TOOLS.has(target.toolId));
  };

  // Flip the target embed's frame on/off, then dismiss the menu.
  const toggleFrame = (target: ContextMenu) => {
    const next = !menuShowsFrame(target);
    props.handle.change((canvas) => {
      const embed = canvas.embeds[target.embedId];
      if (embed) embed.showFrame = next;
    });
    setMenu(null);
  };

  // Inspect: resolve what paints the clicked embed (its package, and — for a
  // tool — the document it shows) from the rendered DOM, mint a small inspect
  // doc carrying those urls, and drop a fresh embed beside it that renders that
  // inspect doc. Works for both document embeds and standalone components.
  const inspectEmbed = async (id: string) => {
    setMenu(null);
    const source = doc()?.embeds[id];
    const root = canvasEl()?.querySelector<HTMLElement>(
      `[data-embed-id="${id}"]`,
    );
    if (!source || !root) return;

    const target = await resolveInspectTarget(root, repo);
    if (!target) return;

    spawnInspector(source, target);
  };

  // Mint an inspect doc for `target` and drop a fresh inspect embed just to the
  // right of `source`. Shared by the right-click Inspect action and by opening a
  // folder link from inside an existing inspector.
  const spawnInspector = (source: Rect, target: InspectTarget) => {
    const inspectDoc = repo.create<InspectDoc>({
      "@patchwork": { type: "inspect" },
      packageUrl: target.packageUrl,
      ...(target.documentUrl ? { documentUrl: target.documentUrl } : {}),
    });

    props.handle.change((canvas) => {
      const newId = crypto.randomUUID();
      canvas.embeds[newId] = {
        id: newId,
        docUrl: inspectDoc.url,
        x: source.x + source.width + INSPECT_GAP,
        y: source.y,
        width: INSPECT_WIDTH,
        height: Math.max(source.height, INSPECT_MIN_HEIGHT),
        z: highestZ(canvas.embeds) + 1,
        toolId: "inspect",
      };
    });
  };

  // Open-document events bubble out of an inspector's spec/source views (links
  // and embeds dispatch `patchwork:open-document`). Catch them at the canvas:
  // when the link points at a package folder, open it as a new inspector beside
  // the one it came from; otherwise refire so the host frame opens it normally.
  const onOpenDocument = async (event: Event) => {
    const detail = (event as OpenDocumentEvent).detail;
    const embedEl = (event.target as HTMLElement | null)?.closest?.(
      "[data-embed-id]",
    ) as HTMLElement | null;
    const originId = embedEl?.dataset.embedId;
    const origin = originId ? doc()?.embeds[originId] : undefined;

    // Only hijack links that come from inside an inspector embed.
    if (!origin || origin.toolId !== "inspect") return;

    event.stopPropagation();
    const url = detail.url;
    if (!isValidAutomergeUrl(url)) return;

    const handle = await repo.find(url);
    if (isFolderDoc(handle.doc())) {
      spawnInspector(origin, { packageUrl: url });
    } else {
      // Not a folder: let normal open behavior happen. Refiring from canvasEl
      // (which is not inside an embed) means this handler ignores it and it
      // bubbles on to the host frame.
      canvasEl()?.dispatchEvent(new OpenDocumentEvent(detail));
    }
  };

  createEffect(() => {
    const el = canvasEl();
    if (!el) return;
    el.addEventListener("patchwork:open-document", onOpenDocument);
    onCleanup(() =>
      el.removeEventListener("patchwork:open-document", onOpenDocument),
    );
  });

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

  const dropDocuments = (event: DragEvent) => {
    setIsDraggingOver(false);
    const payload = getDocumentDragPayload(event.dataTransfer);
    if (!payload) return;
    event.preventDefault();

    const rect = canvasEl()?.getBoundingClientRect();
    const dropX = rect ? event.clientX - rect.left : event.clientX;
    const dropY = rect ? event.clientY - rect.top : event.clientY;

    // Dropped items become embeds that reference the dragged document (or
    // shared, head-less component url) directly — there is no deep copy.
    props.handle.change((canvas) => {
      let z = highestZ(canvas.embeds);
      payload.forEach((item, index) => {
        const id = crypto.randomUUID();
        const cascade = index * DROP_CASCADE;
        const embed: EmbarkEmbed = {
          id,
          // Top-left corner sits at the drop point (not centered on it).
          x: dropX + cascade,
          y: dropY + cascade,
          // A parts-bin example may carry the size it was captured at.
          width: item.width ?? DEFAULT_WIDTH,
          height: item.height ?? DEFAULT_HEIGHT,
          z: ++z,
        };
        // Automerge rejects an explicit `undefined`, so only set the fields the
        // dropped item actually carries.
        if (item.componentUrl) embed.componentUrl = item.componentUrl;
        else if (item.url) embed.docUrl = item.url;
        if (item.toolId !== undefined) embed.toolId = item.toolId;
        canvas.embeds[id] = embed;
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
          duplicateEmbed(id);
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
            highlighted={
              embed.docUrl
                ? highlightedDocIds().has(docIdOf(embed.docUrl))
                : false
            }
            onSelect={() => selectEmbed(embed.id)}
            onDelete={() => deleteEmbed(embed.id)}
            onContextMenu={(clientX, clientY, toolId) =>
              openMenu(
                embed.id,
                clientX,
                clientY,
                toolId,
                Boolean(embed.docUrl || embed.componentUrl),
              )
            }
          />
        )}
      </For>
      <Show when={embeds().length === 0}>
        <div class="embark-canvas__empty">
          Drag documents here to embed them
        </div>
      </Show>

      {/* Right-click menu. Inspect opens the embed's package (and the document
          it renders, if any); it's disabled on inspect embeds themselves to
          avoid inspecting an inspector. Show frame toggles the canvas chrome for
          this embed and is hidden for locked embeds (which can't be dragged). */}
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
              disabled={
                !activeMenu().inspectable || activeMenu().toolId === "inspect"
              }
              on:click={() => void inspectEmbed(activeMenu().embedId)}
            >
              <span class="embark-canvas__menu-check" />
              Inspect
            </button>
            <Show when={!doc()?.embeds[activeMenu().embedId]?.locked}>
              <button
                type="button"
                class="embark-canvas__menu-item"
                on:click={() => toggleFrame(activeMenu())}
              >
                <span class="embark-canvas__menu-check">
                  <Show when={menuShowsFrame(activeMenu())}>
                    <CheckIcon />
                  </Show>
                </span>
                Show frame
              </button>
            </Show>
          </div>
        )}
      </Show>
      <div style={{ position: "absolute", bottom: 0, right: 0 }}>v0.0.18</div>
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
  // A frameless surface press that hasn't traveled past the drag threshold yet.
  // The move (with its capture and preventDefault) is deferred so a plain click
  // still reaches the tool under the press — e.g. the deck's cover fans on
  // click but drags the deck when pulled.
  let pendingMove: PendingMove | null = null;
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

    // Hand the document to the drop target. If it claimed the embed (e.g. the
    // deck moving the card in), delete it here; otherwise it took a copy (e.g.
    // the parts bin) and the original springs back to where the drag began. We
    // can't read this off `dropEffect` — the bridge's DataTransfer ignores the
    // effect setters — so targets mark the drop event itself (see drop-claim).
    const dropEvent = dispatchDragEvent(
      "drop",
      bridge.overEl,
      event.clientX,
      event.clientY,
      bridge.data,
    );
    if (wasEmbedClaimed(dropEvent)) {
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

  // Build the drag payload describing this embed (document or component), in the
  // same shape a real document drag carries — so a drop target (e.g. a parts
  // bin) handles canvas embeds with no special-casing.
  const buildDragData = (): DataTransfer => {
    const data = new DataTransfer();
    const item: DocumentDragItem = {
      width: props.embed.width,
      height: props.embed.height,
      ...(props.embed.toolId !== undefined && { toolId: props.embed.toolId }),
    };
    if (props.embed.componentUrl) item.componentUrl = props.embed.componentUrl;
    else if (props.embed.docUrl) item.url = props.embed.docUrl;
    data.setData(
      "text/x-patchwork-dnd",
      JSON.stringify({ source: "canvas", items: [item] }),
    );
    // Only document embeds advertise a bare url list; a component embed has no
    // document, so it travels in the rich payload alone.
    if (props.embed.docUrl) {
      data.setData(
        "text/x-patchwork-urls",
        JSON.stringify([props.embed.docUrl]),
      );
    }
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
      ).defaultPrevented;
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

  // Dispatch a synthetic DnD event at a target and return the event, so callers
  // can read `defaultPrevented` (did it accept?) and whether the target claimed
  // the embed (see drop-claim). The same DataTransfer rides every phase.
  const dispatchDragEvent = (
    type: "dragover" | "dragleave" | "drop",
    target: Element,
    clientX: number,
    clientY: number,
    data: DataTransfer,
  ): DragEvent => {
    const event = new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      dataTransfer: data,
    });
    target.dispatchEvent(event);
    return event;
  };

  // Framelessness / auto-sizing derive from the rendering tool: use the pinned
  // `toolId` when set, otherwise fall back to the document's datatype (which
  // equals the default tool id for these tools). The doc loads async, so these
  // may settle a frame after mount.
  const [embedDoc] = useDocument<{ "@patchwork"?: { type?: string } }>(
    () => props.embed.docUrl,
  );
  const toolId = () => props.embed.toolId ?? embedDoc()?.["@patchwork"]?.type;
  // An explicit `showFrame` wins; otherwise the tool's default decides. Framed
  // is the default for anything dropped in from outside — only tools in
  // FRAMELESS_TOOLS default to frameless.
  const frameless = () => {
    if (props.embed.showFrame !== undefined) return !props.embed.showFrame;
    const id = toolId();
    return id !== undefined && FRAMELESS_TOOLS.has(id);
  };
  const locked = () => props.embed.locked === true;
  // Auto-size embeds derive their bounds from the tool's content, so the stored
  // width/height aren't applied — and a manual resize would have no effect.
  const autosize = () => {
    const id = toolId();
    return id !== undefined && AUTOSIZE_TOOLS.has(id);
  };
  // Locked embeds are pinned, and auto-size embeds derive their bounds from the
  // tool's content, so neither exposes the resize handle.
  const resizable = () => !locked() && !autosize();

  // Frameless embeds have no handle bar, so the whole surface moves them —
  // except where the press lands on something interactive or on actual text, so
  // you can still focus inputs, click buttons/links, and select text. (Tools can
  // also opt a region out entirely by calling stopPropagation on its
  // pointerdown.) Framed embeds move from the bar only, so this is ignored.
  //
  // The move itself is deferred behind a small travel threshold: preventDefault
  // fires immediately (suppressing focus/selection), but per the pointer-events
  // spec a canceled pointerdown still produces a click — so a stationary press
  // stays a click for the tool under it (e.g. the deck's cover fanning), and
  // only a pull becomes a drag.
  const beginMove = beginInteraction("move");
  const onSurfacePointerDown = (event: PointerEvent) => {
    if (!frameless() || props.embed.locked) return;
    if (event.button !== 0) return;
    if (pressLandsOnInteractiveOrText(event)) return;
    event.preventDefault();
    props.onSelect();
    pendingMove = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      originX: props.embed.x,
      originY: props.embed.y,
    };
  };

  // Promote a pending surface press to a real move once it travels far enough.
  // Capturing here retargets the rest of the gesture — including the trailing
  // click — to the surface, so the tool under the press doesn't also react.
  const onSurfacePointerMove = (event: PointerEvent) => {
    const pending = pendingMove;
    if (pending && pending.pointerId === event.pointerId && !interaction) {
      // A mouse keeps its pointer id across gestures, so a press released
      // off-surface (no pointerup reached us) must not spring back to life on
      // the next hover — only track while the primary button is still down.
      if ((event.buttons & 1) === 0) {
        pendingMove = null;
      } else if (
        Math.hypot(
          event.clientX - pending.startClientX,
          event.clientY - pending.startClientY,
        ) >= SURFACE_DRAG_THRESHOLD
      ) {
        pendingMove = null;
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        interaction = {
          mode: "move",
          pointerId: pending.pointerId,
          startClientX: pending.startClientX,
          startClientY: pending.startClientY,
          originX: pending.originX,
          originY: pending.originY,
          originWidth: props.embed.width,
          originHeight: props.embed.height,
        };
        drag = {
          data: buildDragData(),
          overEl: null,
          overEmbed: null,
          accepted: false,
        };
      }
    }
    onPointerMove(event);
  };

  const onSurfacePointerEnd = (event: PointerEvent) => {
    if (pendingMove?.pointerId === event.pointerId) pendingMove = null;
    endInteraction(event);
  };

  return (
    <div
      ref={rootEl}
      class="embark-embed"
      data-embed-id={props.embed.id}
      classList={{
        "embark-embed--selected": props.selected,
        "embark-embed--highlighted": props.highlighted,
        "embark-embed--frameless": frameless(),
        "embark-embed--locked": locked(),
        "embark-embed--autosize": autosize(),
      }}
      style={{
        left: `${props.embed.x}px`,
        top: `${props.embed.y}px`,
        // Auto-size embeds shrink-wrap their content (see CSS), so don't pin a
        // width/height; every other embed uses its stored footprint.
        ...(autosize()
          ? {}
          : {
              width: `${props.embed.width}px`,
              height: `${props.embed.height}px`,
            }),
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
        on:pointermove={onSurfacePointerMove}
        on:pointerup={onSurfacePointerEnd}
        on:pointercancel={onSurfacePointerEnd}
      >
        <Show
          when={props.embed.componentUrl}
          fallback={
            <patchwork-view
              doc-url={props.embed.docUrl}
              tool-id={props.embed.toolId}
            />
          }
        >
          {(componentUrl) => <ComponentEmbed componentUrl={componentUrl()} />}
        </Show>
      </div>
      <Show when={resizable()}>
        <div
          class="embark-embed__resize"
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

// A component embed's body: a host div that imports and runs the standalone
// `patchwork:component` module at `componentUrl`. The host lives inside the
// canvas <patchwork-context>, so the component resolves the shared store through
// DOM discovery; renderComponentEmbed stamps `repo` on the host (the embed
// contract) and tears the component down on cleanup.
function ComponentEmbed(props: { componentUrl: string }) {
  const repo = useRepo();
  let hostEl: HTMLDivElement | undefined;
  onMount(() => {
    const host = hostEl;
    if (!host) return;
    const dispose = renderComponentEmbed(host, props.componentUrl, repo);
    onCleanup(dispose);
  });
  return (
    <div
      ref={hostEl}
      class="embark-embed__component"
      data-component-url={props.componentUrl}
    />
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

// Check glyph for a toggled-on menu item; inherits the item's text color.
function CheckIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="3"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M5 13l4 4L19 7" />
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
// id, whether it can be inspected (only document embeds can), and the anchor
// point in canvas-local pixels.
type ContextMenu = {
  embedId: string;
  toolId: string | undefined;
  inspectable: boolean;
  x: number;
  y: number;
};

// The position + size an inspector is placed relative to. An `EmbarkEmbed`
// satisfies this, so the source embed can be passed straight through.
type Rect = { x: number; y: number; width: number; height: number };

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

// A frameless surface press waiting to cross the drag threshold: where it
// started and the embed's position at press time. Discarded if the pointer is
// released (or the button found up) before traveling far enough.
type PendingMove = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
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

// Elements that own a press on a frameless surface: form controls, buttons,
// links, and editable regions. A press here should reach the element rather
// than start a drag.
const INTERACTIVE_SELECTOR =
  "input, textarea, select, button, a[href], [contenteditable]";

// True when a surface press should be left alone instead of starting a drag:
// it landed on an interactive element, or directly on a run of selectable text.
function pressLandsOnInteractiveOrText(event: PointerEvent): boolean {
  const target = event.target as Element | null;
  if (target?.closest(INTERACTIVE_SELECTOR)) return true;
  return pointHitsText(event.clientX, event.clientY);
}

// True when (clientX, clientY) falls on actual rendered, selectable text. The
// caret hit-test snaps to the nearest character even in empty padding, so
// confirm the point really lies within that character's box (with a little
// slack) — a press in the gaps beside text still starts a drag.
function pointHitsText(clientX: number, clientY: number): boolean {
  const hit = caretHitAtPoint(clientX, clientY);
  if (!hit || hit.node.nodeType !== Node.TEXT_NODE) return false;
  const text = hit.node.textContent ?? "";
  if (!text.trim()) return false;

  // Text the user can't select anyway (user-select: none — e.g. a card's
  // decorative labels) shouldn't hold up the drag; there's no selection
  // gesture to protect.
  const parent = hit.node.parentElement;
  if (parent && getComputedStyle(parent).userSelect === "none") return false;

  const range = document.createRange();
  const start = Math.max(0, Math.min(hit.offset, text.length - 1));
  range.setStart(hit.node, start);
  range.setEnd(hit.node, start + 1);

  const TOLERANCE = 2;
  const rects = range.getClientRects();
  for (let i = 0; i < rects.length; i++) {
    const rect = rects[i];
    if (
      clientX >= rect.left - TOLERANCE &&
      clientX <= rect.right + TOLERANCE &&
      clientY >= rect.top - TOLERANCE &&
      clientY <= rect.bottom + TOLERANCE
    ) {
      return true;
    }
  }
  return false;
}

// Cross-browser caret hit-test: the standard `caretPositionFromPoint` (Firefox)
// vs WebKit's `caretRangeFromPoint` (Chrome/Safari). Returns the node + offset
// under the point, or null when neither is available or the point hits nothing.
function caretHitAtPoint(
  clientX: number,
  clientY: number,
): { node: Node; offset: number } | null {
  const withPosition = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof withPosition.caretPositionFromPoint === "function") {
    const pos = withPosition.caretPositionFromPoint(clientX, clientY);
    return pos ? { node: pos.offsetNode, offset: pos.offset } : null;
  }
  const withRange = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  if (typeof withRange.caretRangeFromPoint === "function") {
    const range = withRange.caretRangeFromPoint(clientX, clientY);
    return range
      ? { node: range.startContainer, offset: range.startOffset }
      : null;
  }
  return null;
}

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
