import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { For, Show, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument, useRepo } from "solid-automerge";
import "@inkandswitch/patchwork-elements";
import { getDocumentDragPayload, hasDocumentDrag } from "./dnd";
import type { PartsBinDoc } from "./parts-bin/types";
import { SearchProvider } from "./providers/SearchProvider";
import { SchemaMatchProvider } from "./providers/SchemaMatchProvider";
import { StickerProvider } from "./providers/StickerProvider";
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
};

export type EmbarkCanvasDoc = {
  "@patchwork": { type: "embark-canvas" };
  title: string;
  embeds: { [id: string]: EmbarkEmbed };
};

const DEFAULT_WIDTH = 360;
const DEFAULT_HEIGHT = 280;
const MIN_WIDTH = 160;
const MIN_HEIGHT = 100;
// Offset stacked drops so dragging several docs in at once doesn't hide them.
const DROP_CASCADE = 28;

// Tool entry point: Solid renders into the host element and returns its own
// disposer. Absolutely-positioned embeds need a positioned ancestor, so the
// host element (often `position: static`) is promoted once up front.
export const EmbarkCanvasTool: ToolRender = (handle, element) => {
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }

  // The search broker lives on the canvas element so search boxes and POI
  // providers dropped onto the canvas can find each other (the provider
  // protocol only flows up the DOM, and the embeds are siblings).
  const disposeProvider = SearchProvider(element);

  // The schema-match provider also sits on the canvas: it watches every embed
  // mounted beneath it and answers `schema:matches` for descendants.
  const disposeSchemaMatch = SchemaMatchProvider(element);

  // The sticker broker bridges sticker sources (which publish annotations) and
  // renderers (which draw them), scoped per target document.
  const disposeStickers = StickerProvider(element);

  const disposeRender = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <EmbarkCanvas handle={handle as DocHandle<EmbarkCanvasDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );

  return () => {
    disposeRender();
    disposeStickers();
    disposeSchemaMatch();
    disposeProvider();
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

  // Selecting focuses the canvas root so it — not an embedded document —
  // receives key events. That's what lets Backspace/Delete remove the selected
  // embed without also firing while you type inside an embed.
  const selectEmbed = (id: string) => {
    setSelectedId(id);
    canvasEl()?.focus();
  };

  const deleteEmbed = (id: string) => {
    props.handle.change((canvas) => {
      delete canvas.embeds[id];
    });
    setSelectedId(null);
  };

  // Stable render order (by id) so <For> never reorders the DOM nodes — that
  // would tear down and remount the embedded <patchwork-view>. Stacking is
  // handled purely with z-index instead.
  const embeds = () =>
    Object.values(doc()?.embeds ?? {}).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );

  // The topmost parts-bin embed under a client point, if any. Matched against
  // each bin's stored rect (in canvas space) rather than the DOM, so we never
  // have to reach into the embedded <patchwork-view>. Used to detect when a
  // dragged embed is released over a bin.
  const binEmbedAt = (
    clientX: number,
    clientY: number,
    excludeId: string,
  ): EmbarkEmbed | null => {
    const rect = canvasEl()?.getBoundingClientRect();
    if (!rect) return null;
    const bins = embeds()
      .filter((embed) => embed.toolId === "parts-bin" && embed.id !== excludeId)
      .sort((a, b) => b.z - a.z);
    for (const bin of bins) {
      const left = rect.left + bin.x;
      const top = rect.top + bin.y;
      if (
        clientX >= left &&
        clientX <= left + bin.width &&
        clientY >= top &&
        clientY <= top + bin.height
      ) {
        return bin;
      }
    }
    return null;
  };

  // Copy an embed's document into a parts bin as a fresh clone — mirroring the
  // bin's drag-out behavior — so the bin keeps a stable template independent of
  // the original embed.
  const copyEmbedToBin = async (bin: EmbarkEmbed, source: EmbarkEmbed) => {
    const [binHandle, sourceHandle] = await Promise.all([
      repo.find<PartsBinDoc>(bin.docUrl),
      repo.find(source.docUrl),
    ]);
    const clone = repo.clone(sourceHandle);
    binHandle.change((binDoc) => {
      // Automerge rejects an explicit `undefined`, so only set `toolId` when the
      // source embed actually pins one.
      binDoc.items.push({
        url: clone.url,
        ...(source.toolId !== undefined && { toolId: source.toolId }),
      });
    });
  };

  const dropDocuments = (event: DragEvent) => {
    setIsDraggingOver(false);
    const payload = getDocumentDragPayload(event.dataTransfer);
    if (!payload) return;
    event.preventDefault();

    const rect = canvasEl()?.getBoundingClientRect();
    const dropX = rect ? event.clientX - rect.left : event.clientX;
    const dropY = rect ? event.clientY - rect.top : event.clientY;

    props.handle.change((canvas) => {
      let z = highestZ(canvas.embeds);
      payload.forEach((item, index) => {
        const id = crypto.randomUUID();
        const cascade = index * DROP_CASCADE;
        canvas.embeds[id] = {
          id,
          docUrl: item.url,
          x: dropX - DEFAULT_WIDTH / 2 + cascade,
          y: dropY - DEFAULT_HEIGHT / 2 + cascade,
          width: DEFAULT_WIDTH,
          height: DEFAULT_HEIGHT,
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
        if (event.key !== "Backspace" && event.key !== "Delete") return;
        // Ignore keys bubbling out of an embedded document; only act when the
        // canvas root itself holds focus (target === currentTarget).
        if (event.target !== event.currentTarget) return;
        const id = selectedId();
        if (!id) return;
        event.preventDefault();
        deleteEmbed(id);
      }}
      on:pointerdown={(event) => {
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
            onSelect={() => selectEmbed(embed.id)}
            onDelete={() => deleteEmbed(embed.id)}
            findBinAt={binEmbedAt}
            onCopyToBin={copyEmbedToBin}
          />
        )}
      </For>
      <Show when={embeds().length === 0}>
        <div class="embark-canvas__empty">Drag documents here to embed them</div>
      </Show>
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
  onSelect: () => void;
  onDelete: () => void;
  findBinAt: (
    clientX: number,
    clientY: number,
    excludeId: string,
  ) => EmbarkEmbed | null;
  onCopyToBin: (bin: EmbarkEmbed, source: EmbarkEmbed) => void;
}) {
  let rootEl: HTMLDivElement | undefined;
  let interaction: Interaction | null = null;

  const beginInteraction =
    (mode: InteractionMode) => (event: PointerEvent) => {
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
      bringToFront();
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
  };

  const endInteraction = (event: PointerEvent) => {
    const state = interaction;
    if (!state || state.pointerId !== event.pointerId) return;
    const handle = event.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
    interaction = null;

    // Dropping a move onto a parts bin copies the embed in and springs it back
    // to where the drag began, so it reads as "took a copy" rather than a move.
    // Resizes never copy, and a bin can't be dropped into a bin.
    if (state.mode !== "move" || props.embed.toolId === "parts-bin") return;
    const bin = props.findBinAt(event.clientX, event.clientY, props.embed.id);
    if (!bin) return;

    const dx = event.clientX - state.startClientX;
    const dy = event.clientY - state.startClientY;
    props.handle.change((canvas) => {
      const target = canvas.embeds[props.embed.id];
      if (!target) return;
      target.x = state.originX;
      target.y = state.originY;
    });
    void props.onCopyToBin(bin, props.embed);
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

  const bringToFront = () => {
    props.handle.change((canvas) => {
      const target = canvas.embeds[props.embed.id];
      if (!target) return;
      const top = highestZ(canvas.embeds);
      if (target.z < top) target.z = top + 1;
    });
  };

  return (
    <div
      ref={rootEl}
      class="embark-embed"
      classList={{ "embark-embed--selected": props.selected }}
      style={{
        left: `${props.embed.x}px`,
        top: `${props.embed.y}px`,
        width: `${props.embed.width}px`,
        height: `${props.embed.height}px`,
        "z-index": props.embed.z,
      }}
    >
      <div
        class="embark-embed__handle"
        title="Drag to move"
        on:pointerdown={beginInteraction("move")}
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
      <div class="embark-embed__view">
        <patchwork-view doc-url={props.embed.docUrl} tool-id={props.embed.toolId} />
      </div>
      <div
        class="embark-embed__resize"
        title="Drag to resize"
        on:pointerdown={beginInteraction("resize")}
        on:pointermove={onPointerMove}
        on:pointerup={endInteraction}
        on:pointercancel={endInteraction}
      />
    </div>
  );
}

// Six-dot grip glyph for the move handle; inherits the handle's text color.
function GripIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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

// Largest z across all embeds (0 when empty), used to place fresh/raised
// embeds on top.
function highestZ(embeds: { [id: string]: EmbarkEmbed }): number {
  let max = 0;
  for (const embed of Object.values(embeds)) {
    if (embed.z > max) max = embed.z;
  }
  return max;
}
