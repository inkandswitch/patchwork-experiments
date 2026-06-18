import {
  isValidAutomergeUrl,
  parseAutomergeUrl,
  type AutomergeUrl,
  type DocHandle,
} from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { z } from "zod";
import { coreSubscribe, type JSONValue } from "../lib/providers-solid";
import { MATCHES_SELECTOR } from "../canvas/providers/SchemaMatchProvider";
import { DEFAULT_CENTER, DEFAULT_ZOOM, type MapDoc } from "./datatype";
import "./map.css";

// The shared focus store keyed by url (see providers' FocusProvider). The map
// lights up a marker when its card document appears in selection ∪ highlight.
type FocusDoc = {
  selection: Record<AutomergeUrl, true>;
  highlight: Record<AutomergeUrl, true>;
};

// openfreemap's hosted Liberty style — no API key required.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
// Pins are blue; CSS intensifies/glows them while focused (see map.css).
const MARKER_COLOR = "#3b82f6";
// Floating-point slack so a viewport we just wrote (then read straight back)
// doesn't count as a change and bounce between map and doc forever.
const COORD_EPSILON = 1e-6;
const ZOOM_EPSILON = 1e-3;

// The map asks the canvas "where, in any mounted document, is a {lat, lon}
// pair?" and drops a marker on each answer. The schema travels as JSON Schema
// (the only thing a selector can carry); the provider hydrates it back to zod.
const LATLNG_JSON_SCHEMA = z.toJSONSchema(
  z.object({ lat: z.number(), lon: z.number() }),
) as unknown as JSONValue;

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

  // Local pan/zoom -> document. Only write when the viewport actually moved
  // away from what's stored, so applying a remote change doesn't echo back.
  const onMoveEnd = () => {
    const { lng, lat } = map.getCenter();
    const zoom = map.getZoom();
    handle.change((doc) => {
      if (!viewportsEqual(doc, [lng, lat], zoom)) {
        doc.center = [lng, lat];
        doc.zoom = zoom;
      }
    });
  };
  map.on("moveend", onMoveEnd);

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
  // observe the container and tell the map to re-measure.
  const resizeObserver = new ResizeObserver(() => map.resize());
  resizeObserver.observe(container);

  // Consume schema matches: one marker per matched {lat, lon} location. Each
  // match url is a native automerge sub-url (`<docUrl>/seg/seg`); `repo.find`
  // resolves it straight to the matched subtree, so its `.doc()` is the
  // coordinate. Reconcile the marker set against the latest emission.
  const repo = element.repo;
  const markers = new Map<AutomergeUrl, maplibregl.Marker>();
  let epoch = 0;

  // Focus highlight, both directions. A marker glows while its card document is
  // in focus (selection ∪ highlight in the shared focus store), so focusing a
  // mention token that points at a card lights up its pin. Hovering a marker
  // writes its document into `highlight`, so the pointing token lights up too.
  let focusedDocIds = new Set<string>();
  let focusHandle: DocHandle<FocusDoc> | undefined;
  let onFocusChange: (() => void) | undefined;
  // The highlight entry this map currently owns (the hovered marker's doc),
  // cleared on mouse-out or when the marker goes away.
  let hovered: AutomergeUrl | undefined;
  // Matches whose pin was focused as of the last recompute, so we can detect
  // which ones *just* became focused and pan only those into view.
  let focusedMatches = new Set<AutomergeUrl>();

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
      .filter((p): p is maplibregl.LngLat => !!p && !map.getBounds().contains(p));
    if (offscreen.length === 0) return;
    if (offscreen.length === 1) {
      map.easeTo({ center: offscreen[0], duration: 600 });
      return;
    }
    const bounds = offscreen.reduce(
      (acc, p) => acc.extend(p),
      new maplibregl.LngLatBounds(offscreen[0], offscreen[0]),
    );
    map.fitBounds(bounds, { padding: 64, maxZoom: map.getZoom(), duration: 600 });
  };

  // Swap this map's owned highlight entry by reassigning the whole map (a
  // `put`) rather than deleting a key in place — the host editor projects this
  // doc via a reconciler that throws on map-key `del` patches. Other writers'
  // entries are preserved, so the editor's own highlight survives.
  const writeHighlight = (
    remove: AutomergeUrl | undefined,
    add: AutomergeUrl | undefined,
  ) => {
    if (remove === add) return;
    focusHandle?.change((doc) => {
      const next: Record<AutomergeUrl, true> = {};
      for (const url of Object.keys(doc.highlight ?? {}) as AutomergeUrl[]) {
        if (url !== remove) next[url] = true;
      }
      if (add) next[add] = true;
      doc.highlight = next;
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
    const doc = focusHandle?.doc();
    const ids = new Set<string>();
    if (doc) {
      const urls = [
        ...Object.keys(doc.selection ?? {}),
        ...Object.keys(doc.highlight ?? {}),
      ];
      for (const url of urls) {
        if (isValidAutomergeUrl(url)) ids.add(parseAutomergeUrl(url).documentId);
      }
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

  const unsubscribeFocus = coreSubscribe<AutomergeUrl>(
    element,
    { type: "patchwork:focus" },
    (url) => {
      if (focusHandle || !url) return;
      void Promise.resolve(repo.find<FocusDoc>(url)).then((found) => {
        focusHandle = found;
        onFocusChange = () => recomputeFocus();
        found.on("change", onFocusChange);
        recomputeFocus();
      });
    },
  );

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
      markerEl.addEventListener("mouseenter", () => setHovered(docUrl));
      markerEl.addEventListener("mouseleave", () => clearHovered(docUrl));
      marker.addTo(map);
      markers.set(match, marker);
      // A pin can resolve after its doc is already focused (async find); treat
      // that as a fresh appearance so it still pans into view.
      if (styleMarker(match, marker) && !focusedMatches.has(match)) {
        focusedMatches.add(match);
        panMatchesIntoView([match]);
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
      marker.remove();
      markers.delete(match);
      focusedMatches.delete(match);
    }
    for (const match of matches) {
      if (!markers.has(match)) void addMarker(match, generation);
    }
  };

  const unsubscribe = coreSubscribe<AutomergeUrl[]>(
    element,
    { type: MATCHES_SELECTOR, schema: LATLNG_JSON_SCHEMA },
    onMatches,
  );

  return () => {
    unsubscribe();
    unsubscribeFocus();
    if (hovered) writeHighlight(hovered, undefined);
    if (focusHandle && onFocusChange) focusHandle.off("change", onFocusChange);
    for (const marker of markers.values()) marker.remove();
    markers.clear();
    resizeObserver.disconnect();
    handle.off("change", onDocChange);
    map.off("moveend", onMoveEnd);
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
