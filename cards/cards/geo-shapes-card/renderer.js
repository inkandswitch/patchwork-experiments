// The geo-shape renderer map extension: draws whatever the `GeoShapes` channel
// holds — markers and lines, published by source cards — onto the map it is
// installed in, and wires up the focus loop in both directions. A shape's
// document being focused (the selection ∪ highlight union) lights the shape
// up; hovering a shape writes its document into the Highlight channel, so the
// embed / token pointing at it lights up too. Hovering a marker also opens a
// popup embedding a <patchwork-view> of the shape's document.
//
// All coordinates arrive resolved in the channel (sources do the repo work),
// so rendering is synchronous: each emission is reconciled against the
// previous shape set by `target` identity.
//
// Plain-JS bundleless module. maplibre-gl is a genuinely external dependency
// (not in the importmap): only `Marker` and `Popup` are used, and both attach
// to the host map fine across bundle copies; the page already carries
// maplibre's CSS because the map tool created the map. Everything else is
// importmap-provided or imported by automerge url (sibling cards, core).

import { parseAutomergeUrl } from "@automerge/automerge-repo";
import maplibregl from "https://esm.sh/maplibre-gl@5.24.0";
import { GeoShapes } from "./channels.js";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";
const SELECTION_PACKAGE_URL = "automerge:3FqZv79rgfNX5nKn9kkpWGCSQUjW";

const { getContextHandle, subscribeContext } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { Highlight, Selection } = await import(
  getImportableUrlFromAutomergeUrl(SELECTION_PACKAGE_URL, "channels.js")
);

// Pins are blue; CSS intensifies/glows them while focused (see CSS below).
const MARKER_COLOR = "#3b82f6";
// Lines are drawn through a GeoJSON source/layer (a DOM marker can't sit
// behind a polyline). A focused line — its owning document is emphasized
// elsewhere — thickens and darkens via maplibre feature-state.
const LINE_SOURCE = "embark-geo-lines";
const LINE_LAYER = "embark-geo-lines";
const LINE_COLOR = "#3b82f6";
const LINE_FOCUS_COLOR = "#1d4ed8";
const LINE_WIDTH = 3;
const LINE_FOCUS_WIDTH = 6;

/**
 * The renderer as a map extension: `(element, map) => teardown`.
 * @returns {(element: HTMLElement & { repo: any }, map: any) => () => void}
 */
