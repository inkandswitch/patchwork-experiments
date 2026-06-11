import { For, Show, createMemo, type JSX } from "solid-js";
import { useDocument } from "../vendor/automerge-solid-primitives";
import { subscribeDoc } from "../vendor/providers-solid";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DocWithLayers, Shape } from "../surface/types";
import { outlinePoints, resolveOutline } from "./geometry";
import "./select.css";

// Mirrors the shared focus document the FocusProvider owns. Keys in both maps
// are shape sub-document URLs. `selection` is what the select tool picked;
// `highlight` is auxiliary emphasis other views contribute (e.g. a text editor
// pointing at a shape from inside a link).
type FocusDoc = {
  selection: Record<string, true>;
  highlight: Record<string, true>;
};

// A full-canvas overlay that draws a highlight on each selected shape of its
// own surface. Purely a renderer: it iterates the selection from the focus
// provider, keeps the urls whose layer belongs to this surface, and paints a
// dashed outline per shape. Each url is a sub-document URL, so a highlight
// subscribes to exactly its shape — nothing is projected while the selection
// is empty. An embed's highlight is drawn by the parent's overlay. All
// selection interaction lives in SelectButton.
export function SelectionOverlay(props: {
  surfaceUrl: AutomergeUrl;
}): JSX.Element {
  let root!: HTMLDivElement;

  const [surface] = useDocument<DocWithLayers>(() => props.surfaceUrl);
  const [focusDoc] = subscribeDoc<FocusDoc>(() => root, {
    type: "patchwork:focus",
  });

  // Shape urls from a focus map that live in one of this surface's layers. The
  // focus doc is shared across all surfaces, so each overlay filters down to
  // its own. Sub-document URLs are prefixed by their document's URL, so "shape
  // is inside this layer" is a prefix check.
  const localUrlsIn = (map: Record<string, true> | undefined) => {
    const layerUrls: AutomergeUrl[] = Object.values(surface()?.layers ?? {});
    return Object.keys(map ?? {}).filter((shapeUrl) =>
      layerUrls.some((layerUrl) => shapeUrl.startsWith(layerUrl)),
    ) as AutomergeUrl[];
  };

  const selectedUrls = createMemo(() => localUrlsIn(focusDoc()?.selection));
  // Highlighted shapes that are not also selected, so a shape that is both
  // gets the (stronger) selection outline rather than two stacked strokes.
  const highlightedUrls = createMemo(() => {
    const selected = new Set(selectedUrls());
    return localUrlsIn(focusDoc()?.highlight).filter(
      (url) => !selected.has(url),
    );
  });

  return (
    <div ref={root} class="select-overlay">
      <svg class="select-overlay-svg" width="100%" height="100%">
        <For each={selectedUrls()}>
          {(url) => <ShapeHighlight url={url} class="select-highlight" />}
        </For>
        <For each={highlightedUrls()}>
          {(url) => <ShapeHighlight url={url} class="link-highlight" />}
        </For>
      </svg>
    </div>
  );
}

// Subscribes to a single shape via its sub-document URL and draws its resolved
// outline with the given highlight class. Rectangles and polygons close; lines
// stay open. Works for any outline variant, including the ones derived from
// legacy shapes.
function ShapeHighlight(props: {
  url: AutomergeUrl;
  class: string;
}): JSX.Element {
  const [shape] = useDocument<Shape>(() => props.url);

  const points = createMemo(() => {
    const current = shape();
    if (!current) return undefined;
    const outline = resolveOutline(current);
    if (!outline) return undefined;
    const local = outlinePoints(outline);
    return {
      closed: outline.type !== "line",
      value: local
        .map((p) => `${current.x + p.x},${current.y + p.y}`)
        .join(" "),
    };
  });

  return (
    <Show when={points()}>
      {(pts) => (
        <Show
          when={pts().closed}
          fallback={<polyline class={props.class} points={pts().value} />}
        >
          <polygon class={props.class} points={pts().value} />
        </Show>
      )}
    </Show>
  );
}
