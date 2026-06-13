import maplibregl from "maplibre-gl";
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import {
  RepoContext,
  useDocument,
  useRepo,
} from "../vendor/automerge-solid-primitives";
import "@inkandswitch/patchwork-elements";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { render } from "solid-js/web";
import { LineButton } from "../line/LineButton";
import { RectButton } from "../rect/RectButton";
import { SelectButton } from "../select/SelectButton";
import { SelectionOverlay } from "../select/SelectionOverlay";
import { outlinePoints } from "../surface/geometry";
import { SurfaceProvider } from "../surface/SurfaceProvider";
import { subscribeDoc } from "../vendor/providers-solid";
import type {
  DocWithLayers,
  Point,
  Shape,
  SurfaceState,
} from "../surface/types";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";
import type { PaperMapDoc } from "./types";

// The shared focus document the FocusProvider owns. Keys in `highlight` are
// shape sub-document URLs other views (e.g. a text editor pointing at a shape
// from inside a link) want emphasized.
type FocusDoc = {
  selection: Record<string, true>;
  highlight: Record<string, true>;
};

// OpenFreeMap's public instance: no API key, OpenStreetMap data, free tiles.
// https://openfreemap.org/
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const CENTER: [number, number] = [13.388, 52.517];
const ZOOM = 9.5;

// The map's local coordinate space is Web Mercator world units at this fixed
// reference zoom: a lng/lat is pushed through the Mercator projection (giving
// normalized [0,1] coordinates) and scaled by WORLD_SIZE. The map view is then
// always a uniform scale + translate of this plane, so shapes the layer tools
// store stay georeferenced as the camera moves. At REFERENCE_ZOOM one world
// unit is one screen pixel, so tool pixel heuristics behave like on paper.
// This constant must never change once shapes have been persisted: world
// coordinates scale as 2^REFERENCE_ZOOM, and SVG renders coordinate values in
// 32-bit float, so pushing it much higher (e.g. street-level ~16) sends Berlin
// coords past ~16.7M (2^24) where sub-pixel stroke detail collapses.
const REFERENCE_ZOOM = 9.5;
const WORLD_SIZE = 512 * Math.pow(2, REFERENCE_ZOOM);
// Lng/lat of Mercator world origin (top-left of the world), used to anchor the
// world -> screen transform.
const WORLD_ORIGIN_LNGLAT = new maplibregl.MercatorCoordinate(
  0,
  0,
  0,
).toLngLat();

// Inverse of `toLocal`'s projection: a point in the map's local (Mercator world
// unit) space back to geographic coordinates, so shapes can be located on the
// camera's lng/lat plane.
function worldToLngLat(x: number, y: number): maplibregl.LngLat {
  return new maplibregl.MercatorCoordinate(
    x / WORLD_SIZE,
    y / WORLD_SIZE,
    0,
  ).toLngLat();
}

// Below this much of the viewport's larger on-screen dimension, a highlighted
// shape is considered too small to read, so the camera zooms in to frame it
// (leaving this fraction of padding on each side) rather than only panning.
// Zoom is capped so a point-like shape doesn't fly to an extreme level.
const MIN_SCREEN_FRACTION = 0.1;
const FOCUS_PADDING_FRACTION = 0.25;
const MAX_FOCUS_ZOOM = 18;

