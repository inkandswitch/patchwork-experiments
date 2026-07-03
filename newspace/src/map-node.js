// map-node.js — a MAP box (Leaflet, bundled). A geo coordinate space:
//  • pan/zoom the map (select/hand brush) — view persists
//  • DRAW on it with a drawing brush → the mark is stored as lat/lng and Leaflet
//    reprojects it, so it stays on the GROUND as you pan/zoom. Strokes freehand;
//    rectangle/ellipse/line/arrow land as geo shapes; the eraser removes marks.
//  • click to drop a marker (select mode, geo)
// It reads the active brush off the canvas `context` to decide draw-vs-pan. Raw
// callbacks, no Solid. (Next: drag a canvas item onto the map → convert into this geo space.)
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { bindMapInstance, notifySpaceChanged } from "./box-transform.js";
import { drawClaim, drawsClaimed } from "./context.js";
import { makeMarkStreams, reconcilePlan, normalizeMarks, sameMarks } from "./map-schemas.js";
// the schemas live in map-schemas.js (Leaflet-free) so index.jsx can put them on
// the descriptor's outlets WITHOUT loading this lazy chunk; re-exported here too.
export { geoMarksSchema, pixelMarksSchema } from "./map-schemas.js";

export function mountMap({ element, config = {}, setConfig, setOutlet, context, itemId, onConfig }) {
  // NOTE: no position override — .ns-doc-body is position:absolute inset:0 (fills the box);
  // forcing `relative` here knocked it out of absolute fill and it collapsed to min-height.
  element.style.padding = "0";
  element.style.overflow = "hidden";
  const root = document.createElement("div");
  root.className = "ns-map";
  root.style.cssText = "position:absolute;inset:0;";
  element.append(root);

  const view = config.view || { lat: 51.505, lng: -0.09, zoom: 13 };
  const map = L.map(root, { zoomControl: true }).setView([view.lat, view.lng], view.zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  bindMapInstance(itemId, map); // this map is now a coordinate-space BOX: its `reproject` transform composes with the canvas

  // THEME: derive the map's appearance from the tool theme. The OSM tiles get a
  // dark filter when the theme's paper is dark — resolved through a probe element
  // (custom props may hold var()/color-mix, so read a COMPUTED color, not the raw
  // token), re-applied when the host flips its theme (class/data attrs on html/body).
  const resolvedPaper = () => {
    const probe = document.createElement("div");
    probe.style.cssText = "position:absolute;visibility:hidden;color:var(--ns-paper,#f0e8d6)";
    element.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c || "";
  };
  const paperIsDark = () => { const m = resolvedPaper().match(/\d+(?:\.\d+)?/g); if (!m) return false; const [r, g, b] = m.map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b < 110; };
  const applyTheme = () => { const pane = root.querySelector(".leaflet-tile-pane"); if (pane) pane.style.filter = paperIsDark() ? "invert(1) hue-rotate(180deg) brightness(0.9) contrast(0.9) saturate(0.55)" : ""; };
  applyTheme();
  const themeMo = new MutationObserver(applyTheme);
  themeMo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
  if (document.body) themeMo.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });

  // resize WITH the editor box (Leaflet needs to be told)
  const ro = new ResizeObserver(() => { try { map.invalidateSize(); } catch {} });
  ro.observe(element);
  setTimeout(() => { try { map.invalidateSize(); } catch {} }, 60);

  const saveView = () => { if (!setConfig) return; const c = map.getCenter(); setConfig({ view: { lat: c.lat, lng: c.lng, zoom: map.getZoom() } }); };
  map.on("moveend", saveView);
  map.on("zoomend", saveView);
  // the map's projection CHANGES on pan/zoom — notify so items PARENTED into this box
  // (canvas strokes/shapes stored as lat/lng) re-project through the reproject transform,
  // AND re-emit the view-dependent `pixels` outlet (the geo `shapes` outlet stays quiet:
  // the marks themselves didn't move).
  let streams = null; // the two bidi outlets — created below, once marks exist
  const bumpSpace = () => { notifySpaceChanged(itemId); if (streams) streams.viewChanged(); };
  map.on("move zoom viewreset", bumpSpace);

  // geo markers + geo strokes — both stored as lat/lng, reprojected natively by Leaflet.
  // THEME: marker/ink colours come from the tool theme vars (same convention as ink()
  // below), not hardcoded hex — the accent is --ns-pink (the riso accent, style.css).
  const accent = () => "var(--ns-pink, #e36588)";
  let markerData = Array.isArray(config.markers) ? [...config.markers] : [];
  const dropMarker = (lat, lng) => L.circleMarker([lat, lng], { radius: 6, color: accent(), weight: 2, fillColor: accent(), fillOpacity: 0.85 }).addTo(map);
  // markers are kept as key → { layer, m } (like pins) so they RECONCILE from config
  // (a peer's add/remove appears live) and the eraser can remove them
  const markerLayers = new Map();
  const markerKey = (m) => `${(+m.lat).toFixed(6)}:${(+m.lng).toFixed(6)}`;
  const syncMarkers = (list) => {
    const want = new Set();
    for (const m of list || []) {
      if (!m || m.lat == null) continue;
      const k = markerKey(m); want.add(k);
      if (!markerLayers.has(k)) markerLayers.set(k, { layer: dropMarker(m.lat, m.lng), m });
    }
    for (const [k, r] of [...markerLayers]) if (!want.has(k)) { try { map.removeLayer(r.layer); } catch {} markerLayers.delete(k); }
  };
  syncMarkers(markerData);

  // GEO MARKS — everything drawn on the map lives in ITS coordinate space (lat/lng) and
  // reprojects with pan/zoom. `marks` is the unified array ({kind:"stroke"|"shape"});
  // legacy bare `config.strokes` (pre-marks polylines) still render and stay erasable.
  const ink = () => "var(--ns-ink, #1c1a17)";
  const mkStyle = (m) => ({ color: m.color || ink(), weight: m.weight || 3, fill: false, lineCap: "round", lineJoin: "round" });
  const drawPolyline = (pts, style) => L.polyline(pts.map((p) => [p[0], p[1]]), style || { color: ink(), weight: 3, lineCap: "round", lineJoin: "round" }).addTo(map);
  // an ellipse sampled in lat/lng space: cheap, and it stays glued to the ground
  const ellipsePts = (a, b, n = 48) => {
    const cy = (a[0] + b[0]) / 2, cx = (a[1] + b[1]) / 2, ry = Math.abs(a[0] - b[0]) / 2, rx = Math.abs(a[1] - b[1]) / 2;
    return Array.from({ length: n }, (_, i) => { const t = (i / n) * Math.PI * 2; return [cy + ry * Math.sin(t), cx + rx * Math.cos(t)]; });
  };
  const drawShape = (m) => {
    const st = mkStyle(m);
    if (m.type === "rectangle") return L.rectangle([m.a, m.b], st).addTo(map);
    if (m.type === "ellipse") return L.polygon(ellipsePts(m.a, m.b), st).addTo(map);
    const layers = [L.polyline([m.a, m.b], st)];
    if (m.type === "arrow" && m.head) layers.push(L.polyline([m.head[0], m.b, m.head[1]], st));
    const g = L.layerGroup(layers).addTo(map);
    g.setStyle = (s) => layers.forEach((l) => l.setStyle(s)); // uniform erase-highlight surface
    return g;
  };
  const drawMark = (m) => (m.kind === "shape" ? drawShape(m) : drawPolyline(m.pts, mkStyle(m)));
  let marks = Array.isArray(config.marks) ? config.marks.map((m) => JSON.parse(JSON.stringify(m))) : [];
  let legacy = Array.isArray(config.strokes) ? config.strokes.map((s) => [...s]) : [];
  const markLayers = new Map(); // mark|legacy entry → leaflet layer (for erase)
  for (const m of marks) markLayers.set(m, drawMark(m));
  for (const s of legacy) markLayers.set(s, drawPolyline(s));

  // ── the two BIDI outlets: `shapes` (lat/lng) + `pixels` (container px) ──────
  // Views over the SAME marks (the source of truth above). The lens core is pure
  // (map-schemas.js); only project/unproject touch Leaflet, at the CURRENT view.
  const projectPt = (p) => { const c = map.latLngToContainerPoint(L.latLng(p[0], p[1])); return [c.x, c.y]; };
  const unprojectPt = (p) => { const ll = map.containerPointToLatLng(L.point(p[0], p[1])); return [ll.lat, ll.lng]; };
  // an external write (either outlet) landed on the marks: reconcile the Leaflet
  // layers by identity diff — removals and edits included (the same markLayers
  // bookkeeping the eraser uses), then persist. COW apply keeps untouched marks'
  // identity, so only the marks the op changed are redrawn.
  const reconcileMarks = (next, prev) => {
    const plan = reconcilePlan(prev, next);
    for (const m of plan.remove) { const layer = markLayers.get(m); if (layer) { try { map.removeLayer(layer); } catch {} } markLayers.delete(m); }
    for (const m of plan.add) markLayers.set(m, drawMark(m));
    marks = next;
  };
  streams = makeMarkStreams({
    marks, project: projectPt, unproject: unprojectPt, local: `map:${itemId || ""}`,
    // no persistMarks here — it would loop back through streams.changed (double emit)
    onChange: (next, prev) => { reconcileMarks(next, prev); if (setConfig) setConfig({ marks, strokes: legacy }); },
  });
  if (setOutlet) { setOutlet("shapes", streams.shapes); setOutlet("pixels", streams.pixels); }
  // every LOCAL change (draw / erase) already flows through here — persist + emit both outlets
  const persistMarks = () => { if (setConfig) setConfig({ marks, strokes: legacy }); if (streams) streams.changed(marks); };

  // draw vs pan, from the active brush on the canvas context
  const SHAPES = new Set(["rectangle", "ellipse", "line", "arrow"]); // = SHAPE_TOOLS (kept local: this chunk lazy-loads)
  let tool = "select";
  let brushCfg = {};
  const isDraw = () => tool && !["select", "hand", "wire", "text", "place"].includes(tool);
  const applyMode = () => {
    if (isDraw()) { map.dragging.disable(); root.style.cursor = "crosshair"; }
    else { map.dragging.enable(); root.style.cursor = ""; }
  };
  const offTool = context && context.tool && typeof context.tool.connect === "function"
    ? context.tool.connect(() => { tool = context.tool.value; applyMode(); })
    : null;
  const offBrush = context && context.brush && typeof context.brush.connect === "function"
    ? context.brush.connect(() => { brushCfg = context.brush.value || {}; })
    : null;
  applyMode();

  // The map is a CONTAINER of geo-located docs ("pins"): a canvas doc dropped on the map — or
  // dragged onto it from the canvas — is stored as {lat,lng,url,name} and rendered as a labelled,
  // DRAGGABLE marker that stays on the ground as you pan/zoom. Drag a pin → its geo updates;
  // click its label → opens the doc. Pins reactively sync from config, so an add from the canvas
  // (the tool writing this item's config) appears live.
  let pinData = Array.isArray(config.pins) ? [...config.pins] : [];
  const rendered = new Map(); // key → { marker, pin }
  const pinKey = (p) => `${p.url || ""}:${p.lat.toFixed(6)}:${p.lng.toFixed(6)}`;
  const openDoc = (url) => root.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url }, bubbles: true, composed: true }));
  const persist = () => { if (setConfig) setConfig({ pins: pinData }); };

  const removePin = (pin, marker) => { pinData = pinData.filter((p) => p !== pin); rendered.delete(pinKey(pin)); try { map.removeLayer(marker); } catch {} persist(); };
  // a live mini-view of the doc — built LAZILY (Leaflet calls this when the popup opens), so
  // only the pin you click mounts a tool, not every pin.
  const makePopup = () => (pin) => {
    const box = document.createElement("div"); box.className = "ns-map-pin-pop";
    if (pin.url) { const pv = document.createElement("patchwork-view"); pv.setAttribute("doc-url", pin.url); pv.className = "ns-map-pin-view"; box.append(pv); }
    const open = document.createElement("button"); open.className = "ns-map-pin-open"; open.textContent = "open ↗";
    open.addEventListener("click", (e) => { e.stopPropagation(); if (pin.url) openDoc(pin.url); });
    box.append(open);
    return box;
  };
  const makePin = (pin) => {
    const html = document.createElement("div"); html.className = "ns-map-pin"; html.textContent = pin.name || "doc";
    // fill in the real doc title when the drop didn't carry a name (display only)
    if (!pin.name && pin.url && typeof window !== "undefined" && window.repo) {
      window.repo.find(pin.url).then((h) => { const d = h && h.doc && h.doc(); const t = d && (d.title || d.name); if (t) html.textContent = t; }).catch(() => {});
    }
    const icon = L.divIcon({ html, className: "ns-map-pin-wrap", iconSize: null });
    const m = L.marker([pin.lat, pin.lng], { icon }).addTo(map); // reposition via drag-OFF, not in-map drag
    m.bindPopup(() => makePopup()(pin), { minWidth: 250, maxWidth: 260, className: "ns-map-pin-popup" });
    html.addEventListener("click", (e) => { e.stopPropagation(); m.openPopup(); }); // click → live preview (open ↗ navigates)
    // drag the pin OFF the map back onto the canvas: it carries the doc link, and if it lands
    // somewhere (dropEffect ≠ none) it leaves the map — the geo→canvas half of the round-trip.
    html.setAttribute("draggable", "true");
    html.addEventListener("dragstart", (e) => {
      e.stopPropagation();
      e.dataTransfer.effectAllowed = "copyMove";
      e.dataTransfer.setData("text/x-patchwork-dnd", JSON.stringify({ items: [{ url: pin.url, name: pin.name, type: pin.type || "" }] }));
      if (pin.url) e.dataTransfer.setData("text/plain", pin.url);
    });
    html.addEventListener("dragend", (e) => { if (e.dataTransfer.dropEffect && e.dataTransfer.dropEffect !== "none") removePin(pin, m); });
    return m;
  };
  const syncPins = (pins) => {
    const want = new Set();
    for (const p of pins || []) { if (!p || p.lat == null) continue; const k = pinKey(p); want.add(k); if (!rendered.has(k)) rendered.set(k, { marker: makePin(p), pin: p }); }
    for (const [k, r] of [...rendered]) if (!want.has(k)) { try { map.removeLayer(r.marker); } catch {} rendered.delete(k); } // pin removed elsewhere
  };
  syncPins(pinData);
  // reactive: the canvas/tool may add or remove pins in THIS item's config; and an
  // EXTERNAL write to config.marks (another peer, or the tool writing this item's
  // config) must reconcile the Leaflet layers too — removals and edits included, not
  // just adds. Our own persistMarks round-trips back here value-equal, so sameMarks
  // is the echo guard; the emit carries no setConfig (this CAME from config).
  if (typeof onConfig === "function") onConfig((c) => {
    if (Array.isArray(c && c.pins)) { pinData = [...c.pins]; syncPins(pinData); }
    // markers reconcile like pins — a peer's dropped/erased marker appears/vanishes live
    if (Array.isArray(c && c.markers) && JSON.stringify(c.markers) !== JSON.stringify(markerData)) {
      markerData = [...c.markers]; syncMarkers(markerData);
    }
    if (Array.isArray(c && c.marks) && !sameMarks(c.marks, marks)) {
      reconcileMarks(normalizeMarks(JSON.parse(JSON.stringify(c.marks))), marks);
      if (streams) streams.changed(marks);
    }
    // legacy bare strokes erased/added elsewhere reconcile too (full redraw — legacy only)
    if (Array.isArray(c && c.strokes) && JSON.stringify(c.strokes) !== JSON.stringify(legacy)) {
      for (const s of legacy) { const l = markLayers.get(s); if (l) { try { map.removeLayer(l); } catch {} } markLayers.delete(s); }
      legacy = c.strokes.map((s) => [...s]);
      for (const s of legacy) markLayers.set(s, drawPolyline(s));
    }
  });

  root.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  root.addEventListener("drop", (e) => {
    e.preventDefault(); e.stopPropagation();
    let links = [];
    const raw = e.dataTransfer.getData("text/x-patchwork-dnd");
    if (raw) { try { links = (JSON.parse(raw).items || []).filter((i) => i.url); } catch {} }
    if (!links.length) (e.dataTransfer.getData("text/plain") || "").split(/\r?\n/).forEach((s) => { s = s.trim(); if (s.startsWith("automerge:")) links.push({ url: s }); });
    if (!links.length) return;
    const ll = map.mouseEventToLatLng(e); // screen → the map's coordinate space (reproject)
    // name must be a real string — persisting `undefined` throws inside handle.change
    for (const l of links) pinData.push({ lat: ll.lat, lng: ll.lng, url: l.url, name: l.name || l.title || (l.url ? String(l.url).replace(/^automerge:/, "").slice(0, 8) : "untitled") });
    syncPins(pinData); persist();
  });

  // click to drop a marker (only when NOT drawing)
  map.on("click", (e) => {
    if (isDraw()) return;
    markerData = [...markerData, { lat: e.latlng.lat, lng: e.latlng.lng }];
    syncMarkers(markerData); // through the reconciler so the layer is tracked (erasable)
    if (setConfig) setConfig({ markers: markerData });
  });

  // DRAW when a drawing brush is active → geo marks IN the map's space.
  // mouseEventToLatLng accounts for the box's CSS scale (the canvas camera zoom) — a
  // manual clientX-rect.left is off whenever the map box is zoomed.
  const arrowHead = (a, b) => {
    // head geometry in projected pixel space (angles are wrong in raw lat/lng), stored as geo
    const pa = map.latLngToLayerPoint(a), pb = map.latLngToLayerPoint(b);
    const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x), len = 12;
    const wing = (da) => map.layerPointToLatLng(L.point(pb.x - len * Math.cos(ang + da), pb.y - len * Math.sin(ang + da)));
    const w1 = wing(0.5), w2 = wing(-0.5);
    return [[w1.lat, w1.lng], [w2.lat, w2.lng]];
  };
  const eraseNear = (ev) => {
    const p = map.mouseEventToContainerPoint(ev);
    for (const [m, layer] of [...markLayers]) {
      const pts = m.kind === "shape" ? (m.type === "ellipse" ? ellipsePts(m.a, m.b, 24) : [m.a, m.b]) : (m.pts || m);
      const hit = pts.some((pt) => map.latLngToContainerPoint(pt).distanceTo(p) < 12);
      if (!hit) continue;
      try { map.removeLayer(layer); } catch {}
      markLayers.delete(m);
      if (m.kind) marks = marks.filter((x) => x !== m); else legacy = legacy.filter((x) => x !== m);
    }
    // markers erase too (marks/legacy persist on pointerup via persistMarks; markers
    // live in their own config field, persisted here on hit)
    let erasedMarker = false;
    for (const [k, r] of [...markerLayers]) {
      if (map.latLngToContainerPoint([r.m.lat, r.m.lng]).distanceTo(p) >= 12) continue;
      try { map.removeLayer(r.layer); } catch {}
      markerLayers.delete(k);
      markerData = markerData.filter((x) => markerKey(x) !== k);
      erasedMarker = true;
    }
    if (erasedMarker && setConfig) setConfig({ markers: markerData });
  };
  const onDown = (e) => {
    if (!isDraw()) return;
    // THE CLAIM PROTOCOL (context.js): when an ancestor canvas CLAIMS drawing, the map does
    // NOT capture draw gestures — they go to the canvas, which draws rough.js marks parented
    // into this box's geo space (selectable, draggable out). This capture path is the
    // FALLBACK for viewing/drawing on the map standalone (no claiming host), unchanged.
    // Select/hand interactivity (pan, pins, popups) is never claimed and stays as-is.
    if (drawClaim({ tool, claimed: drawsClaimed(context), entered: false }) !== "own") return;
    e.stopPropagation();
    e.preventDefault();
    const finish = (move, up) => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    if (tool === "eraser") {
      eraseNear(e);
      const move = (ev) => eraseNear(ev);
      const up = () => { finish(move, up); persistMarks(); };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    const style = { color: brushCfg.color || ink(), weight: brushCfg.size || 3 };
    if (SHAPES.has(tool)) {
      const start = map.mouseEventToLatLng(e);
      const a = [start.lat, start.lng];
      let m = { kind: "shape", type: tool, a, b: a, ...style };
      let preview = null;
      const redraw = () => { if (preview) { try { map.removeLayer(preview); } catch {} } preview = drawShape(m); };
      const move = (ev) => { const ll = map.mouseEventToLatLng(ev); m.b = [ll.lat, ll.lng]; if (tool === "arrow") m.head = arrowHead(m.a, m.b); redraw(); };
      const up = () => {
        finish(move, up);
        if (m.b === a) { if (preview) { try { map.removeLayer(preview); } catch {} } return; } // no drag, no mark
        marks = [...marks, m]; markLayers.set(m, preview); persistMarks();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      return;
    }
    // any stroke brush → freehand geo polyline
    const m = { kind: "stroke", pts: [], ...style };
    let pl = null;
    const add = (ev) => { const ll = map.mouseEventToLatLng(ev); m.pts.push([ll.lat, ll.lng]); if (pl) pl.setLatLngs(m.pts); else pl = drawPolyline(m.pts, mkStyle(m)); };
    add(e);
    const move = (ev) => add(ev);
    const up = () => {
      finish(move, up);
      if (m.pts.length > 1) { marks = [...marks, m]; markLayers.set(m, pl); persistMarks(); }
      else if (pl) { try { map.removeLayer(pl); } catch {} }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  root.addEventListener("pointerdown", onDown, true); // capture → beat Leaflet's own drag AND the body's stopPropagation

  // each teardown step in its own try — a throw in one must not skip the rest
  return () => {
    try { bindMapInstance(itemId, null); } catch {}
    try { if (streams) streams.stop(); } catch {}
    try { themeMo.disconnect(); } catch {}
    try { if (offTool) offTool(); } catch {}
    try { if (offBrush) offBrush(); } catch {}
    try { ro.disconnect(); } catch {}
    try { map.remove(); } catch {}
    root.remove();
  };
}
