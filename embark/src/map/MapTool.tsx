import type { AutomergeUrl, DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { z } from "zod";
import { coreSubscribe, type JSONValue } from "../lib/providers-solid";
import { parseMatchUrl, resolvePointer } from "../lib/match-url";
import { MATCHES_SELECTOR } from "../canvas/providers/SchemaMatchProvider";
import { DEFAULT_CENTER, DEFAULT_ZOOM, type MapDoc } from "./datatype";
import "./map.css";

// openfreemap's hosted Liberty style — no API key required.
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
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
  // match url is `<docUrl>#<jsonPointer>`; resolve it, read the coordinate, and
  // reconcile the marker set against the latest emission.
  const repo = element.repo;
  const markers = new Map<AutomergeUrl, maplibregl.Marker>();
  let epoch = 0;

  const addMarker = async (match: AutomergeUrl, generation: number) => {
    const { url, pointer } = parseMatchUrl(match);
    try {
      const docHandle = await Promise.resolve(repo.find<unknown>(url));
      if (generation !== epoch || markers.has(match)) return;
      const coords = toLngLat(resolvePointer(docHandle.doc(), pointer));
      if (!coords) return;
      const marker = new maplibregl.Marker().setLngLat(coords);
      const content = cardContent(docHandle.doc());
      if (content) {
        marker.setPopup(new maplibregl.Popup({ offset: 24 }).setText(content));
      }
      marker.addTo(map);
      markers.set(match, marker);
    } catch {
      // ignore docs that fail to load
    }
  };

  const onMatches = (matches: AutomergeUrl[]) => {
    const generation = ++epoch;
    const wanted = new Set(matches);
    for (const [match, marker] of markers) {
      if (wanted.has(match)) continue;
      marker.remove();
      markers.delete(match);
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

// A card's `content` string, for the marker popup.
function cardContent(doc: unknown): string | undefined {
  if (doc === null || typeof doc !== "object") return undefined;
  const content = (doc as Record<string, unknown>).content;
  return typeof content === "string" && content ? content : undefined;
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
