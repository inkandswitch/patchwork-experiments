import { render } from "solid-js/web";
import { For, createSignal, onCleanup, onMount } from "solid-js";
import { RepoContext, useDocument } from "../vendor/automerge-solid-primitives";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import "@inkandswitch/patchwork-elements";
import type { Shape, ShapeLayerDoc, SurfaceState } from "../surface/types";
import "./embed.css";
import { subscribeDoc } from "../vendor/providers-solid";

// An embed places another document on the canvas. Its geometry is a rectangle
// outline covering its full footprint — drag handle plus embedded view — so
// the selection tool hit-tests it like any other shape; `docUrl` is the
// embedded document and `toolId` optionally pins which tool renders it.
export type EmbedShape = Shape & {
  outline: { type: "rectangle"; width: number; height: number };
  docUrl: AutomergeUrl;
  toolId?: string;
};

// Read width/height from the rectangle outline.
function embedSize(shape: EmbedShape): { width: number; height: number } {
  return { width: shape.outline.width, height: shape.outline.height };
}

// A self-contained layer tool that mounts one <patchwork-view> per embed shape,
// positioned and sized from the shape. Like the other layer tools its host is a
// full-canvas overlay; per-shape views are absolutely positioned within it.
export const EmbedLayerTool: ToolRender = (handle, element) => {
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
  const [root, setRoot] = createSignal<HTMLDivElement>();
  const [surface] = subscribeDoc<SurfaceState>(root, { type: "surface:state" });
  const [doc] = useDocument<ShapeLayerDoc>(() => props.handle.url);

  const shapes = () => Object.values(doc()?.shapes ?? {}) as EmbedShape[];

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
    <div ref={setRoot}>
      <For each={shapes()}>
        {(embed) => {
          const [isDragging, setIsDragging] = createSignal();
          const [doc] = useDocument<{ "@patchwork": { type: string } }>(
            embed.docUrl,
          );
          doc()?.["@patchwork"].type;

          const preventPointerEventsGoingIn = () =>
            isDragging() || surface()?.selectedToolId !== "select";

          const preventPointerEventsBubblingUp = () =>
            surface()?.selectedToolId === "select";

          return (
            <div
              class="embed-shape"
              style={{
                position: "absolute",
                left: "0",
                top: "0",
                "transform-origin": "0 0",
                transform: `translate(${embed.x}px, ${embed.y}px) scale(${embed.scale})`,
                "z-index": embed.z,
                width: `${embedSize(embed).width}px`,
                height: `${embedSize(embed).height}px`,
              }}
            >
              {/* data-automerge-url (on both elements: together they are the
              embed's footprint) lets the SelectionOverlay's generated
              stylesheet target the embed like any other shape. */}

              <div
                class="embed-shape-drag-handle"
                on:pointerdown={(event) => {
                  if (preventPointerEventsGoingIn()) {
                    event.preventDefault();
                  }
                  setIsDragging(true);
                }}
                on:pointerup={(event) => {
                  if (preventPointerEventsGoingIn()) {
                    event.preventDefault();
                  }
                  setIsDragging(false);
                }}
                on:pointermove={(event) => {
                  if (preventPointerEventsGoingIn()) {
                    event.preventDefault();
                  }
                }}
              ></div>
              <patchwork-view
                data-automerge-url={props.handle.sub("shapes", embed.id).url}
                doc-url={embed.docUrl}
                tool-id={embed.toolId}
                hide-controls=""
                style={{
                  "pointer-events": preventPointerEventsGoingIn()
                    ? "none"
                    : "auto",
                }}
                on:pointerdown={(event) => {
                  if (preventPointerEventsBubblingUp()) {
                    event.stopPropagation();
                  }
                }}
                on:pointermove={(event) => {
                  if (preventPointerEventsBubblingUp()) {
                    event.stopPropagation();
                  }
                }}
                on:pointerup={(event) => {
                  if (preventPointerEventsBubblingUp()) {
                    event.stopPropagation();
                  }
                }}
              />
            </div>
          );
        }}
      </For>
    </div>
  );
}
