import { For, Show, createMemo, type Accessor, type JSX } from "solid-js";
import { useDocument } from "../vendor/automerge-solid-primitives";
import { subscribeDoc } from "../vendor/providers-solid";
import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { DocWithLayers, Shape } from "../surface/types";
import { outlinePoints } from "../surface/geometry";
import "./select.css";

// Mirrors the shared focus document the FocusProvider owns. Keys in both maps
// are shape sub-document URLs. `selection` is what the select tool picked;
// `highlight` is auxiliary emphasis other views contribute (e.g. a text editor
// pointing at a shape from inside a link).
type FocusDoc = {
  selection: Record<string, true>;
  highlight: Record<string, true>;
};

// The highlight emphasis: a soft yellow glow, rendered as a CSS filter on the
// shape's own DOM element (the layer tools stamp `data-automerge-url` with the
// shape's sub-document url, the same key the focus maps use). Painting on the
// shape itself follows its rendered alpha and its stacking position, and CSS
// matches late-mounting or re-created elements automatically.
const HIGHLIGHT_GLOW =
  "drop-shadow(0 0 3px rgba(245, 158, 11, 0.95)) " +
  "drop-shadow(0 0 6px rgba(245, 158, 11, 0.6))";

// Renders the selection and highlight emphasis for this surface's shapes.
// Selection draws each selected shape's outline in an svg overlay above the
// layers; highlight is a generated stylesheet applying a glow to the shape's
// own element. The two are independent, so a shape that is both selected and
// highlighted shows both. Each selection outline subscribes to exactly its
// shape via its sub-document URL — nothing is projected while the selection
// is empty. An embed's outline is drawn by the parent's overlay. All
// selection interaction lives in SelectButton.
export function SelectionOverlay(props: {
  surfaceUrl: AutomergeUrl;
  // Screen px per surface unit. The overlay svg sits inside the surface's
  // (possibly scaled) container, so the outline is rendered at 1/scale and the
  // ancestor transform brings it back to a constant on-screen thickness.
  scale?: Accessor<number>;
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

  const highlightCss = createMemo(() =>
    localUrlsIn(focusDoc()?.highlight)
      .map(
        (url) => `[data-automerge-url="${url}"] { filter: ${HIGHLIGHT_GLOW}; }`,
      )
      .join("\n"),
  );

  return (
    <div ref={root} class="select-overlay">
      <style>{highlightCss()}</style>
      <svg
        class="select-overlay-svg"
        width="100%"
        height="100%"
        style={{ "--select-scale": String(props.scale?.() ?? 1) }}
      >
        <For each={selectedUrls()}>{(url) => <ShapeOutline url={url} />}</For>
      </svg>
    </div>
  );
}

// Subscribes to a single shape via its sub-document URL and draws its outline.
// Rectangles and polygons close; lines stay open. Works for any outline
// variant.
function ShapeOutline(props: { url: AutomergeUrl }): JSX.Element {
  const [shape] = useDocument<Shape>(() => props.url);

  const points = createMemo(() => {
    const current = shape();
    if (!current) return undefined;
    const outline = current.outline;
    const local = outlinePoints(outline);
    // Outline points are in logical pixels; scale them back into world units
    // around the shape anchor so the overlay (drawn in the surface's space)
    // lines up with the shape's own scaled rendering.
    return {
      closed: outline.type !== "line",
      value: local
        .map(
          (p) =>
            `${current.x + p.x * current.scale},${current.y + p.y * current.scale}`,
        )
        .join(" "),
    };
  });

  return (
    <Show when={points()}>
      {(pts) => (
        <Show
          when={pts().closed}
          fallback={<polyline class="select-outline" points={pts().value} />}
        >
          <polygon class="select-outline" points={pts().value} />
        </Show>
      )}
    </Show>
  );
}
