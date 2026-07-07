import { parseAutomergeUrl, type AutomergeUrl, type DocHandle } from "@automerge/automerge-repo";
import type maplibregl from "maplibre-gl";
import { subscribeContext } from "@embark/context";
import { Highlight, Selection } from "@embark/selection";
import { GeoShapes, type GeoShape } from "@embark/geo-shapes";
import type { MapExtension } from "@embark/map-extensions-host";

// Floating-point slack so a camera we just eased to (then read straight back)
// doesn't count as a difference.
const COORD_EPSILON = 1e-6;
const ZOOM_EPSILON = 1e-3;
// Pixel gap we try to keep between a focused pin and its nearest neighbour,
// and the zoom we refuse to exceed when prising apart (near-)coincident pins.
const MIN_PIN_GAP_PX = 30;
const MAX_FOCUS_ZOOM = 18;
// maplibre renders 512px tiles, so a normalized-mercator distance d shows as
// d * 512 * 2^zoom pixels on screen.
const TILE_SIZE = 512;
// Camera moves are eased, and bursts of shape/focus changes are coalesced.
const EASE_MS = 600;
const APPLY_DEBOUNCE_MS = 120;

// The camera this card returns to when the overlay clears: the view the map
// was resting at before the card's first programmatic move. Persisted on the
// card's own document — never the map's — so removing the card leaves the map
// document exactly as the user's manual moves wrote it.
export type SavedHome = {
  center: [number, number];
  zoom: number;
  bounds: { west: number; south: number; east: number; north: number };
};

export type GeoZoomState = { home?: SavedHome };

type Camera = { center: [number, number]; zoom: number };