export const geoShapeRenderer = () => (element, map) => {
  injectStyles();

  // One marker per drawn GeoMarker, keyed by its target; the owning doc rides
  // along for hover/focus. Lines live in the GeoJSON source, mirrored here so
  // focus and framing can reach their coordinates.
  const markers = new Map();
  let lines = [];

  // Focus bookkeeping (the union of the Selection and Highlight channels).
  let focusedDocIds = new Set();
  let selectionUrls = {};
  let highlightUrls = {};
  // The highlight entry this renderer currently owns (the hovered shape's
  // doc), cleared on mouse-out or when the shape goes away.
  let hovered;
  // The line-doc whose hover currently owns a highlight entry, so the layer's
  // mouseleave can release exactly it.
  let hoveredLineDoc;

  // The style is loaded before extensions install (the host gates on `load`),
  // so the line source/layer can be added right away.
  map.addSource(LINE_SOURCE, {
    type: "geojson",
    // Drive feature-state by the line's target url, so highlight survives
    // data updates.
    promoteId: "target",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: LINE_LAYER,
    type: "line",
    source: LINE_SOURCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": [
        "case",
        ["boolean", ["feature-state", "focused"], false],
        LINE_FOCUS_COLOR,
        ["coalesce", ["get", "color"], LINE_COLOR],
      ],
      "line-width": [
        "case",
        ["boolean", ["feature-state", "focused"], false],
        LINE_FOCUS_WIDTH,
        LINE_WIDTH,
      ],
      "line-opacity": 0.9,
    },
  });

  // --- Hover tooltip ---------------------------------------------------------
  // A single reused popup that embeds a <patchwork-view> of the hovered pin's
  // document (the channel key — shapes' targets point at coordinate subtrees
  // that carry no @patchwork metadata). Reused so only the hovered card is
  // ever mounted.
  const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    maxWidth: "none",
    offset: 18,
    className: "embark-geo-popup",
  });
  let popupTarget;
  let overPopup = false;
  let hideTimer;

  const showPopup = (target, coords, docUrl) => {
    if (hideTimer) clearTimeout(hideTimer);
    if (popupTarget !== target) {
      popupTarget = target;
      const body = document.createElement("div");
      body.className = "embark-geo-popup__body";
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
      popupTarget = undefined;
    }, 160);
  };

  // Close immediately for a specific target (e.g. its pin is being removed).
  const hidePopupFor = (target) => {
    if (popupTarget !== target) return;
    if (hideTimer) clearTimeout(hideTimer);
    overPopup = false;
    popup.remove();
    popupTarget = undefined;
  };

  // --- Hover -> Highlight ------------------------------------------------------
  // The renderer's own scoped slice of the Highlight channel (just the hovered
  // shape's document). Because each writer owns its slice, this is a plain key
  // add/delete — other writers' highlights live in their own slices.
  const highlightHandle = getContextHandle(element, Highlight);
  const writeHighlight = (remove, add) => {
    if (remove === add) return;
    highlightHandle.change((slice) => {
      if (remove) delete slice[remove];
      if (add) slice[add] = true;
    });
  };

  const setHovered = (url) => {
    if (hovered === url) return;
    const previous = hovered;
    hovered = url;
    writeHighlight(previous, url);
  };

  const clearHovered = (url) => {
    if (hovered !== url) return;
    hovered = undefined;
    writeHighlight(url, undefined);
  };

  // --- Focus -------------------------------------------------------------------
  const styleMarker = (entry) => {
    const focused = focusedDocIds.has(parseAutomergeUrl(entry.docUrl).documentId);
    entry.marker
      .getElement()
      .classList.toggle("embark-geo-marker--focused", focused);
  };

  // Mirror the focus union onto the line layer (feature-state drives the paint
  // expression).
  const applyLineFocus = () => {
    if (!map.getSource(LINE_SOURCE)) return;
    for (const line of lines) {
      map.setFeatureState(
        { source: LINE_SOURCE, id: line.target },
        { focused: focusedDocIds.has(line.docId) },
      );
    }
  };

  const recomputeFocus = () => {
    const ids = new Set();
    for (const url of [
      ...Object.keys(selectionUrls),
      ...Object.keys(highlightUrls),
    ]) {
      try {
        ids.add(parseAutomergeUrl(url).documentId);
      } catch {
        // not a doc url; ignore
      }
    }
    focusedDocIds = ids;
    for (const entry of markers.values()) styleMarker(entry);
    applyLineFocus();
  };

  const unsubscribeSelection = subscribeContext(element, Selection, (all) => {
    selectionUrls = all;
    recomputeFocus();
  });
  const unsubscribeHighlight = subscribeContext(element, Highlight, (all) => {
    highlightUrls = all;
    recomputeFocus();
  });

  // --- Shape reconciliation ------------------------------------------------------
  const addMarker = (shape, docUrl) => {
    const coords = toLngLat(shape.at);
    const marker = new maplibregl.Marker({
      color: shape.color ?? MARKER_COLOR,
    }).setLngLat(coords);
    const markerEl = marker.getElement();
    markerEl.classList.add("embark-geo-marker");
    markerEl.addEventListener("mouseenter", () => {
      setHovered(docUrl);
      showPopup(shape.target, coords, docUrl);
    });
    markerEl.addEventListener("mouseleave", () => {
      clearHovered(docUrl);
      scheduleHidePopup();
    });
    marker.addTo(map);
    const entry = { marker, docUrl };
    markers.set(shape.target, entry);
    styleMarker(entry);
  };

  const removeMarker = (target) => {
    const entry = markers.get(target);
    if (!entry) return;
    clearHovered(entry.docUrl);
    hidePopupFor(target);
    entry.marker.remove();
    markers.delete(target);
  };

  const renderLines = () => {
    const source = map.getSource(LINE_SOURCE);
    if (!source) return;
    const features = lines.map((line) => ({
      type: "Feature",
      id: line.target,
      properties: {
        target: line.target,
        docUrl: line.docUrl,
        ...(line.color ? { color: line.color } : {}),
      },
      geometry: {
        type: "LineString",
        coordinates: line.points.map(toLngLat),
      },
    }));
    source.setData({ type: "FeatureCollection", features });
    applyLineFocus();
  };

  // Rebuild markers and lines from the latest emission. The whole union is
  // visible here, so cross-shape policy lives here too: a marker sitting on an
  // interior vertex of a published line is suppressed (a vertex's target is
  // the line's target plus an automerge array-index segment, `…/@i`), so a
  // line shows markers only at its start and end.
  const onShapes = (all) => {
    const nextLines = [];
    const nextMarkers = new Map();
    const markerDocs = new Map();

    for (const [docUrl, shapes] of Object.entries(all)) {
      for (const shape of shapes) {
        if (shape.type === "line") {
          if (shape.points.length < 2) continue;
          nextLines.push({
            ...shape,
            docUrl,
            docId: parseAutomergeUrl(docUrl).documentId,
          });
        } else {
          nextMarkers.set(shape.target, shape);
          markerDocs.set(shape.target, docUrl);
        }
      }
    }

    const interior = new Set();
    for (const line of nextLines) {
      for (let i = 1; i < line.points.length - 1; i++) {
        interior.add(`${line.target}/@${i}`);
      }
    }
    for (const target of interior) nextMarkers.delete(target);

    // Feature-state entries for lines that went away must be dropped by hand.
    for (const line of lines) {
      if (!nextLines.some((next) => next.target === line.target)) {
        if (map.getSource(LINE_SOURCE)) {
          map.removeFeatureState({ source: LINE_SOURCE, id: line.target });
        }
        if (hoveredLineDoc === line.docUrl) {
          clearHovered(line.docUrl);
          hoveredLineDoc = undefined;
        }
      }
    }
    lines = nextLines;
    renderLines();

    for (const target of [...markers.keys()]) {
      if (!nextMarkers.has(target)) removeMarker(target);
    }
    for (const [target, shape] of nextMarkers) {
      const existing = markers.get(target);
      if (!existing) {
        addMarker(shape, markerDocs.get(target));
      } else {
        // Same target, possibly moved coordinates (the source republished).
        existing.marker.setLngLat(toLngLat(shape.at));
      }
    }
  };

  const unsubscribeShapes = subscribeContext(element, GeoShapes, onShapes);

  // Hovering a line emphasizes its source document (so its embed glows and,
  // via the focus union, the line itself thickens). Routed through the same
  // single `hovered` token as markers — only one thing is ever under the
  // pointer.
  const onLineMove = (event) => {
    const feature = event.features?.[0];
    const docUrl = feature?.properties?.docUrl;
    if (!docUrl) return;
    map.getCanvas().style.cursor = "pointer";
    if (hoveredLineDoc === docUrl) return;
    if (hoveredLineDoc) clearHovered(hoveredLineDoc);
    hoveredLineDoc = docUrl;
    setHovered(docUrl);
  };

  const onLineLeave = () => {
    map.getCanvas().style.cursor = "";
    if (!hoveredLineDoc) return;
    clearHovered(hoveredLineDoc);
    hoveredLineDoc = undefined;
  };

  map.on("mousemove", LINE_LAYER, onLineMove);
  map.on("mouseleave", LINE_LAYER, onLineLeave);

  return () => {
    unsubscribeShapes();
    unsubscribeSelection();
    unsubscribeHighlight();
    if (hovered) writeHighlight(hovered, undefined);
    highlightHandle.release();
    if (hideTimer) clearTimeout(hideTimer);
    popup.remove();
    for (const { marker } of markers.values()) marker.remove();
    markers.clear();
    map.off("mousemove", LINE_LAYER, onLineMove);
    map.off("mouseleave", LINE_LAYER, onLineLeave);
    if (map.getLayer(LINE_LAYER)) map.removeLayer(LINE_LAYER);
    if (map.getSource(LINE_SOURCE)) map.removeSource(LINE_SOURCE);
  };
};

function toLngLat(point) {
  return [point.lon, point.lat];
}

// --- Styles --------------------------------------------------------------------

const STYLE_ID = "embark-geo-shapes-renderer-css";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
/* The geo-shape marker can be hovered to focus its document, so make it feel
   clickable. */
.embark-geo-marker {
  cursor: pointer;
}

/* A pin whose document is in focus (selection ∪ highlight): the same blue,
   deepened and given a glow. filter leaves maplibre's positioning transform
   untouched, and brightness/saturate push the color more intense. */
.embark-geo-marker--focused {
  filter: brightness(0.82) saturate(1.7)
    drop-shadow(0 0 3px rgba(37, 99, 235, 0.9))
    drop-shadow(0 0 8px rgba(37, 99, 235, 0.7));
  z-index: 3;
}

/* Hover tooltip: strip maplibre's default chrome so the embedded
   <patchwork-view> supplies its own surface, then size and clip it. */
.embark-geo-popup .maplibregl-popup-content {
  padding: 0;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.18);
}

.embark-geo-popup__body {
  width: 240px;
  max-height: 260px;
  overflow: auto;
}

.embark-geo-popup__body patchwork-view {
  display: block;
}
`;
