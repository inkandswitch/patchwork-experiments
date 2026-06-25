import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { getContextHandle, subscribeContext } from "../lib/context";
import {
  Highlight,
  SchemaMatches,
  SchemaQueries,
  Selection,
} from "../canvas/channels";
import { LATLNG_KEY, LATLNG_QUERY } from "../canvas/well-known-schemas";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  type MapBounds,
  type MapDoc,
} from "./datatype";
import "./map.css";

// openfreemap's hosted Liberty style — no API key required.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
// Pins are blue; CSS intensifies/glows them while focused (see map.css).
const MARKER_COLOR = "#3b82f6";
// Floating-point slack so a viewport we just wrote (then read straight back)
// doesn't count as a change and bounce between map and doc forever.
const COORD_EPSILON = 1e-6;
const ZOOM_EPSILON = 1e-3;

// The map asks the canvas "where, in any mounted document, is a {lat, lon}
// pair?" (the shared LATLNG schema) and drops a marker on each answer.

// Tool entry point: maplibre owns its own subtree, so this renders into a plain
// container rather than through Solid. The viewport is split in two: a persisted
// "home" (center/zoom/bounds in the doc) that only manual pans/zooms write — and
// echo back to other peers — and a transient overlay the map eases around to
// frame markers / focused pins, which is never persisted and reverts when its
// reason clears. An epsilon guard on the persisted side breaks the write/read
// feedback loop.
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
  });

  // The map keeps two viewports apart: the *persisted* one (center/zoom/bounds
  // in the doc), which only a manual pan/zoom updates, and the *live* camera,
  // which the overlay (marker framing + focus) eases around transiently and
  // never persists. `overlayActive` is true whenever the live camera has been
  // moved away from the persisted "home" by the overlay.
  let overlayActive = false;

  const currentBounds = (): MapBounds => {
    const b = map.getBounds();
    return {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
  };

  // Persist the visible box as the home box. Only ever called while the camera
  // is at home (manual move, load, resize-at-home), so map-search consumers that
  // read doc.bounds see the manual view, never a transient overlay.
  const persistBounds = () => {
    const bounds = currentBounds();
    handle.change((doc) => {
      if (!boundsEqual(doc.bounds, bounds)) doc.bounds = bounds;
    });
  };

  // A user gesture (drag/scroll/touch) is the only thing that updates the
  // persisted viewport: those moveends carry an `originalEvent`, while our own
  // overlay eases and remote-change jumps do not. Taking manual control also
  // makes the current view the new home and cancels any overlay framing.
  const onMoveEnd = (event: { originalEvent?: unknown }) => {
    if (!event.originalEvent) return;
    overlayActive = false;
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
  // container, so seed the home box on load (center/zoom already match the doc).
  // Skip if an overlay has already moved the camera, so we never freeze a
  // widened frame as home.
  const onLoad = () => {
    if (!overlayActive) persistBounds();
  };
  map.on("load", onLoad);

  // Document -> map. Skip when the map is already there (e.g. our own write
  // coming back) to avoid interrupting an in-flight interaction. A genuine
  // remote viewport change becomes the new home, so re-derive the overlay.
  const onDocChange = () => {
    const doc = handle.doc();
    if (!doc) return;
    const { lng, lat } = map.getCenter();
    if (viewportsEqual(doc, [lng, lat], map.getZoom())) return;
    map.jumpTo({ center: doc.center, zoom: doc.zoom });
    scheduleApply();
  };
  handle.on("change", onDocChange);

  // maplibre only tracks window resizes; the embed is resized directly, so
  // observe the container and tell the map to re-measure. Resizing changes the
  // home box (center/zoom hold steady, so no moveend fires) — re-persist it,
  // debounced, but only while resting at home so an active overlay never leaks
  // its widened box into the persisted bounds.
  let resizeSyncTimer: ReturnType<typeof setTimeout> | undefined;
  const resizeObserver = new ResizeObserver(() => {
    map.resize();
    if (overlayActive) return;
    if (resizeSyncTimer) clearTimeout(resizeSyncTimer);
    resizeSyncTimer = setTimeout(persistBounds, 150);
  });
  resizeObserver.observe(container);

  // Consume schema matches: one marker per matched {lat, lon} location. Each
  // match url is a native automerge sub-url (`<docUrl>/seg/seg`); `repo.find`
  // resolves it straight to the matched subtree, so its `.doc()` is the
  // coordinate. Reconcile the marker set against the latest emission.
  const repo = element.repo;
  const markers = new Map<AutomergeUrl, maplibregl.Marker>();
  let epoch = 0;

  // Focus highlight, both directions. A marker glows while its card document is
  // in focus (the union of the `Selection` and `Highlight` context channels),
  // so focusing a mention token that points at a card lights up its pin.
  // Hovering a marker writes its document into our `Highlight` slice, so the
  // pointing token lights up too.
  let focusedDocIds = new Set<string>();
  let selectionUrls: Record<string, true> = {};
  let highlightUrls: Record<string, true> = {};
  // The highlight entry this map currently owns (the hovered marker's doc),
  // cleared on mouse-out or when the marker goes away.
  let hovered: AutomergeUrl | undefined;

  // Hover tooltip: a single reused popup that embeds a <patchwork-view> of the
  // hovered pin's document. The match url points at the {lat, lon} subtree,
  // which carries no @patchwork metadata, so we render the OWNING document and
  // let patchwork-view fall back to that type's tool. Reused (not one per
  // marker) so only the hovered card is ever mounted.
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    maxWidth: "none",
    offset: 18,
    className: "embark-map-popup",
  });
  let popupMatch: AutomergeUrl | undefined;
  let overPopup = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;

  const showPopup = (
    match: AutomergeUrl,
    coords: [number, number],
    docUrl: AutomergeUrl,
  ) => {
    if (hideTimer) clearTimeout(hideTimer);
    if (popupMatch !== match) {
      popupMatch = match;
      const body = document.createElement("div");
      body.className = "embark-map-popup__body";
      const view = document.createElement("patchwork-view");
      view.setAttribute("doc-url", docUrl);
      body.appendChild(view);
      // The pin's own mouseleave fires as the pointer crosses onto the popup,
      // so track hovering the popup itself to keep it open (and interactive).
      body.addEventListener("mouseenter", () => {
        overPopup = true;
        if (hideTimer) clearTimeout(hideTimer);
      });
      body.addEventListener("mouseleave", () => {
        overPopup = false;
        scheduleHidePopup();
      });
      popup.setDOMContent(body);
    }
    popup.setLngLat(coords).addTo(map);
  };

  // Close after a short grace period unless the pointer landed on the popup,
  // so moving from pin to popup (and back) doesn't make it flicker.
  const scheduleHidePopup = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (overPopup) return;
      popup.remove();
      popupMatch = undefined;
    }, 160);
  };

  // Close immediately for a specific match (e.g. its pin is being removed).
  const hidePopupFor = (match: AutomergeUrl) => {
    if (popupMatch !== match) return;
    if (hideTimer) clearTimeout(hideTimer);
    overPopup = false;
    popup.remove();
    popupMatch = undefined;
  };

  const styleMarker = (match: AutomergeUrl, marker: maplibregl.Marker) => {
    const focused = focusedDocIds.has(parseAutomergeUrl(match).documentId);
    marker.getElement().classList.toggle("embark-map-marker--focused", focused);
    return focused;
  };

  // --- Viewport overlay -----------------------------------------------------
  // Pixel gap we try to keep between a focused pin and its nearest neighbour,
  // and the zoom we refuse to exceed when prising apart (near-)coincident pins.
  const MIN_PIN_GAP_PX = 30;
  const MAX_FOCUS_ZOOM = 18;
  // maplibre renders 512px tiles, so a normalized-mercator distance d shows as
  // d * 512 * 2^zoom pixels on screen.
  const TILE_SIZE = 512;

  const homeView = (): { center: [number, number]; zoom: number } => {
    const doc = handle.doc();
    return {
      center: (doc?.center ?? DEFAULT_CENTER) as [number, number],
      zoom: doc?.zoom ?? DEFAULT_ZOOM,
    };
  };

  const homeBounds = (): maplibregl.LngLatBounds | undefined => {
    const b = handle.doc()?.bounds;
    if (!b) return undefined;
    return new maplibregl.LngLatBounds([b.west, b.south], [b.east, b.north]);
  };

  const markerPositions = (): maplibregl.LngLat[] =>
    [...markers.values()].map((marker) => marker.getLngLat());

  // The resting frame: home, widened just enough to also show any markers that
  // fall outside the home box (never tighter than the home zoom). `widened` is
  // false when home already contains every marker — then we rest exactly at
  // home, which is also what we return to as markers are removed.
  const baseCamera = (): {
    center: maplibregl.LngLat;
    zoom: number;
    widened: boolean;
  } => {
    const home = homeView();
    const homeCenter = new maplibregl.LngLat(home.center[0], home.center[1]);
    const positions = markerPositions();
    const box = homeBounds();
    const outside = box ? positions.filter((p) => !box.contains(p)) : positions;
    if (positions.length === 0 || outside.length === 0) {
      return { center: homeCenter, zoom: home.zoom, widened: false };
    }
    const union = box
      ? new maplibregl.LngLatBounds(box.getSouthWest(), box.getNorthEast())
      : new maplibregl.LngLatBounds(positions[0], positions[0]);
    for (const p of positions) union.extend(p);
    const cam = map.cameraForBounds(union, { padding: 64, maxZoom: home.zoom });
    if (!cam?.center || cam.zoom === undefined) {
      return { center: homeCenter, zoom: home.zoom, widened: false };
    }
    return {
      center: maplibregl.LngLat.convert(cam.center),
      zoom: cam.zoom,
      widened: true,
    };
  };

  // Normalized-mercator distance, so a pixel gap can be derived at any zoom.
  const mercatorDistance = (
    a: maplibregl.LngLat,
    b: maplibregl.LngLat,
  ): number => {
    const ma = maplibregl.MercatorCoordinate.fromLngLat(a);
    const mb = maplibregl.MercatorCoordinate.fromLngLat(b);
    return Math.hypot(ma.x - mb.x, ma.y - mb.y);
  };

  // The absolute zoom at which two points sit MIN_PIN_GAP_PX apart on screen.
  const separationZoom = (mercDist: number): number => {
    if (mercDist <= 0) return MAX_FOCUS_ZOOM;
    return Math.log2(MIN_PIN_GAP_PX / (TILE_SIZE * mercDist));
  };

  // If a focused pin would be crowded (< MIN_PIN_GAP_PX from its nearest
  // neighbour) at the base zoom, zoom in on the tightest such pin until it
  // clears. Returns null when nothing focused is crowded (rest at the base).
  const focusCamera = (
    baseZoom: number,
  ): { center: maplibregl.LngLat; zoom: number } | null => {
    const entries = [...markers.entries()].map(([match, marker]) => ({
      match,
      pos: marker.getLngLat(),
    }));
    if (entries.length < 2) return null;
    let best: { center: maplibregl.LngLat; zoom: number } | null = null;
    for (const focused of entries) {
      if (!focusedDocIds.has(parseAutomergeUrl(focused.match).documentId)) {
        continue;
      }
      let nearest = Infinity;
      for (const other of entries) {
        if (other.match === focused.match) continue;
        nearest = Math.min(nearest, mercatorDistance(focused.pos, other.pos));
      }
      if (nearest === Infinity) continue;
      const needed = separationZoom(nearest);
      if (best === null || needed > best.zoom) {
        best = { center: focused.pos, zoom: needed };
      }
    }
    if (best === null || best.zoom <= baseZoom + ZOOM_EPSILON) return null;
    return { center: best.center, zoom: Math.min(best.zoom, MAX_FOCUS_ZOOM) };
  };

  const cameraEquals = (center: maplibregl.LngLat, zoom: number): boolean => {
    const c = map.getCenter();
    return (
      Math.abs(c.lng - center.lng) < COORD_EPSILON &&
      Math.abs(c.lat - center.lat) < COORD_EPSILON &&
      Math.abs(map.getZoom() - zoom) < ZOOM_EPSILON
    );
  };

  // Recompute and ease to the overlay target: the base frame, possibly
  // overridden by a focus zoom-in. Always programmatic, so it never persists —
  // only the manual-move handler writes the doc.
  const applyViewport = () => {
    const base = baseCamera();
    const focus = focusCamera(base.zoom);
    const target = focus ?? base;
    overlayActive = focus !== null || base.widened;
    if (cameraEquals(target.center, target.zoom)) return;
    map.easeTo({ center: target.center, zoom: target.zoom, duration: 600 });
  };

  // Marker arrivals are async and focus/marker changes can burst, so coalesce.
  let applyTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleApply = () => {
    if (applyTimer) clearTimeout(applyTimer);
    applyTimer = setTimeout(() => {
      applyTimer = undefined;
      applyViewport();
    }, 120);
  };

  // The map's own scoped slice of the Highlight channel (just the hovered pin's
  // document). Because each writer owns its slice, this is a plain key add/
  // delete — other writers' highlights live in their own slices and merge in.
  const highlightHandle = getContextHandle(element, Highlight);
  const writeHighlight = (
    remove: AutomergeUrl | undefined,
    add: AutomergeUrl | undefined,
  ) => {
    if (remove === add) return;
    highlightHandle?.change((slice) => {
      const entries = slice as Record<string, true>;
      if (remove) delete entries[remove];
      if (add) entries[add] = true;
    });
  };

  const setHovered = (url: AutomergeUrl) => {
    if (hovered === url) return;
    const previous = hovered;
    hovered = url;
    writeHighlight(previous, url);
  };

  const clearHovered = (url: AutomergeUrl) => {
    if (hovered !== url) return;
    hovered = undefined;
    writeHighlight(url, undefined);
  };

  const recomputeFocus = () => {
    const ids = new Set<string>();
    for (const url of [
      ...Object.keys(selectionUrls),
      ...Object.keys(highlightUrls),
    ]) {
      if (isValidAutomergeUrl(url)) ids.add(parseAutomergeUrl(url).documentId);
    }
    focusedDocIds = ids;
    for (const [match, marker] of markers) styleMarker(match, marker);
    // A focus change can crowd/uncrowd a pin, so re-derive the overlay (zoom in
    // on a crowded focused pin, or fall back to the base frame when it clears).
    scheduleApply();
  };

  // Focus is read from the union of the Selection and Highlight channels.
  const unsubscribeSelection = subscribeContext(element, Selection, (all) => {
    selectionUrls = all;
    recomputeFocus();
  });
  const unsubscribeHighlight = subscribeContext(element, Highlight, (all) => {
    highlightUrls = all;
    recomputeFocus();
  });

  const addMarker = async (match: AutomergeUrl, generation: number) => {
    try {
      const docHandle = await Promise.resolve(repo.find<unknown>(match));
      if (generation !== epoch || markers.has(match)) return;
      const coords = toLngLat(docHandle.doc());
      if (!coords) return;
      const marker = new maplibregl.Marker({ color: MARKER_COLOR }).setLngLat(
        coords,
      );
      const docUrl = `automerge:${docHandle.documentId}` as AutomergeUrl;
      // Hovering the pin focuses its card document, lighting up any mention
      // token that points at it. `docUrl` is stashed on the element so we can
      // release the highlight if the marker is removed while still hovered.
      const markerEl = marker.getElement();
      markerEl.classList.add("embark-map-marker");
      markerEl.dataset.docUrl = docUrl;
      markerEl.addEventListener("mouseenter", () => {
        setHovered(docUrl);
        showPopup(match, coords, docUrl);
      });
      markerEl.addEventListener("mouseleave", () => {
        clearHovered(docUrl);
        scheduleHidePopup();
      });
      marker.addTo(map);
      markers.set(match, marker);
      styleMarker(match, marker);
      // A new pin may push the frame open (to reveal it) or, if its doc is
      // already focused, warrant a focus zoom-in — let the overlay decide.
      scheduleApply();
    } catch {
      // ignore docs that fail to load
    }
  };

  const onMatches = (matches: AutomergeUrl[]) => {
    const generation = ++epoch;
    const wanted = new Set(matches);
    for (const [match, marker] of markers) {
      if (wanted.has(match)) continue;
      const docUrl = marker.getElement().dataset.docUrl as
        | AutomergeUrl
        | undefined;
      if (docUrl) clearHovered(docUrl);
      hidePopupFor(match);
      marker.remove();
      markers.delete(match);
    }
    for (const match of matches) {
      if (!markers.has(match)) void addMarker(match, generation);
    }
    // Each addMarker also schedules, but removals need their own nudge so the
    // frame can shrink back toward home once a pin disappears.
    scheduleApply();
  };

  // Publish the {lat, lon} schema query and consume its matches.
  const schemaQueries = getContextHandle(element, SchemaQueries);
  schemaQueries?.change((slice) => {
    slice[LATLNG_KEY] = LATLNG_QUERY;
  });
  const unsubscribeMatches = subscribeContext(element, SchemaMatches, (all) => {
    onMatches(all[LATLNG_KEY] ?? []);
  });

  return () => {
    unsubscribeMatches();
    schemaQueries?.release();
    unsubscribeSelection();
    unsubscribeHighlight();
    highlightHandle?.release();
    if (hideTimer) clearTimeout(hideTimer);
    if (applyTimer) clearTimeout(applyTimer);
    popup.remove();
    for (const marker of markers.values()) marker.remove();
    markers.clear();
    if (resizeSyncTimer) clearTimeout(resizeSyncTimer);
    resizeObserver.disconnect();
    handle.off("change", onDocChange);
    map.off("moveend", onMoveEnd);
    map.off("load", onLoad);
    map.remove();
    container.remove();
  };
};

// Read a [lng, lat] tuple from a matched node shaped like `{ lat, lon }`.
function toLngLat(node: unknown): [number, number] | null {
  if (node === null || typeof node !== "object") return null;
  const record = node as Record<string, unknown>;
  const { lat, lon } = record;
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  return [lon, lat];
}

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
