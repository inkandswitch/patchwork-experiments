// map-node.js — a MAP box (Leaflet, bundled). A geo coordinate space:
//  • pan/zoom the map (select/hand brush) — view persists
//  • DRAW on it with a drawing brush → the stroke is stored as lat/lng and Leaflet reprojects
//    it, so it stays on the GROUND as you pan/zoom
//  • click to drop a marker (also geo)
// It reads the active brush off the canvas `context` to decide draw-vs-pan. Raw callbacks, no
// Solid. (Next: drag a canvas item onto the map → convert into this geo space.)
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { bindMapInstance } from "./box-transform.js";

export function mountMap({ element, config = {}, setConfig, context, itemId, onConfig }) {
  element.style.position = "relative";
  element.style.padding = "0";
  element.style.overflow = "hidden";
  element.style.minHeight = "140px";
  const root = document.createElement("div");
  root.className = "ns-map";
  root.style.cssText = "position:absolute;inset:0;";
  element.append(root);

  const view = config.view || { lat: 51.505, lng: -0.09, zoom: 13 };
  const map = L.map(root, { zoomControl: true }).setView([view.lat, view.lng], view.zoom);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  bindMapInstance(itemId, map); // this map is now a coordinate-space BOX: its `reproject` transform composes with the canvas

  // resize WITH the editor box (Leaflet needs to be told)
  const ro = new ResizeObserver(() => { try { map.invalidateSize(); } catch {} });
  ro.observe(element);
  setTimeout(() => { try { map.invalidateSize(); } catch {} }, 60);

  const saveView = () => { if (!setConfig) return; const c = map.getCenter(); setConfig({ view: { lat: c.lat, lng: c.lng, zoom: map.getZoom() } }); };
  map.on("moveend", saveView);
  map.on("zoomend", saveView);

  // geo markers + geo strokes — both stored as lat/lng, reprojected natively by Leaflet
  let markerData = Array.isArray(config.markers) ? [...config.markers] : [];
  const dropMarker = (lat, lng) => L.circleMarker([lat, lng], { radius: 6, color: "#e36588", weight: 2, fillColor: "#e36588", fillOpacity: 0.85 }).addTo(map);
  for (const m of markerData) dropMarker(m.lat, m.lng);

  let strokes = Array.isArray(config.strokes) ? config.strokes.map((s) => [...s]) : [];
  const drawPolyline = (pts) => L.polyline(pts.map((p) => [p[0], p[1]]), { color: "var(--ns-ink, #1c1a17)", weight: 3, lineCap: "round", lineJoin: "round" }).addTo(map);
  for (const s of strokes) drawPolyline(s);

  // draw vs pan, from the active brush on the canvas context
  let tool = "select";
  const isDraw = () => tool && tool !== "select" && tool !== "hand" && tool !== "wire";
  const applyMode = () => {
    if (isDraw()) { map.dragging.disable(); root.style.cursor = "crosshair"; }
    else { map.dragging.enable(); root.style.cursor = ""; }
  };
  const offTool = context && context.tool && typeof context.tool.connect === "function"
    ? context.tool.connect(() => { tool = context.tool.value; applyMode(); })
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
  // reactive: the canvas/tool may add or remove pins in THIS item's config
  if (typeof onConfig === "function") onConfig((c) => { if (Array.isArray(c && c.pins)) { pinData = [...c.pins]; syncPins(pinData); } });

  root.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  root.addEventListener("drop", (e) => {
    e.preventDefault(); e.stopPropagation();
    let links = [];
    const raw = e.dataTransfer.getData("text/x-patchwork-dnd");
    if (raw) { try { links = (JSON.parse(raw).items || []).filter((i) => i.url); } catch {} }
    if (!links.length) (e.dataTransfer.getData("text/plain") || "").split(/\r?\n/).forEach((s) => { s = s.trim(); if (s.startsWith("automerge:")) links.push({ url: s }); });
    if (!links.length) return;
    const ll = map.mouseEventToLatLng(e); // screen → the map's coordinate space (reproject)
    for (const l of links) pinData.push({ lat: ll.lat, lng: ll.lng, url: l.url, name: l.name || l.title });
    syncPins(pinData); persist();
  });

  // click to drop a marker (only when NOT drawing)
  map.on("click", (e) => {
    if (isDraw()) return;
    markerData = [...markerData, { lat: e.latlng.lat, lng: e.latlng.lng }];
    dropMarker(e.latlng.lat, e.latlng.lng);
    if (setConfig) setConfig({ markers: markerData });
  });

  // FREEHAND draw when a drawing brush is active → geo stroke
  const onDown = (e) => {
    if (!isDraw()) return;
    e.stopPropagation();
    e.preventDefault();
    const pts = [];
    let pl = null;
    const add = (ev) => {
      // mouseEventToLatLng accounts for the box's CSS scale (the canvas camera zoom) — a
      // manual clientX-rect.left is off whenever the map box is zoomed.
      const ll = map.mouseEventToLatLng(ev);
      pts.push([ll.lat, ll.lng]);
      if (pl) pl.setLatLngs(pts); else pl = drawPolyline(pts);
    };
    add(e);
    const move = (ev) => add(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (pts.length > 1) { strokes = [...strokes, pts]; if (setConfig) setConfig({ strokes }); }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  root.addEventListener("pointerdown", onDown, true); // capture → beat Leaflet's own drag

  return () => {
    try { bindMapInstance(itemId, null); if (offTool) offTool(); ro.disconnect(); map.remove(); } catch {}
    root.remove();
  };
}