// The map surface tool. Like PaperTool it wraps the layer <patchwork-view>
// stack in a SurfaceProvider, but the provider's local space is geographic:
// the map projects pointer events into Mercator world units, and the layer
// stack is rendered inside a container whose CSS transform maps those world
// units back to screen pixels as the camera moves.
export const MapTool: ToolRender = (handle, element) => {
  if (getComputedStyle(element).position === "static") {
    element.style.position = "relative";
  }
  element.classList.add("paper-map-host");

  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <MapSurface
          handle={handle as DocHandle<PaperMapDoc>}
          element={element}
        />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

function MapSurface(props: {
  handle: DocHandle<PaperMapDoc>;
  element: ToolElement;
}) {
  const [doc] = useDocument<PaperMapDoc>(() => props.handle.url);
  const layers = () => Object.entries(doc()?.layers ?? {});
  // Embedded maps hide their toolbar so only the outermost surface shows one,
  // mirroring PaperSurface.
  const showControls = !props.element.hasAttribute("hide-controls");

  const [isMounted, setIsMounted] = createSignal(false);
  const [map, setMap] = createSignal<maplibregl.Map>();
  // The world -> screen transform, recomputed whenever the camera moves.
  const [transform, setTransform] = createSignal(
    "translate(0px, 0px) scale(1)",
  );

  let mapContainer!: HTMLDivElement;

  // Project a pointer event into the map's local (Mercator world) space. The
  // map owns this conversion, so no layer tool ever learns the surface is
  // geographic — it just reads world coordinates like any other surface space.
  const toLocal = (clientX: number, clientY: number): Point => {
    const m = map();
    if (!m) return { x: 0, y: 0 };
    const rect = mapContainer.getBoundingClientRect();
    const lngLat = m.unproject([clientX - rect.left, clientY - rect.top]);
    const merc = maplibregl.MercatorCoordinate.fromLngLat(lngLat);
    return { x: merc.x * WORLD_SIZE, y: merc.y * WORLD_SIZE };
  };

  onMount(() => {
    const m = new maplibregl.Map({
      container: mapContainer,
      style: STYLE_URL,
      center: CENTER,
      zoom: ZOOM,
      // Keep the view affine (a pure scale + translate of the world plane) so
      // the single CSS transform stays exact, and free shift-drag for the
      // select tool's multi-select.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0,
      boxZoom: false,
    });
    m.touchZoomRotate.disableRotation();

    const updateTransform = () => {
      const scale = Math.pow(2, m.getZoom() - REFERENCE_ZOOM);
      const origin = m.project(WORLD_ORIGIN_LNGLAT);
      setTransform(`translate(${origin.x}px, ${origin.y}px) scale(${scale})`);
    };
    m.on("move", updateTransform);
    updateTransform();

    setMap(m);

    onCleanup(() => m.remove());
  });

  return (
    <SurfaceProvider
      handle={props.handle as DocHandle<DocWithLayers>}
      toLocal={toLocal}
      onMounted={() => setIsMounted(true)}
    >
      <div ref={mapContainer} class="paper-map-container" />
      <Show when={isMounted()}>
        <div
          class="paper-map-overlay"
          style={{ transform: transform(), "transform-origin": "0 0" }}
        >
          <For each={layers()}>
            {([toolId, url]) => (
              <patchwork-view doc-url={url} tool-id={toolId} />
            )}
          </For>
          <SelectionOverlay surfaceUrl={props.handle.url} />
        </div>
        <MapPanControl map={map} />
        <MapHighlightFocus map={map} surfaceUrl={props.handle.url} />
        <Show when={showControls}>
          <div class="paper-controls">
            <SelectButton />
            <RectButton />
            <LineButton />
          </div>
        </Show>
      </Show>
    </SurfaceProvider>
  );
}

// Drawing vs. panning: a drag must draw or select while a tool is active, so
// map panning is turned off then and re-enabled when no tool is selected.
// Mounted only after the SurfaceProvider (inside the same `isMounted` gate as
// the toolbar) so its `surface:state` subscription reaches the provider, and
// it subscribes from its own anchor element, which lives under the provider.
function MapPanControl(props: { map: Accessor<maplibregl.Map | undefined> }) {
  let anchor!: HTMLSpanElement;

  const [surfaceState] = subscribeDoc<SurfaceState>(() => anchor, {
    type: "surface:state",
  });

  createEffect(() => {
    const m = props.map();
    if (!m) return;
    if (surfaceState()?.selectedToolId) m.dragPan.disable();
    else m.dragPan.enable();
  });

  return <span ref={anchor} style={{ display: "none" }} />;
}

// Pans highlighted shapes into view. When the focus doc's `highlight` set
// changes (e.g. a text editor's cursor enters a link pointing at a shape on
// this map) and the highlighted shapes aren't already on screen, the camera
// eases to center them, keeping the current zoom. Mounted under the provider
// like MapPanControl so its focus subscription reaches the provider.
function MapHighlightFocus(props: {
  map: Accessor<maplibregl.Map | undefined>;
  surfaceUrl: AutomergeUrl;
}) {
  let anchor!: HTMLSpanElement;

  const repo = useRepo();
  const [surfaceDoc] = useDocument<DocWithLayers>(() => props.surfaceUrl);
  const [focusDoc] = subscribeDoc<FocusDoc>(() => anchor, {
    type: "patchwork:focus",
  });

  // Highlighted shape urls that live in one of this surface's layers. Recomputed
  // only when that set actually changes (not on unrelated focus writes such as
  // selection moves), so the camera doesn't lurch on every cursor tick.
  const highlightedUrls = createMemo<AutomergeUrl[]>(
    () => {
      const layerUrls: AutomergeUrl[] = Object.values(
        surfaceDoc()?.layers ?? {},
      );
      return Object.keys(focusDoc()?.highlight ?? {}).filter((shapeUrl) =>
        layerUrls.some((layerUrl) => shapeUrl.startsWith(layerUrl)),
      ) as AutomergeUrl[];
    },
    [],
    { equals: sameUrls },
  );

  // Resolving shapes is async; a newer highlight invalidates an in-flight pan.
  let panSeq = 0;
  createEffect(() => {
    const urls = highlightedUrls();
    const m = props.map();
    if (!m || urls.length === 0) return;
    const seq = ++panSeq;
    void (async () => {
      const bounds = await collectShapeBounds(repo, urls);
      if (!bounds || seq !== panSeq) return;
      focusBounds(m, bounds);
    })();
  });

  return <span ref={anchor} style={{ display: "none" }} />;
}

// Bring `bounds` into comfortable view: zoom in if the shapes are too small to
// read, otherwise pan if they're off-screen, and leave the camera alone when
// they're already adequately framed. Only ever zooms in (the zoom cap is never
// below the current zoom), since the caller's intent is to surface a highlight.
function focusBounds(map: maplibregl.Map, bounds: maplibregl.LngLatBounds) {
  const container = map.getContainer();
  const viewWidth = container.clientWidth;
  const viewHeight = container.clientHeight;
  if (viewWidth === 0 || viewHeight === 0) return;

  const ne = map.project(bounds.getNorthEast());
  const sw = map.project(bounds.getSouthWest());
  const fraction = Math.max(
    Math.abs(ne.x - sw.x) / viewWidth,
    Math.abs(ne.y - sw.y) / viewHeight,
  );

  if (fraction < MIN_SCREEN_FRACTION) {
    map.fitBounds(bounds, {
      padding: {
        top: viewHeight * FOCUS_PADDING_FRACTION,
        bottom: viewHeight * FOCUS_PADDING_FRACTION,
        left: viewWidth * FOCUS_PADDING_FRACTION,
        right: viewWidth * FOCUS_PADDING_FRACTION,
      },
      maxZoom: Math.max(MAX_FOCUS_ZOOM, map.getZoom()),
    });
    return;
  }

  if (!viewportContains(map.getBounds(), bounds)) {
    map.easeTo({ center: bounds.getCenter() });
  }
}

// The geographic bounds of the given shapes, or undefined if none resolved.
async function collectShapeBounds(
  repo: Repo,
  urls: AutomergeUrl[],
): Promise<maplibregl.LngLatBounds | undefined> {
  const bounds = new maplibregl.LngLatBounds();
  let extended = false;
  for (const url of urls) {
    try {
      const shape = (await repo.find<Shape>(url)).doc();
      if (!shape) continue;
      for (const point of outlinePoints(shape.outline)) {
        bounds.extend(worldToLngLat(shape.x + point.x, shape.y + point.y));
        extended = true;
      }
    } catch {
      // Shape unavailable (e.g. not yet synced); skip it.
    }
  }
  return extended ? bounds : undefined;
}

// True if `target` sits entirely within `view`. The map view is kept unrotated,
// so its north-east and south-west corners bound the visible region.
function viewportContains(
  view: maplibregl.LngLatBounds,
  target: maplibregl.LngLatBounds,
): boolean {
  return (
    view.contains(target.getNorthEast()) && view.contains(target.getSouthWest())
  );
}

function sameUrls(a: AutomergeUrl[], b: AutomergeUrl[]): boolean {
  return a.length === b.length && a.every((url, i) => url === b[i]);
}
