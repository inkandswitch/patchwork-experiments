import { render } from "solid-js/web";
import { For, createSignal, onCleanup, onMount } from "solid-js";
import {
  RepoContext,
  useDocument,
} from "../vendor/automerge-solid-primitives";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import "@inkandswitch/patchwork-elements";
import type { Shape, ShapeLayerDoc } from "../surface/types";
import { resolveOutline } from "../select/geometry";
import "./embed.css";

// The drag handle's height (px). The embed's rectangle outline covers its
// full footprint — handle strip on top, view below — so this is purely a
// rendering split, invisible to hit-testing and the selection overlay.
const HANDLE_HEIGHT = 20;

// An embed places another document on the canvas. Its geometry is a rectangle
// outline covering its full footprint — drag handle plus embedded view — so
// the selection tool hit-tests it like any other shape; `docUrl` is the
// embedded document and `toolId` optionally pins which tool renders it.
export type EmbedShape = Shape & {
  outline?: { type: "rectangle"; width: number; height: number };
  docUrl: AutomergeUrl;
  toolId?: string;
};

// Read width/height from the rectangle outline, falling back to legacy fields.
function embedSize(shape: EmbedShape): { width: number; height: number } {
  const outline = resolveOutline(shape);
  if (outline?.type === "rectangle")
    return { width: outline.width, height: outline.height };
  return { width: shape.width ?? 320, height: shape.height ?? 240 };
}

// A self-contained layer tool that mounts one <patchwork-view> per embed shape,
// positioned and sized from the shape. Like the other layer tools its host is a
// full-canvas overlay; per-shape views are absolutely positioned within it.
export const EmbedLayerTool: ToolRender = (handle, element) => {
  element.classList.add("paper-embed-host");

  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <EmbedLayer handle={handle as DocHandle<ShapeLayerDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

function EmbedLayer(props: { handle: DocHandle<ShapeLayerDoc> }) {
  const [doc] = useDocument<ShapeLayerDoc>(() => props.handle.url);
  const shapes = () => Object.values(doc()?.shapes ?? {}) as EmbedShape[];

  // The embed whose drag handle is currently grabbed. While set, that embed's
  // own view is pointer-transparent: a fast drag outruns the handle onto the
  // embed's body, and if the embedded surface claimed those events the drag
  // would stall (the embed can't re-home into itself). Transparent, they fall
  // through to the parent — or a sibling surface — which keeps stamping
  // usable samples, so the embed catches up every frame.
  const [grabbedId, setGrabbedId] = createSignal<string>();

  // Capture phase: surface roots stop propagation of pointerup in the bubble
  // phase, so a bubble listener on window would miss in-surface releases.
  onMount(() => {
    const release = () => setGrabbedId(undefined);
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    onCleanup(() => {
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
    });
  });

  // Pointer events never cross the embed boundary: an embedded surface stops
  // propagation at its own root, but a non-surface document wouldn't, and its
  // events would bubble out and be stamped by the parent surface as if the
  // pointer were on the paper itself. The capture-phase window listeners
  // above still see these events, so a grab is always released.
  const stopPointerEvent = (event: Event) => event.stopPropagation();

  // Embeds are always interactive: an embedded surface handles its own
  // pointer input (it stamps the shared surface:state and stops propagation),
  // which is what lets tools draw into it and drags drop onto it.
  // hide-controls keeps nested papers from rendering their own toolbar, so
  // there is exactly one instance of each tool button.
  //
  // The drag handle is the top strip of the embed's rectangle; the view
  // fills the rest. The handle belongs to this (parent) surface's DOM, not
  // the embedded surface, so pointer events on it are stamped by the parent
  // in parent coordinates, and since it lies inside the embed's outline the
  // select tool hit-tests the embed like any other shape. The handle must
  // not stop propagation — the press has to reach the surface root to stamp.
  return (
    <For each={shapes()}>
      {(embed) => (
        <>
          {/* data-automerge-url (on both elements: together they are the
              embed's footprint) lets the SelectionOverlay's generated
              stylesheet target the embed like any other shape. */}
          <patchwork-view
            class="paper-embed-item"
            data-automerge-url={props.handle.sub("shapes", embed.id).url}
            doc-url={embed.docUrl}
            tool-id={embed.toolId}
            hide-controls=""
            on:pointerdown={stopPointerEvent}
            on:pointermove={stopPointerEvent}
            on:pointerup={stopPointerEvent}
            on:pointercancel={stopPointerEvent}
            style={{
              position: "absolute",
              left: `${embed.x}px`,
              top: `${embed.y + HANDLE_HEIGHT}px`,
              width: `${embedSize(embed).width}px`,
              height: `${Math.max(0, embedSize(embed).height - HANDLE_HEIGHT)}px`,
              right: "auto",
              bottom: "auto",
              "z-index": embed.z,
              "pointer-events": grabbedId() === embed.id ? "none" : "auto",
            }}
          />
          <div
            class="paper-embed-handle"
            data-automerge-url={props.handle.sub("shapes", embed.id).url}
            on:pointerdown={() => setGrabbedId(embed.id)}
            style={{
              position: "absolute",
              left: `${embed.x}px`,
              top: `${embed.y}px`,
              width: `${embedSize(embed).width}px`,
              height: `${HANDLE_HEIGHT}px`,
              "z-index": embed.z,
            }}
          />
        </>
      )}
    </For>
  );
}
