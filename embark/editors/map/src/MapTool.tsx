import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { render } from "solid-js/web";
import { installMapExtensionsHost } from "@embark/map-extensions-host";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  type MapBounds,
  type MapDoc,
} from "./datatype";
import { SearchPanel } from "./SearchPanel";
import "./map.css";

// openfreemap's hosted Liberty style — no API key required.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
// Floating-point slack so a viewport we just wrote (then read straight back)
// doesn't count as a change and bounce between map and doc forever.
const COORD_EPSILON = 1e-6;
const ZOOM_EPSILON = 1e-3;

// Tool entry point: maplibre owns its own subtree, so this renders into a plain
// container rather than through Solid. The tool itself is deliberately small:
// it owns the map instance, the *persisted* viewport (center/zoom/bounds in
// the doc, written only by manual pans/zooms), and the search overlay.
// Everything else — markers, lines, focus zooming — arrives through the canvas
// `map:extensions` channel: cards publish extensions, and the host installed
// here runs them against this map (see @embark/map-extensions-host). Transient
// camera moves those extensions make are never persisted; only gestures
// carrying an `originalEvent` write the doc.
export const MapTool: ToolRender = (rawHandle, element) => {
  const handle = rawHandle as DocHandle<MapDoc>;

  const container = document.createElement("div");
  container.className = "embark-map";
  element.appendChild(container);

  const initial = handle.doc();
  const map = new maplibregl.Map({
    container,
    style: STYLE_URL,
    center: initial?.center ?? DEFAULT_CENTER,
    zoom: initial?.zoom ?? DEFAULT_ZOOM,
    attributionControl: false,
    // Resizes are handled by our own observer below (un-throttled, with a
    // synchronous redraw); maplibre's built-in tracking is throttled to 50ms
    // and would double-resize in between.
    trackResize: false,
  });

  const currentBounds = (): MapBounds => {
    const b = map.getBounds();
    return {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
  };

  // True when the live camera matches the persisted home viewport. Extensions
  // (the geo-zoom card) and the search panel move the camera transiently and
  // never write the doc, so "camera equals home" is how load/resize persists
  // avoid freezing a transient frame into the doc.
  const atHome = (): boolean => {
    const doc = handle.doc();
    if (!doc) return false;
    const { lng, lat } = map.getCenter();
    return viewportsEqual(doc, [lng, lat], map.getZoom());
  };

  // Persist the visible box as the home box. Only ever called while the camera
  // is at home (manual move, load, resize-at-home), so map-search consumers
  // that read doc.bounds see the manual view, never a transient overlay.
  const persistBounds = () => {
    const bounds = currentBounds();
    handle.change((doc) => {
      if (!boundsEqual(doc.bounds, bounds)) doc.bounds = bounds;
    });
  };

  // A user gesture (drag/scroll/touch) is the only thing that updates the
  // persisted viewport: those moveends carry an `originalEvent`, while
  // extension eases and remote-change jumps do not.
  const onMoveEnd = (event: { originalEvent?: unknown }) => {
    if (!event.originalEvent) return;
    const { lng, lat } = map.getCenter();
    const zoom = map.getZoom();
    const bounds = currentBounds();
    handle.change((doc) => {
      if (!viewportsEqual(doc, [lng, lat], zoom)) {
        doc.center = [lng, lat];
        doc.zoom = zoom;
      }
      if (!boundsEqual(doc.bounds, bounds)) doc.bounds = bounds;
    });
  };
  map.on("moveend", onMoveEnd);

  // The first accurate bounds are only available once the map has measured its
  // container, so seed the home box on load (center/zoom already match the
  // doc). Skip if something has already moved the camera off home, so we never
  // freeze a transient frame as home.
  const onLoad = () => {
    if (atHome()) persistBounds();
  };
  map.on("load", onLoad);

  // Document -> map. Skip when the map is already there (e.g. our own write
  // coming back) to avoid interrupting an in-flight interaction.
  const onDocChange = () => {
    const doc = handle.doc();
    if (!doc) return;
    const { lng, lat } = map.getCenter();
    if (viewportsEqual(doc, [lng, lat], map.getZoom())) return;
    map.jumpTo({ center: doc.center, zoom: doc.zoom });
  };
  handle.on("change", onDocChange);

  // The embed is resized continuously during a drag, so re-measure on every
  // container change (trackResize is off — maplibre's built-in observer is
  // throttled to 50ms). `resize()` clears the WebGL buffer and only schedules
  // an async repaint, so without the synchronous `redraw()` the browser paints
  // blank frames between clears — the resize flicker. ResizeObserver callbacks
  // run after layout but before paint, so the redraw lands in the same frame.
  // Resizing also changes the home box (center/zoom hold steady, so no moveend
  // fires) — re-persist it, debounced, but only while resting at home so a
  // transient extension frame never leaks its widened box into the persisted
  // bounds.
  //
  // Skip the observer's first, setup-time callback (ResizeObserver always fires
  // one on observe()), exactly as maplibre's own tracker does. With trackResize
  // off we're the sole thing resizing the map, and redraw() aborts maplibre's
  // pending initial render frame — so firing it here, before the style has ever
  // painted, blanks the map in any embed whose size never changes again after
  // mount (the parts-bin previews). The constructor already sized the map to
  // the laid-out container, so skipping this first event costs nothing.
  let resizeSyncTimer: ReturnType<typeof setTimeout> | undefined;
  let initialResizeSeen = false;
  const resizeObserver = new ResizeObserver(() => {
    if (!initialResizeSeen) {
      initialResizeSeen = true;
      return;
    }
    map.resize();
    map.redraw();
    if (resizeSyncTimer) clearTimeout(resizeSyncTimer);
    resizeSyncTimer = setTimeout(() => {
      if (atHome()) persistBounds();
    }, 150);
  });
  resizeObserver.observe(container);

  // Install whatever map extensions the canvas's cards publish (markers,
  // lines, focus zooming, …). The host keeps the installed set in step with
  // the channel and tears everything down with us.
  const uninstallExtensions = installMapExtensionsHost(element, map);

  // Mount the Google-Maps-style search overlay. It draws its own ephemeral
  // pins and routes straight onto this map. Its camera moves are programmatic
  // (no `originalEvent`), so they are never persisted — and the geo-zoom
  // extension, if present, adopts them as the view to return to.
  const searchHost = document.createElement("div");
  searchHost.className = "embark-map-search-host";
  container.appendChild(searchHost);
  const disposeSearch = render(
    () => <SearchPanel map={map} onCameraControl={() => {}} />,
    searchHost,
  );

  return () => {
    disposeSearch();
    searchHost.remove();
    uninstallExtensions();
    if (resizeSyncTimer) clearTimeout(resizeSyncTimer);
    resizeObserver.disconnect();
    handle.off("change", onDocChange);
    map.off("moveend", onMoveEnd);
    map.off("load", onLoad);
    map.remove();
    container.remove();
  };
};

// True when the stored viewport already matches `center`/`zoom` within epsilon.
function viewportsEqual(
  doc: MapDoc,
  center: [number, number],
  zoom: number,
): boolean {
  return (
    Math.abs(doc.center[0] - center[0]) < COORD_EPSILON &&
    Math.abs(doc.center[1] - center[1]) < COORD_EPSILON &&
    Math.abs(doc.zoom - zoom) < ZOOM_EPSILON
  );
}

// True when the stored bounds already match within epsilon, so a re-read of the
// same box never churns the doc (and never re-triggers subscribers downstream).
function boundsEqual(a: MapBounds | undefined, b: MapBounds): boolean {
  if (!a) return false;
  return (
    Math.abs(a.west - b.west) < COORD_EPSILON &&
    Math.abs(a.south - b.south) < COORD_EPSILON &&
    Math.abs(a.east - b.east) < COORD_EPSILON &&
    Math.abs(a.north - b.north) < COORD_EPSILON
  );
}