// The zooming behavior as a map extension: watches the `GeoShapes` channel and
// the focus union (Selection ∪ Highlight) and eases the camera to frame what
// matters. Precedence: a focused line (frame the whole geometry, plus focused
// pins of the same documents) > a crowded focused pin (zoom in until it clears
// its neighbours) > the base frame (home, widened just enough to reveal any
// shapes outside it).
//
// Home handling: before the first programmatic move the current camera (and
// its visible box) is snapshotted into the card document; when the overlay's
// reason clears, the camera eases back there and the snapshot is dropped. Any
// move this extension didn't make — a manual pan/zoom, the search panel easing
// to a picked place, a remote viewport change — adopts the new camera as home,
// so the overlay always returns to wherever the camera was last put on
// purpose.
export const geoZoomExtension =
  (handle: DocHandle<GeoZoomState>): MapExtension =>
  (element, map) => {
    // --- Shape / focus bookkeeping ------------------------------------------
    // Marker positions (for crowding), line coordinates per document (for
    // focus framing), and every coordinate (for base widening).
    let markerEntries: Array<{ pos: [number, number]; docId: string }> = [];
    let lineCoordsByDoc = new Map<string, Array<[number, number]>>();
    let allPositions: Array<[number, number]> = [];
    let focusedDocIds = new Set<string>();
    let selectionUrls: Record<string, true> = {};
    let highlightUrls: Record<string, true> = {};

    // True while the pointer is inside the map: automatic camera moves are
    // paused so a hover never yanks the view; pointerleave catches up.
    let pointerOver = false;
    // Count of eases we started whose moveend hasn't arrived yet, so the
    // moveend handler can tell our moves from manual/external ones.
    let ownEases = 0;

    const savedHome = (): SavedHome | undefined => handle.doc()?.home;

    const clearHome = () => {
      if (!savedHome()) return;
      handle.change((doc) => {
        delete doc.home;
      });
    };

    // Snapshot the current camera as home before the overlay's first move.
    // Never while mid-animation — the caller defers until the camera rests.
    const saveHome = () => {
      const { lng, lat } = map.getCenter();
      const zoom = map.getZoom();
      const b = map.getBounds();
      handle.change((doc) => {
        doc.home = {
          center: [lng, lat],
          zoom,
          bounds: {
            west: b.getWest(),
            south: b.getSouth(),
            east: b.getEast(),
            north: b.getNorth(),
          },
        };
      });
    };

    const homeCamera = (): { camera: Camera; bounds?: SavedHome["bounds"] } => {
      const home = savedHome();
      if (home) {
        return {
          camera: { center: [...home.center] as [number, number], zoom: home.zoom },
          bounds: home.bounds,
        };
      }
      const { lng, lat } = map.getCenter();
      const b = map.getBounds();
      return {
        camera: { center: [lng, lat], zoom: map.getZoom() },
        bounds: {
          west: b.getWest(),
          south: b.getSouth(),
          east: b.getEast(),
          north: b.getNorth(),
        },
      };
    };

    const cameraEquals = (camera: Camera): boolean => {
      const c = map.getCenter();
      return (
        Math.abs(c.lng - camera.center[0]) < COORD_EPSILON &&
        Math.abs(c.lat - camera.center[1]) < COORD_EPSILON &&
        Math.abs(map.getZoom() - camera.zoom) < ZOOM_EPSILON
      );
    };

    // --- Frame derivation ----------------------------------------------------
    // When a line's document is focused, the whole geometry is framed
    // (together with any focused markers of the same documents). Returns the
    // bounds to fit, or null when nothing line-shaped is focused — then point
    // crowding and the base frame take over.
    const focusBounds = (): [[number, number], [number, number]] | null => {
      const points: Array<[number, number]> = [];
      for (const [docId, coords] of lineCoordsByDoc) {
        if (!focusedDocIds.has(docId)) continue;
        points.push(...coords);
      }
      if (points.length === 0) return null;
      for (const entry of markerEntries) {
        if (focusedDocIds.has(entry.docId)) points.push(entry.pos);
      }
      return boundsOf(points);
    };

    // If a focused pin would be crowded (< MIN_PIN_GAP_PX from its nearest
    // neighbour) at the base zoom, zoom in on the tightest such pin until it
    // clears. Returns null when nothing focused is crowded (rest at the base).
    const focusCamera = (baseZoom: number): Camera | null => {
      if (markerEntries.length < 2) return null;
      let best: Camera | null = null;
      for (const focused of markerEntries) {
        if (!focusedDocIds.has(focused.docId)) continue;
        let nearest = Infinity;
        for (const other of markerEntries) {
          if (other === focused) continue;
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

    // The resting frame: home, widened just enough to also show any shapes
    // that fall outside the home box (never tighter than the home zoom).
    const baseCamera = (): { camera: Camera; widened: boolean } => {
      const home = homeCamera();
      if (allPositions.length === 0) {
        return { camera: home.camera, widened: false };
      }
      const box = home.bounds;
      const outside = box
        ? allPositions.filter(
            ([lng, lat]) =>
              lng < box.west || lng > box.east || lat < box.south || lat > box.north,
          )
        : allPositions;
      if (outside.length === 0) return { camera: home.camera, widened: false };
      const corners: Array<[number, number]> = box
        ? [
            [box.west, box.south],
            [box.east, box.north],
          ]
        : [];
      const union = boundsOf([...corners, ...allPositions]);
      const cam = map.cameraForBounds(union, {
        padding: 64,
        maxZoom: home.camera.zoom,
      });
      const camera = toCamera(cam);
      if (!camera) return { camera: home.camera, widened: false };
      return { camera, widened: true };
    };

    // --- Applying the frame ----------------------------------------------------
    const ease = (camera: Camera) => {
      ownEases++;
      map.easeTo({ center: camera.center, zoom: camera.zoom, duration: EASE_MS });
    };

    const applyViewport = () => {
      // While the pointer is over the map the user is reading/interacting, so
      // an automatic camera move would yank the view out from under them.
      if (pointerOver) return;
      // Mid-animation the camera is nowhere meaningful to snapshot; wait for
      // the moveend (which reschedules via the handlers below if needed).
      if (map.isMoving()) {
        scheduleApply();
        return;
      }

      const fit = focusBounds();
      let target: Camera | undefined;
      let overlaid = false;
      if (fit) {
        const cam = toCamera(
          map.cameraForBounds(fit, { padding: 80, maxZoom: MAX_FOCUS_ZOOM }),
        );
        if (cam) {
          target = { center: cam.center, zoom: Math.min(cam.zoom, MAX_FOCUS_ZOOM) };
          overlaid = true;
        }
      }
      if (!target) {
        const base = baseCamera();
        const focus = focusCamera(base.camera.zoom);
        target = focus ?? base.camera;
        overlaid = focus !== null || base.widened;
      }
      if (cameraEquals(target)) return;
      // Moving away from home for the overlay's sake: remember where home is
      // first, so the camera can come back when the reason clears.
      if (overlaid && !savedHome()) saveHome();
      ease(target);
    };

    // Shape arrivals and focus changes can burst, so coalesce.
    let applyTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleApply = () => {
      if (applyTimer) clearTimeout(applyTimer);
      applyTimer = setTimeout(() => {
        applyTimer = undefined;
        applyViewport();
      }, APPLY_DEBOUNCE_MS);
    };

    // --- Camera ownership --------------------------------------------------------
    // Manual gestures carry an `originalEvent`; our own eases are counted; any
    // other programmatic move (the search panel, a remote viewport change
    // jumping the map) means someone else put the camera somewhere on purpose
    // — adopt it as the new home so the overlay returns there, not to a stale
    // snapshot.
    const onMoveEnd = (event: { originalEvent?: unknown }) => {
      if (event.originalEvent) {
        ownEases = 0;
        clearHome();
        return;
      }
      if (ownEases > 0) {
        ownEases--;
        // Arrived back at the saved home: the overlay is over.
        const home = savedHome();
        if (home && cameraEquals({ center: home.center, zoom: home.zoom })) {
          clearHome();
        }
        return;
      }
      clearHome();
    };
    map.on("moveend", onMoveEnd);

    // Pause automatic moves while the pointer is over the map, then catch up
    // once it leaves (shapes/focus may have changed while suppressed).
    const canvasContainer = map.getCanvasContainer();
    const onPointerEnter = () => {
      pointerOver = true;
    };
    const onPointerLeave = () => {
      pointerOver = false;
      scheduleApply();
    };
    canvasContainer.addEventListener("pointerenter", onPointerEnter);
    canvasContainer.addEventListener("pointerleave", onPointerLeave);

    // --- Inputs ---------------------------------------------------------------
    const onShapes = (all: Record<AutomergeUrl, GeoShape[]>) => {
      const markers: typeof markerEntries = [];
      const byDoc = new Map<string, Array<[number, number]>>();
      const positions: Array<[number, number]> = [];
      for (const [docUrl, shapes] of Object.entries(all) as Array<
        [AutomergeUrl, GeoShape[]]
      >) {
        const docId = parseAutomergeUrl(docUrl).documentId;
        for (const shape of shapes) {
          if (shape.type === "marker") {
            const pos: [number, number] = [shape.at.lon, shape.at.lat];
            markers.push({ pos, docId });
            positions.push(pos);
          } else {
            const coords = shape.points.map(
              (p): [number, number] => [p.lon, p.lat],
            );
            const list = byDoc.get(docId) ?? [];
            list.push(...coords);
            byDoc.set(docId, list);
            positions.push(...coords);
          }
        }
      }
      markerEntries = markers;
      lineCoordsByDoc = byDoc;
      allPositions = positions;
      scheduleApply();
    };

    const recomputeFocus = () => {
      const ids = new Set<string>();
      for (const url of [
        ...Object.keys(selectionUrls),
        ...Object.keys(highlightUrls),
      ]) {
        try {
          ids.add(parseAutomergeUrl(url as AutomergeUrl).documentId);
        } catch {
          // not a doc url; ignore
        }
      }
      focusedDocIds = ids;
      scheduleApply();
    };

    const unsubscribeShapes = subscribeContext(element, GeoShapes, onShapes);
    const unsubscribeSelection = subscribeContext(element, Selection, (all) => {
      selectionUrls = all;
      recomputeFocus();
    });
    const unsubscribeHighlight = subscribeContext(element, Highlight, (all) => {
      highlightUrls = all;
      recomputeFocus();
    });

    return () => {
      unsubscribeShapes();
      unsubscribeSelection();
      unsubscribeHighlight();
      if (applyTimer) clearTimeout(applyTimer);
      map.off("moveend", onMoveEnd);
      canvasContainer.removeEventListener("pointerenter", onPointerEnter);
      canvasContainer.removeEventListener("pointerleave", onPointerLeave);
    };
  };

// Axis-aligned bounds of a non-empty point list, as the [[west, south],
// [east, north]] shape `cameraForBounds` accepts.
function boundsOf(
  points: Array<[number, number]>,
): [[number, number], [number, number]] {
  let west = points[0][0];
  let east = points[0][0];
  let south = points[0][1];
  let north = points[0][1];
  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [
    [west, south],
    [east, north],
  ];
}

// Normalize `cameraForBounds`' result (center is a LngLat-like) to a Camera.
function toCamera(
  cam: { center?: unknown; zoom?: number } | undefined,
): Camera | null {
  if (!cam || cam.zoom === undefined) return null;
  const center = cam.center as
    | { lng: number; lat: number }
    | [number, number]
    | undefined;
  if (!center) return null;
  if (Array.isArray(center)) return { center, zoom: cam.zoom };
  if (typeof center.lng === "number" && typeof center.lat === "number") {
    return { center: [center.lng, center.lat], zoom: cam.zoom };
  }
  return null;
}

// Normalized web-mercator distance (the same projection maplibre's
// MercatorCoordinate uses), so a pixel gap can be derived at any zoom without
// depending on the map's copy of the library.
function mercatorDistance(a: [number, number], b: [number, number]): number {
  return Math.hypot(mercX(a[0]) - mercX(b[0]), mercY(a[1]) - mercY(b[1]));
}

function mercX(lng: number): number {
  return lng / 360 + 0.5;
}

function mercY(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

// The absolute zoom at which two points sit MIN_PIN_GAP_PX apart on screen.
function separationZoom(mercDist: number): number {
  if (mercDist <= 0) return MAX_FOCUS_ZOOM;
  return Math.log2(MIN_PIN_GAP_PX / (TILE_SIZE * mercDist));
}
