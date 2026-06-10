import maplibregl from "maplibre-gl";
import type { DocHandle } from "@automerge/automerge-repo";
import {
  RepoContext,
  useDocument,
} from "../vendor/automerge-solid-primitives";
import "@inkandswitch/patchwork-elements";
import type { ToolElement, ToolRender } from "@inkandswitch/patchwork-plugins";
import {
  type Accessor,
  createEffect,
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
import { SurfaceProvider } from "../surface/SurfaceProvider";
import { subscribeDoc } from "../vendor/providers-solid";
import type { DocWithLayers, Point, SurfaceState } from "../surface/types";
import "maplibre-gl/dist/maplibre-gl.css";
import "./map.css";
import type { PaperMapDoc } from "./types";

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
// This constant must never change once shapes have been persisted.
const REFERENCE_ZOOM = 9.5;
const WORLD_SIZE = 512 * Math.pow(2, REFERENCE_ZOOM);
// Lng/lat of Mercator world origin (top-left of the world), used to anchor the
// world -> screen transform.
const WORLD_ORIGIN_LNGLAT = new maplibregl.MercatorCoordinate(0, 0, 0).toLngLat();

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
function MapPanControl(props: {
  map: Accessor<maplibregl.Map | undefined>;
}) {
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
