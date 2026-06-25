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
// container rather than through Solid. The map's viewport is mirrored to the
// document — local pans/zooms write to the doc, remote edits move the map — with
// an epsilon guard on both sides to break the write/read feedback loop.
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

  // Local pan/zoom -> document. Center/zoom are only written when the viewport
  // actually moved away from what's stored, so applying a remote change doesn't
  // echo back. `bounds` is derived (nothing writes it back into the map), so it
  // just tracks the visible box whenever it changes — including on resize, where
  // center/zoom hold steady but the box doesn't.
  const currentBounds = (): MapBounds => {
    const b = map.getBounds();
    return {
      west: b.getWest(),
      south: b.getSouth(),
      east: b.getEast(),
      north: b.getNorth(),
    };
  };

  const syncViewport = () => {
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
  map.on("moveend", syncViewport);
  // The first accurate bounds are only available once the map has measured its
  // container, so seed them on load too (center/zoom already match the doc).
  map.on("load", syncViewport);

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

  // maplibre only tracks window resizes; the embed is resized directly, so
  // observe the container and tell the map to re-measure. Resizing changes the
  // visible box (but not center/zoom, so no moveend fires) — re-sync the bounds,
  // debounced so a drag-resize doesn't spam the doc.
  let resizeSyncTimer: ReturnType<typeof setTimeout> | undefined;
  const resizeObserver = new ResizeObserver(() => {
    map.resize();
    if (resizeSyncTimer) clearTimeout(resizeSyncTimer);
    resizeSyncTimer = setTimeout(syncViewport, 150);
  });
  resizeObserver.observe(container);

  // Consume schema matches: one marker per matched {lat, lon} location. Each
  // match url is a native automerge sub-url (`<docUrl>/seg/seg`); `repo.find`
  // resolves it straight to the matched subtree, so its `.doc()` is the
  // coordinate. Reconcile the marker set against the latest emission.
  const repo = element.repo;
  const markers = new Map<AutomergeUrl, maplibregl.Marker>();
  let epoch = 0;
  // Whether we've adopted an initial set of markers as the baseline. The first
  // batch (e.g. pins restored on open) keeps the document's saved viewport;
  // markers that appear *after* that zoom the map out to come into view.
  let seeded = false;

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
  // Matches whose pin was focused as of the last recompute, so we can detect
  // which ones *just* became focused and pan only those into view.
  let focusedMatches = new Set<AutomergeUrl>();

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

  // Bring freshly-focused pins into view. Already-visible pins are left alone
  // (so hovering a pin that's on screen never yanks the map), and a single
  // off-screen pin is gently panned to while a cluster is framed together.
  const panMatchesIntoView = (matches: AutomergeUrl[]) => {
    const offscreen = matches
      .map((match) => markers.get(match)?.getLngLat())
      .filter(
        (p): p is maplibregl.LngLat => !!p && !map.getBounds().contains(p),
      );
    if (offscreen.length === 0) return;
    if (offscreen.length === 1) {
      map.easeTo({ center: offscreen[0], duration: 600 });
      return;
    }
    const bounds = offscreen.reduce(
      (acc, p) => acc.extend(p),
      new maplibregl.LngLatBounds(offscreen[0], offscreen[0]),
    );
    map.fitBounds(bounds, {
      padding: 64,
      maxZoom: map.getZoom(),
      duration: 600,
    });
  };

  // Bring genuinely new markers into view by zooming the map out. Batched so a
  // burst of new pins eases once, and a no-op when every new pin is already on
  // screen, so it never fights the user's current view.
  let pendingFit: maplibregl.LngLat[] = [];
  let fitTimer: ReturnType<typeof setTimeout> | undefined;

  const scheduleFit = (position: maplibregl.LngLat) => {
    pendingFit.push(position);
    if (fitTimer) clearTimeout(fitTimer);
    fitTimer = setTimeout(flushFit, 120);
  };

  const flushFit = () => {
    fitTimer = undefined;
    const positions = pendingFit;
    pendingFit = [];
    const view = map.getBounds();
    if (positions.length === 0 || positions.every((p) => view.contains(p))) {
      return;
    }
    // Extend the *current* view so existing pins stay framed; because the box
    // only grows, fitBounds can only zoom out (or hold).
    const bounds = new maplibregl.LngLatBounds(
      view.getSouthWest(),
      view.getNorthEast(),
    );
    for (const position of positions) bounds.extend(position);
    map.fitBounds(bounds, { padding: 64, maxZoom: map.getZoom(), duration: 600 });
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
    const nowFocused = new Set<AutomergeUrl>();
    for (const [match, marker] of markers) {
      if (styleMarker(match, marker)) nowFocused.add(match);
    }
    const appeared = [...nowFocused].filter((m) => !focusedMatches.has(m));
    focusedMatches = nowFocused;
    if (appeared.length) panMatchesIntoView(appeared);
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

  const addMarker = async (
    match: AutomergeUrl,
    generation: number,
    fitNew: boolean,
  ) => {
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
      // A pin can resolve after its doc is already focused (async find); treat
      // that as a fresh appearance so it still pans into view. The focus pan
      // already brings it on screen, so only the unfocused case needs the fit.
      if (styleMarker(match, marker) && !focusedMatches.has(match)) {
        focusedMatches.add(match);
        panMatchesIntoView([match]);
      } else if (fitNew) {
        scheduleFit(marker.getLngLat());
      }
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
      focusedMatches.delete(match);
    }
    // Only zoom out for markers added after the baseline set; the first batch
    // adopts the document's saved viewport as-is.
    const fitNew = seeded;
    for (const match of matches) {
      if (!markers.has(match)) void addMarker(match, generation, fitNew);
    }
    if (matches.length > 0) seeded = true;
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
    if (fitTimer) clearTimeout(fitTimer);
    popup.remove();
    for (const marker of markers.values()) marker.remove();
    markers.clear();
    if (resizeSyncTimer) clearTimeout(resizeSyncTimer);
    resizeObserver.disconnect();
    handle.off("change", onDocChange);
    map.off("moveend", syncViewport);
    map.off("load", syncViewport);
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
