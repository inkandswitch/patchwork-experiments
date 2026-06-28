import { render } from "solid-js/web";
import { createSignal, createMemo, createEffect, For, Show, onCleanup, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { makeDocumentProjection } from "solid-automerge";
import { makePersisted } from "@solid-primitives/storage";
import {
  getRegistry,
  createDocOfDatatype2,
  getSupportedToolsForType,
} from "@inkandswitch/patchwork-plugins";
import { automergeUrlToServiceWorkerUrl } from "@inkandswitch/patchwork-filesystem";
import { NewspaceDatatype } from "../datatype.js";
import { createHistory, snapshotItems, diffCommand } from "../history.js";
import { createSketchyApi } from "../api.js";
import { createCanvasContext } from "../context.js";
import { opstreamToSignal, Source } from "../opstreams.js";
import { mountInspector } from "../inspector-editor.js";
import { readPort, portWiring, makeEditorItem, editorsForStream, firstMatchingInlet, streamType } from "../wire.js";
import { listEditors } from "../editors.js";
import { viewRect, fitRect, centerCam, zoomAt, contentBounds } from "./camera.js";
import { Item } from "./items/item.jsx";
import { PresenceLayer, Minimap } from "./ui/presence.jsx";
import { Handles, Toolbar, Properties } from "./ui/chrome.jsx";
import {
  freehandPath, shapePaths,
} from "../draw.js";
import {
  rad, rot, isBoxType, localToWorld, worldToLocal, pointInFrame,
  itemBounds, cloneItem, linksNeedingItems, itemPresent, shouldUnlinkDoc, arrowGeometry, worldAnchor,
  linkItemId, duplicateItemIds,
  applyReorder, expandGroups as expandGroupsIn, groupBounds, clickSelection, itemsInRect,
} from "../model.js";
import "../style.css";
import {
  colorVar, SIZES, shapeRenderProps, sortById, enableAtomicMove,
  SHAPE_TOOLS, clamp, rndSeed, uid, ensureLayout, colorFor, isTypingTarget,
} from "./constants.js";

export function Canvas(props) {
  const { handle, repo, element } = props;
  // the tool's doc is the FOLDER (holds `.docs`); its canvas `items` live in a
  // separate LAYOUT doc referenced by `.newspace`.
  const folderDoc = makeDocumentProjection(handle);
  const [rootLayoutH, setRootLayoutH] = createSignal(null);
  ensureLayout(repo, handle).then(setRootLayoutH).catch((e) => console.error("[newspace] ensureLayout", e));
  const rootLayoutDoc = createMemo(() => { const h = rootLayoutH(); return h ? makeDocumentProjection(h) : null; });

  const [themeTick, setThemeTick] = createSignal(0);
  // pan/zoom is remembered per-doc in localStorage (local to this viewer)
  const [cam, setCam] = makePersisted(createSignal({ x: 0, y: 0, z: 1 }), {
    name: `newspace:camera:${handle.url}`,
    storage: localStorage,
  });
  // the canvas CONTEXT (camera/pointer/tool/brush/selection) via provide/accept
  // with fallback-to-own. `tool` is context-owned (so a nested canvas can inherit
  // it); cam/selection are mirrored INTO the context below so it's live for
  // providers/inspection. Exposed on element.api.context for devtools.
  const context = createCanvasContext(element, {
    fallbacks: { camera: { x: 0, y: 0, z: 1 }, pointer: { x: 0, y: 0 }, tool: "select", brush: {}, selection: [] },
  });
  onCleanup(() => context.destroy());
  if (element && element.api) element.api.context = context;
  const tool = opstreamToSignal(context.tool); // reactive accessor over the Source
  const setTool = (v) => context.tool.set(v);
  const [draft, setDraft] = createSignal(null);
  const [wireDraft, setWireDraft] = createSignal(null); // {from:{x,y}, to:{x,y}} screen-space wire being dragged
  const [editorChooser, setEditorChooser] = createSignal(null); // {x,y,candidates,place} when a dropped wire matches >1 editor
  const [guides, setGuides] = createSignal(null); // snap-constraint overlay (behaviour brushes)
  const [selected, setSelected] = createSignal([]);
  // mirror camera + selection + brush INTO the context (one-way) so all five
  // context entries are live for providers / the inspect mode / nested canvases.
  // (cam/selected/brush stay owned here for now; chrome reading FROM the context
  // is the separate brush-API refactor.)
  createEffect(() => context.camera.set(cam()));
  createEffect(() => context.selection.set(selected()));
  const [enteredGroup, setEnteredGroup] = createSignal(null); // a group you've double-clicked INTO (scoped editing of its members)
  const [placing, setPlacing] = createSignal(null);
  const [datatypes, setDatatypes] = createSignal([]);
  const [brushes, setBrushes] = createSignal([]); // newspace:brush plugins (used later)
  const [addOpen, setAddOpen] = createSignal(false);   // docs overflow menu
  const [shapeMenuOpen, setShapeMenuOpen] = createSignal(false); // shape overflow menu
  const [extraShape, setExtraShape] = createSignal("line"); // last-used overflow shape, surfaced in the bar
  const [dropTarget, setDropTarget] = createSignal(null); // frame id a dragged item would drop INTO
  const [escapeId, setEscapeId] = createSignal(null); // a box child whose CENTRE has left it — render it unclipped (escaping)
  const [panActive, setPanActive] = createSignal(false); // an in-flight pan/zoom — overlay captures wheel so it wins over tool scroll
  const [arrowHover, setArrowHover] = createSignal(null); // item id an arrow end would bind to
  const [propsPos, setPropsPos] = createSignal({ x: 16, y: 16 });

  const [brush, setBrush] = createStore({
    color: "line", size: SIZES[1], fill: "none",
    roughness: 1.5, bowing: 0.1, fillStyle: "solid", strokeStyle: "solid", corner: "squircle",
    startArrow: false, endArrow: true,
    font: "hand", fontSize: 26,
  });
  createEffect(() => context.brush.set({ ...brush })); // mirror brush config into the context
  const [editingId, setEditingId] = createSignal(null); // item being text-edited

  let viewportRef;
  try { setDatatypes(getRegistry("patchwork:datatype").filter((d) => !d.unlisted)); } catch (e) { console.warn("[newspace] datatypes", e); }
  // custom brushes live in the `sketchy:brush` registry (legacy `newspace:brush`
  // still supported). We list them in the shape overflow, and load each brush
  // MODULE (its stroke config / behaviour) so drawing with the brush uses it.
  const brushMods = new Map(); // id -> brush module ({ stroke, iconPath, ... })
  {
    const all = [], seen = new Set();
    for (const reg of ["sketchy:brush", "newspace:brush"]) {
      try {
        const r = getRegistry(reg);
        const list = r ? (typeof r.filter === "function" ? r.filter(() => true) : (Array.isArray(r) ? r : [])) : [];
        for (const b of list) { if (b && !seen.has(b.id)) { seen.add(b.id); all.push(b); } }
      } catch {}
    }
    setBrushes(all);
    for (const b of all) Promise.resolve(b.load ? b.load() : b).then((m) => { if (m) brushMods.set(m.id || b.id, m); }).catch(() => {});
  }
  const isBrushTool = (t) => brushMods.has(t);

  const interactive = createMemo(() => tool() === "select");

  // ---- surfaces -------------------------------------------------------
  // a surface manages a space: `handle`/`doc` = its LAYOUT doc (items),
  // `folderHandle`/`folderDoc` = its FOLDER doc (docs). The root surface, plus
  // one per box (each box embeds a separate folder/newspace doc).
  const rootSurface = createMemo(() => ({ id: "root", handle: rootLayoutH(), doc: rootLayoutDoc(), folderHandle: handle, folderDoc, frame: null }));
  const surfaceReg = new Map();
  const [surfVer, setSurfVer] = createSignal(0);
  const registerSurface = (id, s) => { surfaceReg.set(id, s); setSurfVer((v) => v + 1); };
  const unregisterSurface = (id) => { if (surfaceReg.delete(id)) setSurfVer((v) => v + 1); };
  function surfaceById(id) { surfVer(); return id === "root" ? rootSurface() : surfaceReg.get(id) || rootSurface(); }
  const [activeId, setActiveId] = createSignal("root");
  const active = () => surfaceById(activeId());
  const rootItems = () => rootSurface().doc?.items || [];

  // Paint shapes/outlines IMMEDIATELY when the layout loads; mount the heavy
  // embedded tools (patchwork-views) a frame later so they don't block first
  // paint. (A doc's outline + title still show right away — only the live tool
  // waits, behind a striped placeholder.)
  const [embedsReady, setEmbedsReady] = createSignal(false);
  createEffect(() => { if (rootItems().length && !embedsReady()) requestAnimationFrame(() => requestAnimationFrame(() => setEmbedsReady(true))); });

  // load a space's folder + layout handles together
  const spaceCache = new Map();
  function loadSpace(url) {
    if (!spaceCache.has(url)) {
      spaceCache.set(url, repo.find(url).then(async (fh) => ({ folderHandle: fh, layoutHandle: await ensureLayout(repo, fh) })).catch((e) => { console.error("[newspace] loadSpace", e); return null; }));
    }
    return spaceCache.get(url);
  }
  // generic doc + datatype loaders (for resolving a doc's real title)
  const docHandleCache = new Map();
  function loadDoc(url) { if (!docHandleCache.has(url)) docHandleCache.set(url, repo.find(url).catch(() => null)); return docHandleCache.get(url); }
  const datatypeCache = new Map();
  function loadDatatype(type) { if (!datatypeCache.has(type)) { try { datatypeCache.set(type, getRegistry("patchwork:datatype").load(type).catch(() => null)); } catch { datatypeCache.set(type, Promise.resolve(null)); } } return datatypeCache.get(type); }
  const frameAtWorld = (wx, wy, exclude) => { let f = null; for (const it of rootItems()) if (it.kind === "frame" && it.id !== exclude && pointInFrame(it, wx, wy)) f = it; return f; };
  // topmost root item an arrow endpoint can bind to (not strokes/lines/arrows)
  const bindAtWorld = (wx, wy) => {
    const items = rootItems();
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it.kind === "stroke") continue;
      if (it.kind === "shape" && (it.type === "arrow" || it.type === "line")) continue;
      // hit-test the ROTATED shape (anchor in [0,1] ⇔ inside it), so you only
      // bind when over the actual tool and the stored anchor is in-bounds
      const a = worldAnchor(it, wx, wy);
      if (a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1) return it.id;
    }
    return null;
  };
  function convertToLocal(item, frame) {
    if (!frame) return;
    if (item.kind === "stroke") { item.points = item.points.map(([x, y, pr]) => { const [lx, ly] = worldToLocal(frame, x, y); return [lx, ly, pr]; }); item.rotation = 0; }
    else if (item.kind === "shape" && (item.type === "line" || item.type === "arrow")) {
      // a line/arrow points in its (w,h) direction, NOT via `rotation` — so the
      // center+rotation transform (below) would turn it. Instead transform its
      // endpoints into frame-local space (folding in any rotation) and reset
      // rotation, so it keeps pointing the same way after the drop.
      const w = item.w || 0, h = item.h || 0;
      const cx = item.x + w / 2, cy = item.y + h / 2, a = rad(item.rotation || 0);
      const worldPt = (px, py) => { const [rx, ry] = rot(px - cx, py - cy, a); return worldToLocal(frame, cx + rx, cy + ry); };
      const [lsx, lsy] = worldPt(item.x, item.y);
      const [lex, ley] = worldPt(item.x + w, item.y + h);
      if (item.cx != null) { const [lcx2, lcy2] = worldPt(item.cx, item.cy); item.cx = lcx2; item.cy = lcy2; }
      item.x = lsx; item.y = lsy; item.w = lex - lsx; item.h = ley - lsy; item.rotation = 0;
    }
    else { const w = item.w || 0, h = item.h || 0; const [lcx, lcy] = worldToLocal(frame, item.x + w / 2, item.y + h / 2); item.x = lcx - w / 2; item.y = lcy - h / 2; item.rotation = (item.rotation || 0) - (frame.rotation || 0); }
  }
  // push a freshly-made item into whichever frame it's inside (else root)
  async function pushItem(targetFrame, item, opts = {}) {
    let dstHandle = rootLayoutH(), dstFrame = null;
    if (targetFrame) { const s = await loadSpace(targetFrame.url); if (s) { dstHandle = s.layoutHandle; dstFrame = targetFrame; } }
    if (!dstHandle) return;
    convertToLocal(item, dstFrame);
    const id = uid();
    transact(dstHandle, "add", () => dstHandle.change((d) => d.items.push({ id, ...item })));
    setActiveId(dstFrame ? targetFrame.url : "root");
    setSelected([id]);
    if (opts.edit) setEditingId(id);
  }

  const itemById = (id) => (active().doc?.items || []).find((x) => x.id === id);
  const selSet = createMemo(() => new Set(selected()));
  const isSelected = (id) => selSet().has(id);

  // grouping: items sharing a `group` id select / move / rotate as one unit
  const expandGroups = (ids) => expandGroupsIn(active().doc?.items || [], ids);
  function groupSelected() { const ids = selected(); if (ids.length < 2) return; const gid = "g" + uid(); transact(active().handle, "group", () => active().handle.change((d) => { for (const id of ids) { const o = d.items.find((x) => x.id === id); if (o) o.group = gid; } })); }
  function ungroupSelected() { transact(active().handle, "ungroup", () => active().handle.change((d) => { for (const id of selected()) { const o = d.items.find((x) => x.id === id); if (o && o.group != null) delete o.group; } })); }
  const hasGroup = () => { const items = active().doc?.items || []; return selected().some((id) => { const o = items.find((x) => x.id === id); return o && o.group != null; }); };

  // itemBounds / localToWorld / worldToLocal / pointInFrame are imported from model.js

  function toWorld(clientX, clientY) {
    const r = viewportRef.getBoundingClientRect();
    const c = cam();
    const sx = viewportRef.offsetWidth ? r.width / viewportRef.offsetWidth : 1;
    const sy = viewportRef.offsetHeight ? r.height / viewportRef.offsetHeight : 1;
    return { x: ((clientX - r.left) / sx - c.x) / c.z, y: ((clientY - r.top) / sy - c.y) / c.z };
  }
  function toSpace(clientX, clientY, frame) { const w = toWorld(clientX, clientY); const [x, y] = worldToLocal(frame, w.x, w.y); return { x, y }; }
  function itemCenterWorld(it, frame) { const b = itemBounds(it); return localToWorld(frame, b.x + b.w / 2, b.y + b.h / 2); }

  // resolve any colour (var() chains, color-mix(), light-dark()) to a concrete
  // value for rough.js, by letting the browser compute it on a probe element
  let _probe;
  function resolveColor(c) {
    if (typeof c !== "string" || c === "none" || !viewportRef) return c;
    if (!_probe) { _probe = document.createElement("span"); _probe.style.cssText = "position:absolute;width:0;height:0;visibility:hidden;pointer-events:none"; viewportRef.appendChild(_probe); }
    _probe.style.color = "";
    _probe.style.color = c;
    return getComputedStyle(_probe).color || c;
  }

  // ---- selection / gestures -------------------------------------------
  let gesture = null;

  function onItemDown(it, surface, e) {
    if (e.button !== 0) return;
    e.stopPropagation();
    // grabbing a title/border takes focus off any embedded tool
    const a = document.activeElement;
    if (a && a.closest && a.closest(".ns-doc-body")) a.blur();
    if (surface.id !== activeId()) { setActiveId(surface.id); setSelected([]); }
    if (tool() === "eraser") return removeItems(surface, [it.id]);
    if (tool() !== "select") return;
    // inside an entered group, a click picks the individual member; otherwise a
    // grouped item selects its whole group (clicking elsewhere exits the group)
    const { ids: sel1, exitGroup } = clickSelection(surface.doc?.items || [], it.id, enteredGroup());
    if (exitGroup) setEnteredGroup(null);
    if (e.shiftKey) {
      const allIn = sel1.every((id) => isSelected(id));
      setSelected(allIn ? selected().filter((id) => !sel1.includes(id)) : [...new Set([...selected(), ...sel1])]);
    } else if (!isSelected(it.id)) setSelected(sel1);
    // the SECOND press of a double-click must not start a move — beginGesture's
    // preventDefault would otherwise swallow the dblclick (→ no text editing)
    if (e.detail >= 2) return;
    if (e.altKey) return startCopyMove(e, surface);
    startMove(e, surface);
  }

  // alt-drag duplicates the selection in place, then drags the copies. doc/frame
  // copies KEEP the same url (two shapes → one doc), so we add NO .docs link.
  function startCopyMove(e, surface) {
    const ids = selected();
    if (!ids.length) return;
    const fr = surface.frame ? surface.frame.rotation || 0 : 0;
    const start = toWorld(e.clientX, e.clientY);
    const orig = {};
    const clones = [];
    for (const id of ids) {
      const o = surface.doc.items.find((x) => x.id === id);
      if (!o) continue;
      const c = cloneItem(o); c.id = uid();
      clones.push(c);
      orig[c.id] = c.kind === "stroke" ? { points: c.points.map((p) => p.slice()) } : c.kind === "sketch" ? { nodes: c.nodes.map((n) => ({ x: n.x, y: n.y })) } : { x: c.x, y: c.y };
    }
    if (!clones.length) return;
    surface.handle.change((d) => { for (const c of clones) d.items.push(c); });
    const newIds = clones.map((c) => c.id);
    setSelected(newIds);
    gesture = { kind: "move", ids: newIds, start, orig, surface, fr };
    beginGesture(e);
  }

  function startMove(e, surface) {
    const ids = selected();
    if (!ids.length) return;
    const fr = surface.frame ? surface.frame.rotation || 0 : 0;
    const start = toWorld(e.clientX, e.clientY);
    const orig = {};
    for (const id of ids) {
      const o = surface.doc.items.find((x) => x.id === id);
      if (o) orig[id] = o.kind === "stroke" ? { points: o.points.map((p) => p.slice()) } : o.kind === "sketch" ? { nodes: o.nodes.map((n) => ({ x: n.x, y: n.y })) } : { x: o.x, y: o.y, cx: o.cx, cy: o.cy };
    }
    gesture = { kind: "move", ids, start, orig, surface, fr, txn: beginTxn(surface.handle) };
    beginGesture(e);
  }

  // a just-deleted doc url; the docs→items reconcile refuses to recreate it for
  // a moment, so deletion can't lose a race with the reconcile (timing-proof)
  const tombstones = new Set();
  function tombstone(url) { if (!url) return; tombstones.add(url); setTimeout(() => tombstones.delete(url), 1500); }

  // find whichever surface actually holds an item id (root or any box)
  function surfaceOf(id) {
    if ((rootSurface().doc?.items || []).some((x) => x.id === id)) return rootSurface();
    for (const s of surfaceReg.values()) if ((s.doc?.items || []).some((x) => x.id === id)) return s;
    return null;
  }
  // ---- local undo/redo (command pattern) ------------------------------
  const history = createHistory();
  // run `fn` (which mutates the layout) and record an undoable command from the
  // before/after diff. Used for atomic operations.
  function transact(handle, label, fn) {
    if (!handle || history.applying) return fn && fn();
    const before = snapshotItems(handle.doc().items);
    const r = fn && fn();
    const cmd = diffCommand(before, snapshotItems(handle.doc().items), (mut) => handle.change((d) => mut(d.items)), label);
    history.push(cmd);
    return r;
  }
  // for gestures: snapshot at the start, build the command at the end
  const beginTxn = (handle) => (handle && !history.applying ? { handle, before: snapshotItems(handle.doc().items) } : null);
  function endTxn(txn, label) {
    if (!txn || history.applying) return;
    const cmd = diffCommand(txn.before, snapshotItems(txn.handle.doc().items), (mut) => txn.handle.change((d) => mut(d.items)), label);
    history.push(cmd);
  }

  // remove items: drop the folder link FIRST (so docs→items can't recreate the
  // shape), then the shape a microtask later (after the reconcile has settled)
  function removeItems(_ignored, ids) {
    const idSet = new Set(ids);
    const captured = []; // for undo: re-add the removed layout items
    for (const id of ids) {
      const surface = surfaceOf(id);
      if (!surface) continue;
      const item = (surface.doc?.items || []).find((x) => x.id === id);
      if (!item) continue;
      captured.push({ handle: surface.handle, item: JSON.parse(JSON.stringify(item)) }); // plain clone (item is a Solid store proxy)
      if (item.kind === "doc" || item.kind === "frame") {
        // only unlink the doc when this is the LAST shape pointing at its url —
        // copies (alt-drag) can share a url, so others may still reference it
        if (shouldUnlinkDoc(surface.doc?.items || [], item.url, idSet)) {
          tombstone(item.url);
          surface.folderHandle.change((d) => { const di = d.docs.findIndex((l) => l.url === item.url); if (di >= 0) d.docs.splice(di, 1); });
        }
      }
      queueMicrotask(() => surface.handle.change((d) => { const i = d.items.findIndex((x) => x.id === id); if (i >= 0) d.items.splice(i, 1); }));
    }
    const set = new Set(ids);
    setSelected(selected().filter((s) => !set.has(s)));
    // undo a delete by re-adding the layout item(s); redo removes them again.
    // (the folder link isn't restored — an undone doc-delete is an orphan shape,
    // which is fine: it already points at its still-present doc.)
    if (captured.length && !history.applying) history.push({
      label: "delete",
      undo: () => { for (const { handle, item } of captured) handle.change((d) => { if (!d.items.some((x) => x.id === item.id)) d.items.push(JSON.parse(JSON.stringify(item))); }); },
      redo: () => { for (const { handle, item } of captured) handle.change((d) => { const i = d.items.findIndex((x) => x.id === item.id); if (i >= 0) d.items.splice(i, 1); }); },
    });
  }
  function deleteSelected() { removeItems(null, selected()); }

  const single = createMemo(() => (selected().length === 1 ? itemById(selected()[0]) : null));

  function startResizeSel(hx, hy, e) {
    e.stopPropagation(); e.preventDefault();
    if (selected().length > 1) return startGroupResize(hx, hy, e);
    const it = single();
    if (!it) return;
    const surface = active();
    const frame = surface.frame;
    const ob = itemBounds(it);
    const r = rad(it.rotation || 0);
    const orig = it.kind === "stroke" ? it.points.map((p) => p.slice())
      : it.kind === "text" ? { x: it.x, y: it.y, w: it.w, h: it.h, fontSize: it.fontSize || 20, wrap: !!it.wrap }
      : { x: it.x, y: it.y, w: it.w, h: it.h };
    const ax = -hx * ob.w / 2, ay = -hy * ob.h / 2;
    const txn = beginTxn(surface.handle);
    const move = (ev) => {
      const p = toSpace(ev.clientX, ev.clientY, frame);
      const cx0 = ob.x + ob.w / 2, cy0 = ob.y + ob.h / 2;
      const [plx, ply] = rot(p.x - cx0, p.y - cy0, -r);
      let minx = -ob.w / 2, maxx = ob.w / 2, miny = -ob.h / 2, maxy = ob.h / 2;
      if (hx !== 0) { minx = Math.min(ax, plx); maxx = Math.max(ax, plx); }
      if (hy !== 0) { miny = Math.min(ay, ply); maxy = Math.max(ay, ply); }
      const nw = Math.max(8, maxx - minx), nh = Math.max(8, maxy - miny);
      const [ncx, ncy] = rot((minx + maxx) / 2, (miny + maxy) / 2, r);
      applyResize(surface.handle, it.id, ob, { x: cx0 + ncx - nw / 2, y: cy0 + ncy - nh / 2, w: nw, h: nh }, orig, it.kind);
    };
    const up = () => { endTxn(txn, "resize"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  function applyResize(h, id, ob, nb, orig, kind) {
    const sx = ob.w > 0.001 ? nb.w / ob.w : 1, sy = ob.h > 0.001 ? nb.h / ob.h : 1;
    const mapX = (x) => nb.x + (x - ob.x) * sx, mapY = (y) => nb.y + (y - ob.y) * sy;
    h.change((d) => {
      const o = d.items.find((x) => x.id === id);
      if (!o) return;
      if (kind === "stroke") { for (let i = 0; i < o.points.length; i++) { o.points[i][0] = mapX(orig[i][0]); o.points[i][1] = mapY(orig[i][1]); } }
      else if (kind === "shape") { const x1 = mapX(orig.x), y1 = mapY(orig.y), x2 = mapX(orig.x + orig.w), y2 = mapY(orig.y + orig.h); o.x = x1; o.y = y1; o.w = x2 - x1; o.h = y2 - y1; }
      else if (kind === "text") { o.fontSize = Math.max(6, Math.round((orig.fontSize || 20) * (ob.h > 0.001 ? nb.h / ob.h : 1))); o.x = nb.x; o.y = nb.y; if (orig.wrap) o.w = nb.w; /* height re-measures from content */ }
      else { o.x = mapX(orig.x); o.y = mapY(orig.y); o.w = nb.w; o.h = nb.h; }
    });
  }

  const selWorldBounds = createMemo(() => {
    const ids = selected();
    if (ids.length < 2) return null;
    const frame = active().frame;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const id of ids) { const it = itemById(id); if (!it) continue; const b = itemBounds(it); const [wx, wy] = localToWorld(frame, b.x, b.y); minx = Math.min(minx, wx); miny = Math.min(miny, wy); maxx = Math.max(maxx, wx + b.w); maxy = Math.max(maxy, wy + b.h); }
    return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
  });

  // a faint outline around EACH selected item (only when multi-selecting), so
  // you can see exactly which shapes are in the selection
  const selItemOutlines = createMemo(() => {
    const ids = selected();
    if (ids.length < 2) return [];
    const frame = active().frame, fr = frame ? frame.rotation || 0 : 0;
    return ids.map((id) => {
      const it = itemById(id); if (!it) return null;
      const b = itemBounds(it);
      const [wx, wy] = localToWorld(frame, b.x + b.w / 2, b.y + b.h / 2);
      return { x: wx - b.w / 2, y: wy - b.h / 2, w: b.w, h: b.h, cx: wx, cy: wy, rot: (it.rotation || 0) + fr };
    }).filter(Boolean);
  });

  // outline for a group rendered "as a shape of its own": shown when a group is
  // entered, or when the selection is exactly one whole group. (root only — the
  // bounds are surface-local, which equals world at the root.)
  const groupOutline = createMemo(() => {
    if (active().frame) return null;
    const items = active().doc?.items || [];
    const eg = enteredGroup();
    let gid = eg;
    if (!gid) {
      const sel = selected();
      if (sel.length < 2) return null;
      const groups = new Set(sel.map((id) => items.find((x) => x.id === id)?.group).filter(Boolean));
      if (groups.size !== 1) return null;
      gid = [...groups][0];
      const members = items.filter((x) => x.group === gid).map((x) => x.id);
      if (sel.length !== members.length || !members.every((id) => sel.includes(id))) return null;
    }
    const b = groupBounds(items, gid);
    return b ? { ...b, entered: gid === eg } : null;
  });

  function startGroupResize(hx, hy, e) {
    const surface = active();
    const txn = beginTxn(surface.handle);
    const ids = selected();
    const U = selWorldBounds();
    if (!U) return;
    const snaps = ids.map((id) => { const o = surface.doc.items.find((x) => x.id === id); if (!o) return null; return o.kind === "stroke" ? { id, kind: "stroke", points: o.points.map((p) => p.slice()) } : { id, kind: o.kind, x: o.x, y: o.y, w: o.w, h: o.h }; }).filter(Boolean);
    const move = (ev) => {
      const p = toWorld(ev.clientX, ev.clientY);
      let nx = U.x, ny = U.y, nw = U.w, nh = U.h;
      if (hx === 1) nw = Math.max(8, p.x - U.x);
      if (hx === -1) { nw = Math.max(8, U.x + U.w - p.x); nx = U.x + U.w - nw; }
      if (hy === 1) nh = Math.max(8, p.y - U.y);
      if (hy === -1) { nh = Math.max(8, U.y + U.h - p.y); ny = U.y + U.h - nh; }
      const sx = U.w > 0.001 ? nw / U.w : 1, sy = U.h > 0.001 ? nh / U.h : 1;
      const mapX = (x) => nx + (x - U.x) * sx, mapY = (y) => ny + (y - U.y) * sy;
      surface.handle.change((d) => {
        for (const s of snaps) {
          const o = d.items.find((x) => x.id === s.id);
          if (!o) continue;
          if (s.kind === "stroke") for (let i = 0; i < o.points.length; i++) { o.points[i][0] = mapX(s.points[i][0]); o.points[i][1] = mapY(s.points[i][1]); }
          else { o.x = mapX(s.x); o.y = mapY(s.y); o.w = s.w * sx; o.h = s.h * sy; }
        }
      });
    };
    const up = () => { endTxn(txn, "transform"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  // rotate a multi-selection as one: each item orbits the group centre AND spins
  // about its own centre by the same delta (strokes rotate their points)
  function startGroupRotate(e) {
    e.stopPropagation(); e.preventDefault();
    const surface = active(), frame = surface.frame;
    const txn = beginTxn(surface.handle);
    const U = selWorldBounds();
    if (!U) return;
    const [gcx, gcy] = worldToLocal(frame, U.x + U.w / 2, U.y + U.h / 2); // group centre (surface-local)
    const snaps = selected().map((id) => { const o = surface.doc.items.find((x) => x.id === id); if (!o) return null; return o.kind === "stroke" ? { id, kind: "stroke", points: o.points.map((p) => p.slice()) } : { id, x: o.x, y: o.y, w: o.w, h: o.h, rotation: o.rotation || 0, cx: o.cx, cy: o.cy }; }).filter(Boolean);
    const s0 = toSpace(e.clientX, e.clientY, frame);
    const startAng = Math.atan2(s0.y - gcy, s0.x - gcx);
    const move = (ev) => {
      const p = toSpace(ev.clientX, ev.clientY, frame);
      let delta = Math.atan2(p.y - gcy, p.x - gcx) - startAng;
      if (ev.shiftKey) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
      const deg = (delta * 180) / Math.PI;
      surface.handle.change((d) => {
        for (const sn of snaps) {
          const o = d.items.find((x) => x.id === sn.id); if (!o) continue;
          if (sn.kind === "stroke") { for (let i = 0; i < sn.points.length; i++) { const [rx, ry] = rot(sn.points[i][0] - gcx, sn.points[i][1] - gcy, delta); o.points[i][0] = gcx + rx; o.points[i][1] = gcy + ry; } }
          else {
            const icx = sn.x + sn.w / 2, icy = sn.y + sn.h / 2;
            const [rx, ry] = rot(icx - gcx, icy - gcy, delta);
            o.x = gcx + rx - sn.w / 2; o.y = gcy + ry - sn.h / 2; o.rotation = sn.rotation + deg;
            if (sn.cx != null) { const [cxr, cyr] = rot(sn.cx - gcx, sn.cy - gcy, delta); o.cx = gcx + cxr; o.cy = gcy + cyr; }
          }
        }
      });
    };
    const up = () => { endTxn(txn, "transform"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  // double-clicking the rotate knob resets the selection's rotation to 0
  function resetRotation() {
    transact(active().handle, "reset rotation", () => active().handle.change((d) => { for (const id of selected()) { const o = d.items.find((x) => x.id === id); if (o && o.rotation) o.rotation = 0; } }));
  }

  function startRotate(e) {
    if (selected().length > 1) return startGroupRotate(e);
    e.stopPropagation(); e.preventDefault();
    const it = single();
    if (!it) return;
    const surface = active();
    const txn = beginTxn(surface.handle);
    const frame = surface.frame;
    const b = itemBounds(it);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const s = toSpace(e.clientX, e.clientY, frame);
    const startAng = Math.atan2(s.y - cy, s.x - cx);
    const r0 = it.rotation || 0;
    const move = (ev) => {
      const p = toSpace(ev.clientX, ev.clientY, frame);
      let deg = r0 + ((Math.atan2(p.y - cy, p.x - cx) - startAng) * 180) / Math.PI;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      surface.handle.change((d) => { const o = d.items.find((x) => x.id === it.id); if (o) o.rotation = deg; });
    };
    const up = () => { endTxn(txn, "transform"); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  // drag an endpoint (or a line's bezier control point). for arrows, dropping an
  // end over a bindable shape attaches it there (snaps to that shape's facing
  // edge midpoint); off it → detach.
  function startSegEnd(which, e) {
    e.stopPropagation(); e.preventDefault();
    const it = single();
    if (!it || it.kind !== "shape" || (it.type !== "arrow" && it.type !== "line")) return;
    const isArrow = it.type === "arrow";
    const surface = active();
    const frame = surface.frame;
    const move = (ev) => {
      const p = toWorld(ev.clientX, ev.clientY);
      const [lx, ly] = worldToLocal(frame, p.x, p.y);
      const targetId = (isArrow && which !== "control" && !frame) ? bindAtWorld(p.x, p.y) : null;
      const target = targetId && rootItems().find((x) => x.id === targetId);
      const anchor = target ? worldAnchor(target, lx, ly) : null;
      setArrowHover(targetId);
      surface.handle.change((d) => {
        const o = d.items.find((x) => x.id === it.id);
        if (!o) return;
        if (which === "control") {
          // the handle is ON the curve; solve the quadratic control point so the
          // curve passes through the dragged point at its midpoint:
          // ¼S + ½C + ¼E = P  ⇒  C = 2P − ½S − ½E
          const gg = (o.fromId || o.toId) ? arrowGeometry(o, d.items) : { x: o.x, y: o.y, w: o.w, h: o.h };
          o.cx = 2 * lx - 0.5 * gg.x - 0.5 * (gg.x + gg.w);
          o.cy = 2 * ly - 0.5 * gg.y - 0.5 * (gg.y + gg.h);
          return;
        }
        const g = (o.fromId || o.toId) ? arrowGeometry(o, d.items) : { x: o.x, y: o.y, w: o.w, h: o.h };
        if (which === "start") {
          const ex = g.x + g.w, ey = g.y + g.h;
          o.x = lx; o.y = ly; o.w = ex - lx; o.h = ey - ly;
          if (isArrow) { if (targetId) { o.fromId = targetId; o.fromAnchor = anchor; } else { delete o.fromId; delete o.fromAnchor; } }
        } else {
          o.x = g.x; o.y = g.y; o.w = lx - g.x; o.h = ly - g.y;
          if (isArrow) { if (targetId) { o.toId = targetId; o.toAnchor = anchor; } else { delete o.toId; delete o.toAnchor; } }
        }
      });
    };
    const up = () => { setArrowHover(null); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  function reorder(mode) {
    if (!selected().length) return;
    transact(active().handle, "reorder", () => active().handle.change((d) => applyReorder(d.items, selected(), mode)));
  }

  // ---- behaviour brushes ---------------------------------------------
  // A `newspace:brush` may carry a `behavior` ({down,move,up}) instead of (or
  // besides) a passive `stroke`. Such a brush owns its whole gesture: we hand it
  // a context with the live pointer, the existing canvas geometry (in world
  // coords, for snapping), a screen-constant snap tolerance, and callbacks to
  // preview (setDraft), badge constraints (setGuides), and commit. See
  // constraint.js for the Sketchpad/Crosscut-style constraint-line brush.

  // existing geometry the brush can snap to — segments (lines/arrows) and the
  // points worth snapping to (segment ends, shape corners + centres), all world.
  function brushGeometry() {
    const segments = [], points = [];
    for (const it of rootItems()) {
      const b = itemBounds(it);
      if (it.kind === "sketch") {
        // sketch nodes are the prime snap targets — landing on one shares a pivot
        for (const n of it.nodes || []) points.push({ x: n.x, y: n.y, sketchId: it.id, nodeId: n.id });
        for (const bar of it.bars || []) {
          const a = (it.nodes || []).find((n) => n.id === bar.a), c = (it.nodes || []).find((n) => n.id === bar.b);
          if (a && c) segments.push({ x1: a.x, y1: a.y, x2: c.x, y2: c.y, id: it.id });
        }
        continue;
      }
      if (it.kind === "shape" && (it.type === "line" || it.type === "arrow")) {
        const cx = it.x + it.w / 2, cy = it.y + it.h / 2, a = rad(it.rotation || 0);
        const [e1x, e1y] = rot(it.x - cx, it.y - cy, a);
        const [e2x, e2y] = rot(it.x + it.w - cx, it.y + it.h - cy, a);
        const x1 = cx + e1x, y1 = cy + e1y, x2 = cx + e2x, y2 = cy + e2y;
        segments.push({ x1, y1, x2, y2, id: it.id });
        points.push({ x: x1, y: y1, id: it.id }, { x: x2, y: y2, id: it.id });
      } else if (it.kind !== "stroke") {
        points.push(
          { x: b.x, y: b.y }, { x: b.x + b.w, y: b.y },
          { x: b.x, y: b.y + b.h }, { x: b.x + b.w, y: b.y + b.h },
          { x: b.x + b.w / 2, y: b.y + b.h / 2 },
        );
      }
    }
    return { segments, points };
  }

  function brushCtx(g, e, p) {
    return {
      p, start: g.start, event: e, state: g.state,
      brush: { color: brush.color, size: brush.size, roughness: brush.roughness, bowing: brush.bowing },
      geometry: g.geometry || (g.geometry = brushGeometry()),
      tol: 12 / (cam().z || 1), // snap radius: ~12 screen px, constant on screen
      setDraft, setGuides, uid, history,
      items: rootItems(),
      // mutate the surface the gesture started on (root for v1 behaviour brushes)
      change: (fn) => { const h = rootLayoutH(); if (h) h.change((d) => fn(d.items, d)); },
      commit: (item) => { if (item) pushItem(g.targetFrame, item); },
    };
  }
  function callBrush(phase, g, e, p) {
    const fn = g.mod?.behavior?.[phase];
    if (fn) fn(brushCtx(g, e, p));
  }

  // viewport-local screen coords (ns-root origin), matching the .ns-end handles
  const localXY = (e) => { const r = viewportRef.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // resolve the dragged port → an opstream, then either rewire an editor it was
  // dropped on, or place a matching editor on empty canvas wired to it.
  const finishWire = (g, e) => dropWire(g.port, e.clientX, e.clientY);

  // resolve a dropped port → an opstream, then rewire a matching editor or place one.
  // Works for pointer-drops (canvas-own ports) AND HTML5 drops (a `dataTransfer`
  // port from an embedded tool across an iframe boundary — e.g. a Form field grip).
  async function dropWire(port, clientX, clientY) {
    const api = element?.api;
    if (!port) return;
    const wiring = portWiring(port);
    let stream;
    if (port.kind === "context") {
      stream = context[port.name]; // a context outlet's opstream IS the Source
    } else if (port.kind === "peer") {
      stream = peerStream(port.contactUrl, port.part);
    } else {
      if (!api) return;
      const frag = port.path && port.path.length ? "#" + port.path.join("/") : "";
      try { stream = await api.find(port.url + frag); } catch (err) { return console.warn("[sketchy] wire: find failed", err); }
    }
    if (!stream) return;
    const type = streamType(stream);

    // dropped on an existing editor item → rewire its first matching inlet
    const el = document.elementFromPoint(clientX, clientY);
    const editorEl = el && el.closest && el.closest(".ns-editor[data-item-id]");
    if (editorEl) {
      const id = editorEl.getAttribute("data-item-id");
      const item = rootItems().find((x) => x.id === id);
      const descriptor = item && listEditors().find((d) => d.id === item.editorId);
      const inlet = descriptor && firstMatchingInlet(descriptor, type);
      if (item && inlet) {
        transact(active().handle, "wire", () => active().handle.change((dd) => {
          const o = dd.items.find((x) => x.id === id);
          if (o) { if (!o.inlets) o.inlets = {}; o.inlets[inlet.name] = wiring; }
        }));
      }
      return;
    }

    // empty canvas. A USER-STATE source (context/peer) → a LOCAL floating inspector
    // on the top layer (not the shared doc — it's this viewer's state).
    if (port.kind === "context" || port.kind === "peer") {
      const r = viewportRef.getBoundingClientRect();
      addFloat(wiring, clientX - r.left, clientY - r.top);
      return;
    }

    // a DOC field → a shared editor item placed on the canvas
    const candidates = editorsForStream(listEditors(), stream);
    if (!candidates.length) return console.warn("[sketchy] wire: no editor accepts", type);
    const p = toWorld(clientX, clientY);
    const place = (descriptor) => {
      const inlet = firstMatchingInlet(descriptor, type);
      pushItem(frameAtWorld(p.x, p.y), makeEditorItem({
        id: "ed-" + uid(), editorId: descriptor.id, x: p.x, y: p.y,
        inlets: inlet ? { [inlet.name]: wiring } : {},
      }));
    };
    if (candidates.length === 1) return place(candidates[0]);
    // several match → a little chooser at the drop point
    const r = viewportRef.getBoundingClientRect();
    setEditorChooser({ x: clientX - r.left, y: clientY - r.top, candidates, place });
  }

  // WIRE tool: grab a PORT (a data-automerge-* element). A document-level CAPTURE
  // listener so it fires BEFORE an embedded tool / a box's `grab` can
  // stopPropagation; we walk composedPath() so the real port element is found even
  // when the event is retargeted at an embedded-tool boundary.
  function onPointerDownCapture(e) {
    if (e.button !== 0 || tool() !== "wire") return;
    const path = (e.composedPath && e.composedPath()) || [e.target];
    if (viewportRef && !path.includes(viewportRef)) return; // not this canvas
    let port = null;
    for (const el of path) {
      if (el && el.nodeType === 1) { port = readPort(el); if (port) break; } // context OR automerge port
    }
    if (!port) return;
    e.preventDefault();
    e.stopPropagation(); // claim it: the embedded tool / grab must not also act
    gesture = { kind: "wire", port };
    const a = localXY(e);
    setWireDraft({ from: a, to: a });
    beginGesture(e);
  }

  // ---- canvas-level gestures (root surface) ---------------------------
  function onPointerDown(e) {
    if (e.button === 1 || (e.button === 0 && tool() === "hand")) return startPan(e);
    if (e.button !== 0) return;
    // clicking anywhere off a focused editor (text item OR a box/doc title
    // rename) commits it — we preventDefault on gesture starts, which would
    // otherwise swallow the native blur
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA") && ae !== e.target && !(e.target.closest && e.target.closest("input, textarea"))) ae.blur();
    const t = tool();
    if (e.target.closest) {
      // an embedded tool (a doc body, not a box canvas) owns its presses
      if (e.target.closest(".ns-doc-body:not(.ns-frame-body)")) return;
      // a box's inner canvas isn't empty space — don't marquee/move there in
      // select mode (drawing tools still pass through to draw inside the box)
      if (t === "select" && e.target.closest(".ns-frame-body")) return;
    }
    const p = toWorld(e.clientX, e.clientY);
    if (t === "select") {
      if (!e.shiftKey) setSelected([]);
      setEnteredGroup(null); // clicking empty canvas exits a group
      setActiveId("root");
      gesture = { kind: "marquee", x0: p.x, y0: p.y, add: selected() };
      setDraft({ kind: "marquee", x: p.x, y: p.y, w: 0, h: 0 });
    } else if (t === "pen" || isBrushTool(t)) {
      const mod = brushMods.get(t);
      if (mod?.behavior) {
        // a behaviour brush owns its gesture (e.g. constraint lines)
        gesture = { kind: "brush", mod, targetFrame: frameAtWorld(p.x, p.y), start: { x: p.x, y: p.y }, state: {}, txn: beginTxn(rootLayoutH()) };
        callBrush("down", gesture, e, p);
        beginGesture(e);
        return;
      }
      const bs = mod?.stroke; // a custom brush (e.g. highlighter)
      gesture = { kind: "pen", targetFrame: frameAtWorld(p.x, p.y) };
      setDraft({ kind: "stroke", points: [[p.x, p.y, e.pressure || 0.5]], color: brush.color, size: bs?.size || brush.size, opacity: bs?.opacity, blend: bs?.blend, thinning: bs?.thinning });
    } else if (SHAPE_TOOLS.has(t)) {
      gesture = { kind: "shape", targetFrame: frameAtWorld(p.x, p.y) };
      setDraft({ kind: "shape", type: t, x: p.x, y: p.y, w: 0, h: 0, color: brush.color, fill: (t === "line" || t === "arrow") ? "none" : brush.fill, strokeWidth: brush.size, roughness: brush.roughness, bowing: brush.bowing, fillStyle: brush.fillStyle, strokeStyle: brush.strokeStyle, corner: brush.corner, startArrow: brush.startArrow, endArrow: brush.endArrow, seed: rndSeed() });
    } else if (t === "place" || t === "box") {
      // box is just a "place" of a folder named "Box" — same draw-a-rect gesture
      gesture = { kind: "place", box: t === "box" };
      setDraft({ kind: "place", x: p.x, y: p.y, w: 0, h: 0 });
    } else if (t === "text") {
      // click = point text; drag = a fixed-width text box (decided on pointerup)
      gesture = { kind: "text", targetFrame: frameAtWorld(p.x, p.y), x0: p.x, y0: p.y };
      setDraft({ kind: "place", x: p.x, y: p.y, w: 0, h: 0 });
    } else { return; }
    beginGesture(e);
  }

  // start a fresh, empty text item (excalidraw-style): no fixed box, it grows to
  // fit; a blank one removes itself on blur (see InlineEdit / the text item).
  function createTextAt(p) {
    const fs = brush.fontSize || 20;
    pushItem(frameAtWorld(p.x, p.y), { kind: "text", x: p.x, y: p.y - fs * 0.6, w: 8, h: fs * 1.4, text: "", color: brush.color, font: brush.font, fontSize: fs, rotation: 0 }, { edit: true });
  }
  // a drawn text box: wraps at the dragged width, grows downward as you type
  function createTextBox(targetFrame, x, y, w, h) {
    const fs = brush.fontSize || 20;
    pushItem(targetFrame, { kind: "text", wrap: true, x, y, w: Math.max(w, 40), h: Math.max(h, fs * 1.4), text: "", color: brush.color, font: brush.font, fontSize: fs, rotation: 0 }, { edit: true });
  }

  // double-clicking empty canvas drops you straight into a text item
  function onCanvasDblClick(e) {
    if (tool() !== "select") return;
    if (e.target.closest(".ns-mark, .ns-text-item, .ns-doc, .ns-hit, .ns-handle, .ns-toolbar, .ns-props, .ns-minimap")) return;
    createTextAt(toWorld(e.clientX, e.clientY));
  }

  function beginGesture(e) { e.preventDefault(); window.addEventListener("pointermove", onPointerMove); window.addEventListener("pointerup", onPointerUp); }
  function startPan(e) { setFollowing(null); const s = cam(); gesture = { kind: "pan", sx: e.clientX, sy: e.clientY, cx: s.x, cy: s.y }; beginGesture(e); }

  function onPointerMove(e) {
    if (!gesture) return;
    const k = gesture.kind;
    if (k === "pan") { setCam((c) => ({ ...c, x: gesture.cx + (e.clientX - gesture.sx), y: gesture.cy + (e.clientY - gesture.sy) })); return; }
    if (k === "wire") { setWireDraft((w) => (w ? { ...w, to: localXY(e) } : w)); return; }
    const p = toWorld(e.clientX, e.clientY);
    if (k === "brush") return callBrush("move", gesture, e, p);
    if (k === "pen") setDraft((d) => ({ ...d, points: [...d.points, [p.x, p.y, e.pressure || 0.5]] }));
    else if (k === "shape" || k === "place" || k === "text") setDraft((d) => ({ ...d, w: p.x - d.x, h: p.y - d.y }));
    else if (k === "marquee") setDraft((d) => ({ ...d, w: p.x - gesture.x0, h: p.y - gesture.y0 }));
    else if (k === "move") {
      const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
      const [ldx, ldy] = rot(dx, dy, -rad(gesture.fr));
      gesture.surface.handle.change((d) => {
        for (const id of gesture.ids) {
          const o = d.items.find((x) => x.id === id); const og = gesture.orig[id];
          if (!o || !og) continue;
          if (o.kind === "stroke") for (let i = 0; i < o.points.length; i++) { o.points[i][0] = og.points[i][0] + ldx; o.points[i][1] = og.points[i][1] + ldy; }
          else if (o.kind === "sketch") for (let i = 0; i < o.nodes.length; i++) { o.nodes[i].x = og.nodes[i].x + ldx; o.nodes[i].y = og.nodes[i].y + ldy; }
          else { o.x = og.x + ldx; o.y = og.y + ldy; if (og.cx != null) { o.cx = og.cx + ldx; o.cy = og.cy + ldy; } }
        }
      });
      setDropTarget(gesture.ids.length === 1 ? moveDropTarget(gesture.surface, gesture.ids[0]) : null);
      // un-clip a box ONLY once the dragged child's CENTRE has actually left it
      // (dropping there would put it outside) — so while it's still inside it
      // stays clipped, and you feel it cross the edge
      setEscapeId(gesture.surface.frame && gesture.ids.length === 1 && childLeavingBox(gesture.surface, gesture.ids[0]) ? gesture.ids[0] : null);
    }
  }

  function onPointerUp(e) {
    const g = gesture; gesture = null;
    setDropTarget(null); setEscapeId(null);
    window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp);
    if (!g) return;
    if (g.kind === "wire") { setWireDraft(null); finishWire(g, e); return; }
    if (g.kind === "brush") { callBrush("up", g, e, toWorld(e.clientX, e.clientY)); endTxn(g.txn, "brush"); setGuides(null); setDraft(null); return; }
    const d = draft();
    if (g.kind === "pen" && d && d.points.length > 1) {
      const s = { kind: "stroke", points: d.points, color: d.color, size: d.size, rotation: 0 };
      if (d.opacity != null) s.opacity = d.opacity; // brush extras (highlighter), omitted when absent
      if (d.blend) s.blend = d.blend;
      if (d.thinning != null) s.thinning = d.thinning;
      pushItem(g.targetFrame, s);
    }
    else if (g.kind === "shape") {
      if (d && Math.hypot(d.w, d.h) > 4) {
        const extra = {};
        // an arrow drawn at the root binds its ends to whatever shapes/docs they
        // land on, so moving those shapes drags the arrow with them
        if (d.type === "arrow" && !g.targetFrame) {
          const fromId = bindAtWorld(d.x, d.y);
          const toId = bindAtWorld(d.x + d.w, d.y + d.h);
          if (fromId) { const fi = rootItems().find((x) => x.id === fromId); extra.fromId = fromId; if (fi) extra.fromAnchor = worldAnchor(fi, d.x, d.y); }
          if (toId && toId !== fromId) { const ti = rootItems().find((x) => x.id === toId); extra.toId = toId; if (ti) extra.toAnchor = worldAnchor(ti, d.x + d.w, d.y + d.h); }
        }
        pushItem(g.targetFrame, { kind: "shape", type: d.type, x: d.x, y: d.y, w: d.w, h: d.h, color: d.color, fill: d.fill, strokeWidth: d.strokeWidth, roughness: d.roughness, bowing: d.bowing, fillStyle: d.fillStyle, strokeStyle: d.strokeStyle, corner: d.corner, startArrow: d.startArrow, endArrow: d.endArrow, seed: d.seed, rotation: 0, ...extra });
      }
      setTool("select"); // every tool but pen/eraser snaps back to the pointer
    }
    else if (g.kind === "place" && d) {
      let { x, y, w, h } = d;
      if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
      if (w < 40 || h < 40) { w = 360; h = 280; }
      if (g.box) createDocAt("folder", x, y, w, h, "Box");
      else { const dt = placing(); if (dt) createDocAt(dt.id, x, y, w, h); }
      setPlacing(null); setTool("select");
    } else if (g.kind === "text") {
      // a real drag → fixed-width text box; a click → point text
      if (d && Math.hypot(d.w, d.h) > 12) {
        let { x, y, w, h } = d;
        if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
        createTextBox(g.targetFrame, x, y, w, h);
      } else createTextAt({ x: g.x0, y: g.y0 });
      setTool("select");
    } else if (g.kind === "marquee" && d) selectInRect(d.x, d.y, d.x + d.w, d.y + d.h, g.add);
    else if (g.kind === "move") {
      // released OUTSIDE the canvas while moving doc(s): hand them to whatever's
      // under the pointer (the sideboard, say) and snap them back — so a normal
      // move that wanders off the edge becomes a drag-out, no separate handle
      const r = e && viewportRef ? viewportRef.getBoundingClientRect() : null;
      const outside = r && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
      const links = outside ? selectedDocLinks(g.surface) : [];
      if (links.length) {
        dropToExternal(e.clientX, e.clientY, links);
        g.surface.handle.change((dd) => { for (const id of g.ids) { const o = dd.items.find((x) => x.id === id); const og = g.orig[id]; if (!o || !og) continue; if (o.kind === "stroke") { for (let i = 0; i < o.points.length; i++) { o.points[i][0] = og.points[i][0]; o.points[i][1] = og.points[i][1]; } } else if (o.kind === "sketch") { for (let i = 0; i < o.nodes.length; i++) { o.nodes[i].x = og.nodes[i].x; o.nodes[i].y = og.nodes[i].y; } } else { o.x = og.x; o.y = og.y; } } });
      } else if (selected().length === 1) maybeReparent(g.surface, selected()[0]);
      if (!links.length) endTxn(g.txn, "move"); // record the move for undo (in-surface moves; revert/drag-out are no-ops)
    }
    setDraft(null);
  }

  function selectInRect(x0, y0, x1, y1, add) {
    const hit = itemsInRect(rootItems(), x0, y0, x1, y1);
    setSelected(expandGroups([...new Set([...(add || []), ...hit])]));
  }

  // which root frame a moving item would drop INTO (null if none / already there)
  // is the child's CENTRE outside its box (so a drop here lands it at root)?
  function childLeavingBox(srcSurface, id) {
    const f = srcSurface.frame; if (!f) return false;
    const it = srcSurface.doc.items.find((x) => x.id === id); if (!it) return false;
    const b = itemBounds(it), cx = b.x + b.w / 2, cy = b.y + b.h / 2; // box-local centre
    return cx < 0 || cx > f.w || cy < 0 || cy > f.h;
  }
  function moveDropTarget(srcSurface, id) {
    const it = srcSurface.doc.items.find((x) => x.id === id);
    if (!it) return null;
    const b = itemBounds(it);
    const [wx, wy] = localToWorld(srcSurface.frame, b.x + b.w / 2, b.y + b.h / 2);
    const tf = frameAtWorld(wx, wy, id);
    if (!tf) return null;
    if (it.kind === "frame" && tf.url === it.url) return null;
    if ((srcSurface.frame ? srcSurface.frame.id : "root") === tf.id) return null;
    return tf.id;
  }

  // move an item between docs when it's dragged into / out of a frame
  async function maybeReparent(srcSurface, id) {
    const it = srcSurface.doc.items.find((x) => x.id === id);
    if (!it) return;
    const b = itemBounds(it);
    const [wx, wy] = localToWorld(srcSurface.frame, b.x + b.w / 2, b.y + b.h / 2);
    const targetFrame = frameAtWorld(wx, wy, id);
    if (targetFrame && it.kind === "frame" && targetFrame.url === it.url) return; // a box can't go inside itself
    const srcId = srcSurface.frame ? srcSurface.frame.id : "root";
    const dstId = targetFrame ? targetFrame.id : "root";
    if (srcId === dstId) return;
    let dstLayout = rootLayoutH(), dstFolder = handle, dstFrame = null;
    if (targetFrame) { const s = await loadSpace(targetFrame.url); if (!s) return; dstLayout = s.layoutHandle; dstFolder = s.folderHandle; dstFrame = targetFrame; }
    const clone = cloneItem(it);
    const [nlx, nly] = worldToLocal(dstFrame, wx, wy);
    const dx = nlx - (b.x + b.w / 2), dy = nly - (b.y + b.h / 2);
    const dr = (srcSurface.frame ? srcSurface.frame.rotation || 0 : 0) - (dstFrame ? dstFrame.rotation || 0 : 0);
    if (clone.kind === "stroke") for (let i = 0; i < clone.points.length; i++) { clone.points[i][0] += dx; clone.points[i][1] += dy; }
    else { clone.x += dx; clone.y += dy; if (clone.cx != null) { clone.cx += dx; clone.cy += dy; } } // carry a bent arrow's control point
    clone.rotation = (clone.rotation || 0) + dr;
    // a doc/frame's folder link travels with it (to the destination FOLDER doc)
    const srcLink = (it.kind === "doc" || it.kind === "frame") ? srcSurface.folderDoc.docs.find((l) => l.url === it.url) : null;
    const linkCopy = srcLink ? { name: srcLink.name, type: srcLink.type, url: srcLink.url } : null;
    // src: drop the link FIRST (so reconcile can't recreate the shape), then the shape
    if (linkCopy) srcSurface.folderHandle.change((dd) => { const di = dd.docs.findIndex((l) => l.url === it.url); if (di >= 0) dd.docs.splice(di, 1); });
    srcSurface.handle.change((dd) => { const i = dd.items.findIndex((x) => x.id === id); if (i >= 0) dd.items.splice(i, 1); });
    // dst: add the shape FIRST, then the link (so reconcile sees the shape and doesn't duplicate)
    dstLayout.change((dd) => { if (!itemPresent(dd.items, id)) dd.items.push(clone); });
    if (linkCopy) dstFolder.change((dd) => { if (!dd.docs.some((l) => l.url === linkCopy.url)) dd.docs.push(linkCopy); });
    setActiveId(dstId);
    setSelected([id]);
  }

  // a pan/zoom in flight: keep it alive (overlay captures wheel) until ~60ms idle
  let panTimer;
  function bumpPan() { setPanActive(true); clearTimeout(panTimer); panTimer = setTimeout(() => setPanActive(false), 60); }
  // zoom around the viewport centre (keyboard = / -)
  function zoomBy(factor) {
    if (!viewportRef) return;
    setFollowing(null);
    setCam(zoomAt(cam(), factor, viewportRef.offsetWidth / 2, viewportRef.offsetHeight / 2));
  }
  function onWheel(e) {
    // a wheel that STARTS over an embedded tool (and we're not mid-pan) scrolls
    // the tool; once a pan is underway the overlay captures, so it keeps panning
    // even when the cursor wanders over a tool
    if (!e.ctrlKey && !panActive() && e.target.closest && e.target.closest(".ns-doc-body:not(.ns-frame-body)")) return;
    e.preventDefault();
    setFollowing(null);
    bumpPan();
    const c = cam();
    if (e.ctrlKey) {
      const r = viewportRef.getBoundingClientRect();
      const k = viewportRef.offsetWidth ? r.width / viewportRef.offsetWidth : 1;
      const px = (e.clientX - r.left) / k, py = (e.clientY - r.top) / k;
      const nz = clamp(c.z * Math.exp(-e.deltaY * 0.01), 0.15, 8);
      const wx = (px - c.x) / c.z, wy = (py - c.y) / c.z;
      setCam({ z: nz, x: px - wx * nz, y: py - wy * nz });
    } else setCam({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY });
  }

  // ---- documents (root) ------------------------------------------------
  async function createDocAt(datatypeId, x, y, w, h, name) {
    try {
      const reg = getRegistry("patchwork:datatype");
      const datatype = await reg.load(datatypeId);
      if (!datatype) throw new Error("no datatype " + datatypeId);
      const child = await createDocOfDatatype2(datatype, repo);
      const url = child.url;
      if (name) { try { child.change((d) => { const st = datatype.setTitle || datatype.module?.setTitle; if (st) st(d, name); else d.title = name; }); } catch {} }
      const layout = rootLayoutH();
      if (!layout) return;
      const isFrame = isBoxType(datatypeId);
      // push the item FIRST (idempotent) so the docs→items reconcile, which
      // fires when we add the folder link, sees it and doesn't duplicate. The id
      // is DETERMINISTIC from the url so another viewer's reconcile makes the
      // same id (then de-dupes), rather than a second item.
      const id = linkItemId(url);
      layout.change((d) => {
        if (d.items.some((x) => x.url === url)) return;
        if (isFrame) d.items.push({ id, kind: "frame", url, x, y, w: Math.max(w, 200), h: Math.max(h, 160) });
        else d.items.push({ id, kind: "doc", url, x, y, w, h, rotation: 0, toolId: "" });
      });
      handle.change((d) => { if (!d.docs.some((l) => l.url === url)) d.docs.push({ name: name || datatype.name || datatypeId, type: datatypeId, url }); });
    } catch (e) { console.error("[newspace] createDocAt", e); }
  }
  function selectPlacing(dt) { setPlacing(dt); setTool("place"); setAddOpen(false); }
  function linkFor(url) { return folderDoc.docs.find((l) => l.url === url); }

  const DND_TYPES = ["text/x-patchwork-dnd", "text/x-patchwork-urls", "text/uri-list", "text/plain"];
  const hasDocDrag = (dt) => !!dt && (DND_TYPES.some((t) => dt.types.includes(t)) || dt.types.includes("Files"));
  function parseDrop(dt) {
    if (!dt) return [];
    const raw = dt.getData("text/x-patchwork-dnd");
    if (raw) { try { const p = JSON.parse(raw); if (Array.isArray(p?.items)) return p.items.filter((i) => i.url); } catch {} }
    const urls = dt.getData("text/x-patchwork-urls");
    if (urls) { try { const u = JSON.parse(urls); if (Array.isArray(u)) return u.map((url) => ({ url })); } catch {} }
    const text = dt.getData("text/uri-list") || dt.getData("text/plain") || "";
    return text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((s) => { if (s.startsWith("automerge:")) return { url: s }; const m = s.match(/#doc=([^&\s]+)/); return m ? { url: `automerge:${m[1]}` } : null; }).filter(Boolean);
  }
  // synthesize a native DnD drop on whatever's under the pointer (e.g. the
  // sideboard) — used when a doc is dragged out past the canvas edge. Carries the
  // patchwork link(s) in the formats the sideboard reads.
  function dropToExternal(clientX, clientY, links) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el || viewportRef.contains(el)) return false;
    const dt = new DataTransfer();
    const urls = links.map((l) => l.url);
    dt.setData("text/x-patchwork-dnd", JSON.stringify({ items: links }));
    dt.setData("text/x-patchwork-urls", JSON.stringify(urls));
    dt.setData("text/uri-list", urls.join("\n"));
    dt.setData("text/plain", urls.join("\n"));
    const opts = { bubbles: true, cancelable: true, composed: true, clientX, clientY, dataTransfer: dt };
    el.dispatchEvent(new DragEvent("dragenter", opts));
    el.dispatchEvent(new DragEvent("dragover", opts));
    el.dispatchEvent(new DragEvent("drop", opts));
    return true;
  }
  // the patchwork link payload for the selected doc/frame items in a surface
  function selectedDocLinks(surface) {
    return selected().map((id) => surface.doc.items.find((x) => x.id === id))
      .filter((o) => o && (o.kind === "doc" || o.kind === "frame"))
      .map((o) => { const l = surface.folderDoc?.docs.find((ll) => ll.url === o.url); return { url: o.url, name: l?.name || "", type: l?.type || (o.kind === "frame" ? "folder" : "") }; });
  }

  // create a shape/face/brush dragged off the toolbar, centred on the drop point
  const TOOL_DRAG = "text/x-newspace-tool";
  // drop a multi-stroke stamp (cat face, pencil, mitten, mouse) centred on `p`,
  // scaled up, as freehand pencil strokes
  function dropStamp(id, p) {
    const stamp = STAMPS[id];
    if (!stamp) return;
    const tf = frameAtWorld(p.x, p.y);
    const scale = 1.8;
    const sampled = stamp.paths.map((d) => sampleSvgPath(d));
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const s of sampled) for (const [x, y] of s) { minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); }
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    const gid = "g" + uid(); // a stamp's strokes are grouped, so it moves as one
    const turn = id === "mouse" ? -Math.PI / 2 : 0; // the mouse drops rotated left 90°
    for (const s of sampled) {
      if (s.length < 2) continue;
      const points = s.map(([x, y]) => { const [dx, dy] = rot((x - cx) * scale, (y - cy) * scale, turn); return [p.x + dx, p.y + dy, 0.5]; });
      pushItem(tf, { kind: "stroke", points, color: brush.color, size: brush.size, rotation: 0, group: gid });
    }
  }
  function dropToolAt(id, p) {
    const tf = frameAtWorld(p.x, p.y);
    if (STAMP_IDS.has(id)) return dropStamp(id, p);
    if (!SHAPE_TOOLS.has(id)) { setTool(id); return; } // a brush etc — just arm it
    const base = { kind: "shape", type: id, color: brush.color, fill: (id === "line" || id === "arrow") ? "none" : brush.fill, strokeWidth: brush.size, roughness: brush.roughness, bowing: brush.bowing, fillStyle: brush.fillStyle, strokeStyle: brush.strokeStyle, corner: brush.corner, seed: rndSeed(), rotation: 0 };
    if (id === "line" || id === "arrow") pushItem(tf, { ...base, x: p.x - 70, y: p.y, w: 140, h: 0 });
    else pushItem(tf, { ...base, x: p.x - 70, y: p.y - 50, w: 140, h: 100 });
  }

  // dropEffect must be in the drag's effectAllowed (sideboard uses "copyMove"),
  // else the browser rejects the drop and the drop event never fires
  function onDragOver(e) { if (!e.dataTransfer.types.includes(TOOL_DRAG) && !hasDocDrag(e.dataTransfer) && !e.dataTransfer.types.includes("application/sketchy-port")) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
  async function onDrop(e) {
    // a PORT dragged from an embedded tool (HTML5 DnD crosses the iframe boundary
    // that pointer events can't) — e.g. a Form field grip → wire it.
    const portData = e.dataTransfer.getData("application/sketchy-port");
    if (portData) {
      e.preventDefault();
      try { dropWire(JSON.parse(portData), e.clientX, e.clientY); } catch (err) { console.warn("[sketchy] port drop", err); }
      return;
    }
    if (e.dataTransfer.types.includes(TOOL_DRAG)) {
      e.preventDefault();
      const id = e.dataTransfer.getData(TOOL_DRAG);
      if (id) dropToolAt(id, toWorld(e.clientX, e.clientY));
      return;
    }
    if (!hasDocDrag(e.dataTransfer)) return;
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    // drop INTO the box under the cursor, if any (else the root surface)
    const tf = frameAtWorld(p.x, p.y);
    let layout = rootLayoutH(), folder = handle, frame = null;
    if (tf) { const s = await loadSpace(tf.url); if (s) { layout = s.layoutHandle; folder = s.folderHandle; frame = tf; } }
    if (!layout) return;
    const at = (i) => { const [lx, ly] = worldToLocal(frame, p.x + i * 24, p.y + i * 24); return { x: lx, y: ly }; };
    const files = e.dataTransfer.files;
    if (files && files.length) {
      let i = 0;
      for (const file of files) {
        if (!file.type.startsWith("image/")) continue;
        const buf = new Uint8Array(await file.arrayBuffer());
        const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
        const child = await repo.create2({ "@patchwork": { type: "file" }, content: buf, extension: ext, mimeType: file.type, name: file.name || `image.${ext}` });
        const pos = at(i);
        layout.change((d) => { if (!d.items.some((x) => x.url === child.url)) d.items.push({ id: linkItemId(child.url), kind: "doc", url: child.url, x: pos.x, y: pos.y, w: 320, h: 240, rotation: 0, toolId: "" }); });
        folder.change((d) => { if (!d.docs.some((l) => l.url === child.url)) d.docs.push({ name: file.name || `image.${ext}`, type: "file", url: child.url }); });
        i++;
      }
      return;
    }
    const fresh = parseDrop(e.dataTransfer).filter((it) => !(layout.doc().items || []).some((x) => x.url === it.url));
    layout.change((d) => {
      fresh.forEach((it, i) => {
        if (d.items.some((x) => x.url === it.url)) return;
        const pos = at(i);
        const base = { id: linkItemId(it.url), url: it.url, x: pos.x, y: pos.y, w: 360, h: 280 };
        if (isBoxType(it.type)) d.items.push({ ...base, kind: "frame" });
        else d.items.push({ ...base, kind: "doc", rotation: 0, toolId: "" });
      });
    });
    folder.change((d) => { for (const it of fresh) if (!d.docs.some((l) => l.url === it.url)) d.docs.push({ name: it.name || "Document", type: it.type || "", url: it.url }); });
  }

  async function onPaste(e) {
    if (isTypingTarget(e.target)) return;
    const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const name = `Pasted image.${ext}`;
    const child = await repo.create2({ "@patchwork": { type: "file" }, content: buf, extension: ext, mimeType: file.type, name });
    const r = viewportRef.getBoundingClientRect();
    const c = cam();
    const layout = rootLayoutH();
    if (!layout) return;
    layout.change((d) => { if (!d.items.some((x) => x.url === child.url)) d.items.push({ id: linkItemId(child.url), kind: "doc", url: child.url, x: (r.width / 2 - c.x) / c.z - 160, y: (r.height / 2 - c.y) / c.z - 120, w: 320, h: 240, rotation: 0, toolId: "" }); });
    handle.change((d) => { if (!d.docs.some((l) => l.url === child.url)) d.docs.push({ name, type: "file", url: child.url }); });
  }

  function onKeyDown(e) {
    // Escape always works (even while an embedded tool has focus): blur it,
    // drop selection, back to the pointer
    if (e.key === "Escape") { const a = document.activeElement; if (a && a.blur) a.blur(); if (enteredGroup()) { setEnteredGroup(null); return; } setSelected([]); setPlacing(null); setTool("select"); return; }
    // group / ungroup + undo / redo (work even with an embedded tool focused)
    if ((e.metaKey || e.ctrlKey) && (e.key === "g" || e.key === "G")) { e.preventDefault(); if (e.shiftKey) ungroupSelected(); else groupSelected(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) history.redo(); else history.undo(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === "y" || e.key === "Y")) { e.preventDefault(); history.redo(); return; }
    if (isTypingTarget(e.target)) return;
    if ((e.key === "Backspace" || e.key === "Delete") && selected().length) { e.preventDefault(); return deleteSelected(); }
    // bare z = undo, shift-z = redo; = / - zoom
    if (e.key === "z") { history.undo(); return; }
    if (e.key === "Z") { history.redo(); return; }
    if (e.key === "=" || e.key === "+") { zoomBy(1.2); return; }
    if (e.key === "-" || e.key === "_") { zoomBy(1 / 1.2); return; }
    if (e.key === "]") return reorder("forward");
    if (e.key === "[") return reorder("backward");
    // number row 1..9 selects the toolbar tools in order, alongside the letters
    const order = ["select", "hand", "pen", "eraser", "rectangle", "ellipse", "arrow", "text", "box"];
    if (/^[1-9]$/.test(e.key)) { const t = order[+e.key - 1]; if (t) { setTool(t); return; } }
    const map = { v: "select", h: "hand", p: "pen", r: "rectangle", o: "ellipse", l: "line", a: "arrow", t: "text", f: "box", e: "eraser", w: "wire" };
    if (map[e.key]) { const t = map[e.key]; setTool(t); if (t === "line" || t === "box") setExtraShape(t); } // overflow tools surface into the bar
  }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("paste", onPaste);
  // wire-tool port grab — document capture so embedded tools can't swallow it
  document.addEventListener("pointerdown", onPointerDownCapture, true);
  onCleanup(() => document.removeEventListener("pointerdown", onPointerDownCapture, true));
  // wire-from-embed: an embedded tool (e.g. the Form) owns its drag and announces it
  // via COMPOSED custom events that bubble out to us — robust across embed boundaries.
  const clientToLocal = (cx, cy) => { const r = viewportRef.getBoundingClientRect(); return { x: cx - r.left, y: cy - r.top }; };
  const ownsEvent = (e) => { const p = (e.composedPath && e.composedPath()) || []; return !viewportRef || p.includes(viewportRef); };
  const onWireFrom = (e) => { if (!ownsEvent(e)) return; const a = clientToLocal(e.detail.clientX, e.detail.clientY); setWireDraft({ from: a, to: a }); };
  const onWireMove = (e) => setWireDraft((w) => (w ? { ...w, to: clientToLocal(e.detail.clientX, e.detail.clientY) } : w));
  const onWireDropEvt = (e) => { if (!ownsEvent(e)) return; setWireDraft(null); if (e.detail && e.detail.port) dropWire(e.detail.port, e.detail.clientX, e.detail.clientY); };
  document.addEventListener("sketchy:wire-from", onWireFrom);
  document.addEventListener("sketchy:wire-move", onWireMove);
  document.addEventListener("sketchy:wire-drop", onWireDropEvt);
  onCleanup(() => {
    document.removeEventListener("sketchy:wire-from", onWireFrom);
    document.removeEventListener("sketchy:wire-move", onWireMove);
    document.removeEventListener("sketchy:wire-drop", onWireDropEvt);
  });
  const bumpTheme = () => setThemeTick((t) => t + 1);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener?.("change", bumpTheme);
  const themeObserver = new MutationObserver(bumpTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "theme", "data-theme", "style"] });
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown); window.removeEventListener("paste", onPaste);
    window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp);
    mq.removeEventListener?.("change", bumpTheme); themeObserver.disconnect();
  });

  createEffect(() => { if (tool() !== "select") { setSelected([]); setEditingId(null); } });
  createEffect(() => {
    if (!addOpen() && !shapeMenuOpen()) return;
    const close = (e) => { if (!e.target.closest || !e.target.closest(".ns-add-wrap")) { setAddOpen(false); setShapeMenuOpen(false); } };
    window.addEventListener("pointerdown", close, true);
    onCleanup(() => window.removeEventListener("pointerdown", close, true));
  });
  // every folder link gets one doc/frame item in the layout doc (root surface)
  createEffect(() => {
    const layout = rootLayoutH();
    if (!layout) return;
    const items = rootItems();
    const missing = linksNeedingItems(folderDoc.docs, items, (u) => tombstones.has(u));
    if (!missing.length) return;
    const c = cam();
    const r = viewportRef?.getBoundingClientRect();
    const bx = r ? (r.width / 2 - c.x) / c.z : 0, by = r ? (r.height / 2 - c.y) / c.z : 0;
    layout.change((d) => {
      let i = 0;
      for (const l of missing) {
        if (d.items.some((it) => it.url === l.url)) continue;
        const id = linkItemId(l.url); // deterministic → two peers create the same id, not two
        if (isBoxType(l.type)) d.items.push({ id, kind: "frame", url: l.url, x: bx + i * 28, y: by + i * 28, w: 360, h: 280 });
        else d.items.push({ id, kind: "doc", url: l.url, x: bx + i * 28, y: by + i * 28, w: 360, h: 280, rotation: 0, toolId: "" });
        i++;
      }
    });
  });

  // de-dup the root layout: two peers reconciling the same new link both push a
  // (now identically-id'd) item — collapse them to one. By ID, so intentional
  // alt-drag copies (same url, unique id) survive.
  createEffect(() => {
    const layout = rootLayoutH(); if (!layout) return;
    const dup = duplicateItemIds(rootItems());
    if (dup.length) layout.change((d) => { for (let k = dup.length - 1; k >= 0; k--) d.items.splice(dup[k], 1); });
  });

  // ---- presence (cursors, faces, shared view) -------------------------
  const [selfP, setSelfP] = createSignal(null);
  const [peers, setPeers] = createSignal(new Map(), { equals: false });
  const [showViews, setShowViews] = createSignal(false);
  const [following, setFollowing] = createSignal(null); // a peer's contactUrl we're following
  const [myCursor, setMyCursor] = createSignal(null);
  let myContactUrl = null;

  (async function loadSelf() {
    try {
      const acct = window.accountDocHandle?.doc();
      if (!acct?.contactUrl) return;
      myContactUrl = acct.contactUrl;
      const ch = await repo.find(acct.contactUrl);
      const refresh = () => {
        const c = ch.doc();
        if (!c) return;
        setSelfP({ contactUrl: myContactUrl, name: c.type === "registered" ? c.name : "Anonymous", color: c.color || colorFor(myContactUrl), avatarUrl: (c.type === "registered" && c.avatarUrl) || null });
      };
      refresh();
      ch.on("change", refresh);
    } catch (e) { console.warn("[newspace] presence self", e); }
  })();

  function myViewRect() {
    const r = viewportRef?.getBoundingClientRect();
    if (!r) return null;
    const k = viewportRef.offsetWidth ? r.width / viewportRef.offsetWidth : 1;
    return viewRect(cam(), r.width / k, r.height / k);
  }
  let lastBroadcast = 0;
  function broadcastPresence(force) {
    const s = selfP();
    if (!s) return;
    const now = Date.now();
    if (!force && now - lastBroadcast < 55) return;
    lastBroadcast = now;
    handle.broadcast({ type: "ns-presence", contactUrl: s.contactUrl, name: s.name, color: s.color, avatarUrl: s.avatarUrl, cursor: myCursor(), view: myViewRect(), selection: selected(), tool: tool(), ts: now });
  }
  function onPresence({ message: m }) {
    if (!m || m.contactUrl === myContactUrl) return;
    if (m.type === "ns-presence-bye") { setPeers((p) => { p.delete(m.contactUrl); return p; }); return; }
    if (m.type !== "ns-presence") return;
    setPeers((p) => { p.set(m.contactUrl, m); return p; });
  }
  handle.on("ephemeral-message", onPresence);
  const presHeartbeat = setInterval(() => {
    broadcastPresence(true);
    setPeers((p) => { const now = Date.now(); for (const [k, v] of p) if (now - v.ts > 5000) p.delete(k); return p; });
  }, 1000);
  onCleanup(() => {
    handle.off("ephemeral-message", onPresence);
    clearInterval(presHeartbeat);
    if (myContactUrl) handle.broadcast({ type: "ns-presence-bye", contactUrl: myContactUrl, ts: Date.now() });
  });
  createEffect(() => { cam(); broadcastPresence(); }); // share view as it moves
  const trackCursor = (e) => { const w = toWorld(e.clientX, e.clientY); setMyCursor(w); context.pointer.set(w); broadcastPresence(); };

  // bounds of everything (for the minimap), including peers' cursors + my view
  const worldBounds = createMemo(() =>
    contentBounds(rootItems().map(itemBounds), [...peers().values()].map((p) => p.cursor), myViewRect())
  );

  // ── persistent wires ───────────────────────────────────────────────────────
  // a line from each wired editor inlet back to its source port; drawn whether or
  // not the wire tool is active, until the wire (inlet) is deleted (click it).
  const CTX_NAMES = ["camera", "pointer", "tool", "brush", "selection"];
  const worldToScreen = (wx, wy) => { const c = cam(); return { x: wx * c.z + c.x, y: wy * c.z + c.y }; };
  function ctxPortPos(name) {
    if (!viewportRef) return null;
    const i = CTX_NAMES.indexOf(name); if (i < 0) return null;
    const H = viewportRef.offsetHeight, W = viewportRef.offsetWidth;
    const chipH = 24, gap = 5, n = CTX_NAMES.length, total = n * chipH + (n - 1) * gap;
    return { x: W - 78, y: H / 2 - total / 2 + i * (chipH + gap) + chipH / 2 }; // ~left edge of the chip
  }
  function domPortPos(url, path) {
    if (!viewportRef) return null;
    const key = JSON.stringify(path);
    for (const el of viewportRef.querySelectorAll("[data-automerge-path]")) {
      if ((el.dataset.automergeUrl || "") !== url) continue;
      let p; try { p = JSON.parse(el.dataset.automergePath); } catch { continue; }
      if (JSON.stringify(p) !== key) continue;
      const r = el.getBoundingClientRect(), vr = viewportRef.getBoundingClientRect();
      return { x: r.left - vr.left + r.width, y: r.top - vr.top + r.height / 2 };
    }
    return null;
  }
  const wires = createMemo(() => {
    cam(); peers(); // recompute on pan/zoom + peer movement
    const out = [];
    for (const it of rootItems()) {
      if (it.kind !== "editor" || !it.inlets) continue;
      const b = itemBounds(it);
      const to = worldToScreen(b.x, b.y + b.h / 2); // editor's left-mid
      for (const [name, w] of Object.entries(it.inlets)) {
        if (!w) continue;
        let from = null;
        if (w.context) from = ctxPortPos(w.context);
        else if (w.peer) { const p = peers().get(w.peer); if (p && p.view) from = worldToScreen(p.view.x + p.view.w, p.view.y + p.view.h / 2); }
        else if (w.url) from = domPortPos(w.url, w.path);
        if (from) out.push({ key: it.id + ":" + name, from, to, editorId: it.id, inlet: name });
      }
    }
    // floating inspectors (user-state, top layer) → their source outlet
    for (const f of floats()) {
      let from = null;
      if (f.source && f.source.context) from = ctxPortPos(f.source.context);
      else if (f.source && f.source.peer) { const p = peers().get(f.source.peer); if (p && p.view) from = worldToScreen(p.view.x + p.view.w, p.view.y + p.view.h / 2); }
      if (from) out.push({ key: f.id, from, to: { x: f.x, y: f.y + 10 }, floatId: f.id });
    }
    return out;
  });
  // context outlets referenced by some editor's inlet — these stay visible (in use)
  const usedContextOutlets = createMemo(() => {
    const s = new Set();
    for (const it of rootItems()) {
      if (it.kind !== "editor" || !it.inlets) continue;
      for (const w of Object.values(it.inlets)) if (w && w.context) s.add(w.context);
    }
    return s;
  });
  function unwire(editorId, inlet) {
    transact(active().handle, "unwire", () => active().handle.change((d) => {
      const o = d.items.find((x) => x.id === editorId);
      if (o && o.inlets) delete o.inlets[inlet];
    }));
  }

  // peer-state opstreams: a Source per (contactUrl, part), kept fresh from presence
  // by one effect. So wiring a peer outlet → an inspector shows that peer's live part.
  const peerStreams = new Map();
  const PEER_SEP = " ";
  createEffect(() => {
    const ps = peers();
    for (const [key, src] of peerStreams) {
      const i = key.indexOf(PEER_SEP);
      const p = ps.get(key.slice(0, i));
      src.push(p ? p[key.slice(i + 1)] : undefined);
    }
  });
  function peerStream(contactUrl, part) {
    const key = contactUrl + PEER_SEP + part;
    let s = peerStreams.get(key);
    if (!s) { const p = peers().get(contactUrl); s = new Source(p ? p[part] : undefined); peerStreams.set(key, s); }
    return s;
  }

  // FLOATING INSPECTORS — wiring a USER-STATE outlet (pointer/camera/peer cursor…)
  // makes a LOCAL floating panel on the top overlay layer, NOT a shared doc item:
  // it belongs to this viewer's state, not the document. (Per-user, per-doc, local.)
  const [floats, setFloats] = makePersisted(createSignal([]), { name: `sketchy:floats:${handle.url}`, storage: localStorage });
  const addFloat = (source, x, y) => setFloats((fs) => [...fs, { id: "fl-" + uid(), x, y, w: 220, h: 150, source }]);
  const removeFloat = (id) => setFloats((fs) => fs.filter((f) => f.id !== id));
  const moveFloat = (id, x, y) => setFloats((fs) => fs.map((f) => (f.id === id ? { ...f, x, y } : f)));
  const sourceStreamFor = (source) =>
    source && source.context ? context[source.context] : source && source.peer ? peerStream(source.peer, source.part) : null;
  function centerOn(wx, wy) {
    const r = viewportRef.getBoundingClientRect();
    const k = viewportRef.offsetWidth ? r.width / viewportRef.offsetWidth : 1;
    setCam(centerCam(cam(), wx, wy, r.width / k, r.height / k));
  }
  // FOLLOW MODE: fit my camera to a peer's view rect (whole rect visible, centred).
  function fitCameraTo(pv) {
    if (!viewportRef || !pv || !pv.w || !pv.h) return;
    const r = viewportRef.getBoundingClientRect();
    const k = viewportRef.offsetWidth ? r.width / viewportRef.offsetWidth : 1;
    setCam(fitRect(pv, r.width / k, r.height / k));
  }
  // while following, my camera tracks the followed peer's broadcast view (re-runs
  // each presence update). manual pan/zoom clears `following` (see startPan/zoomBy/wheel).
  createEffect(() => { const id = following(); if (!id) return; const p = peers().get(id); if (p && p.view) fitCameraTo(p.view); });

  // ---- properties (single selection or brush) -------------------------
  const storedKey = (kind, key) => (key === "size" ? (kind === "shape" ? "strokeWidth" : kind === "text" ? "fontSize" : "size") : key);
  const editTargets = () => selected().map(itemById).filter((o) => o && (o.kind === "shape" || o.kind === "stroke" || o.kind === "text"));
  const SHAPE_ONLY = new Set(["fill", "fillStyle", "strokeStyle", "roughness", "bowing", "corner", "startArrow", "endArrow"]);
  const TEXT_ONLY = new Set(["font"]);
  function getProp(key) { const ts = editTargets(); if (ts.length) { const o = ts[0]; return o[storedKey(o.kind, key)]; } return brush[key]; }
  function setProp(key, val) {
    const ts = editTargets();
    if (ts.length) {
      transact(active().handle, "style", () => active().handle.change((d) => { for (const t of ts) { const o = d.items.find((x) => x.id === t.id); if (!o || (SHAPE_ONLY.has(key) && o.kind !== "shape") || (TEXT_ONLY.has(key) && o.kind !== "text")) continue; o[storedKey(o.kind, key)] = val; } }));
      // editing a selection ALSO becomes the default for the next thing you draw
      setBrush(key === "size" && ts[0].kind === "text" ? "fontSize" : key, val);
      return;
    }
    setBrush(key, val);
  }
  function setItemField(id, field, val) { transact(active().handle, "edit", () => active().handle.change((d) => { const o = d.items.find((x) => x.id === id); if (o) o[field] = val; })); }

  const propMode = createMemo(() => {
    const sel = selected();
    if (sel.length > 1) return "multi";
    if (sel.length === 1) { const it = itemById(sel[0]); return it ? it.kind : null; }
    if (tool() === "pen") return "stroke";
    if (SHAPE_TOOLS.has(tool())) return "shape";
    if (tool() === "text") return "text";
    if (isBrushTool(tool()) && brushMods.get(tool())?.params) return "brush";
    return null;
  });
  const showProps = createMemo(() => propMode() !== null);

  const worldTransform = () => { const c = cam(); return `translate(${c.x}px, ${c.y}px) scale(${c.z})`; };
  const svgTransform = () => { const c = cam(); return `translate(${c.x} ${c.y}) scale(${c.z})`; };
  const cursorClass = () => { const t = tool(); if (t === "hand") return "ns-cur-grab"; if (t === "select") return "ns-cur-default"; return "ns-cur-cross"; };

  const ctx = {
    tool, interactive, themeTick, resolveColor, onItemDown, isSelected, linkFor, itemBounds,
    serviceUrl: automergeUrlToServiceWorkerUrl, loadSpace, loadDoc, loadDatatype, registerSurface, unregisterSurface,
    editingId, setEditingId, tombstoned: (url) => tombstones.has(url),
    deselect: () => setSelected([]),
    toWorld, select: (ids) => setSelected(ids),
    removeItem: (id) => removeItems(null, [id]),
    dropTarget, escapeId, embedsReady, history,
    enteredGroup,
    // double-clicking a grouped item descends INTO its group (figma-style); a
    // second double-click then reaches the member's own action (text edit, …)
    enterGroup: (it) => { if (it.group && it.group !== enteredGroup()) { setEnteredGroup(it.group); setSelected([it.id]); return true; } return false; },
    boxBounds: (id) => { const f = rootItems().find((x) => x.id === id); return f ? itemBounds(f) : null; },
    api: element?.api, // the sketchy api (find → opstream, editors, …) for EditorItem
    context, // the canvas context Sources, for context-wired editor inlets
    peerStream, // (contactUrl, part) → a live Source of a peer's state, for peer-wired inlets
  };

  const handleBox = createMemo(() => {
    if (tool() !== "select") return null;
    if (editingId()) return null; // while editing text, show only the caret — no box/handles
    const c = cam();
    const it = single();
    if (it) {
      if (it.kind === "shape" && (it.type === "arrow" || it.type === "line")) return null; // use endpoint handles
      if (it.kind === "sketch") return null; // sketches articulate via their nodes, not resize/rotate handles
      const b = itemBounds(it); const frame = active().frame;
      const [wx, wy] = localToWorld(frame, b.x + b.w / 2, b.y + b.h / 2);
      const sw = b.w * c.z, sh = b.h * c.z;
      return { x: wx * c.z + c.x - sw / 2, y: wy * c.z + c.y - sh / 2, w: sw, h: sh, rot: (it.rotation || 0) + (frame ? frame.rotation || 0 : 0), kind: it.kind };
    }
    const u = selWorldBounds();
    if (u) return { x: u.x * c.z + c.x, y: u.y * c.z + c.y, w: u.w * c.z, h: u.h * c.z, rot: 0, kind: "multi" };
    return null;
  });

  // screen positions of a selected arrow/line's grab dots (2 endpoints + a
  // line's bezier control point)
  const segSel = createMemo(() => {
    if (tool() !== "select" || editingId()) return null;
    const it = single();
    if (!it || it.kind !== "shape" || (it.type !== "arrow" && it.type !== "line")) return null;
    const frame = active().frame, c = cam();
    const g = (it.type === "arrow" && (it.fromId || it.toId)) ? arrowGeometry(it, active().doc?.items || []) : it;
    const toScreen = (lx, ly) => { const [wx, wy] = localToWorld(frame, lx, ly); return { x: wx * c.z + c.x, y: wy * c.z + c.y }; };
    // the control HANDLE rides ON the curve (its midpoint), not at the off-curve
    // quadratic control point — so it sits where you'd grab to bend the line.
    // midpoint of a quadratic = ¼·start + ½·control + ¼·end
    const ex = g.x + g.w, ey = g.y + g.h;
    const mx = it.cx != null ? 0.25 * g.x + 0.5 * it.cx + 0.25 * ex : (g.x + ex) / 2;
    const my = it.cy != null ? 0.25 * g.y + 0.5 * it.cy + 0.25 * ey : (g.y + ey) / 2;
    return { start: toScreen(g.x, g.y), end: toScreen(ex, ey), control: toScreen(mx, my) };
  });
  // world bounds of the shape an arrow end is hovering, for the bind highlight
  const arrowHoverBox = createMemo(() => { const id = arrowHover(); if (!id) return null; const it = rootItems().find((x) => x.id === id); if (!it) return null; const b = itemBounds(it); return { ...b, rotation: it.rotation || 0, cx: b.x + b.w / 2, cy: b.y + b.h / 2 }; });

  return (
    <div class={"ns-root " + cursorClass()} classList={{ "ns-wiring": tool() === "wire" }} ref={viewportRef} onPointerDown={onPointerDown} onPointerMove={trackCursor} onDblClick={onCanvasDblClick} onWheel={onWheel} onDragOver={onDragOver} onDrop={onDrop}>
      <div class="ns-world" ref={(el) => enableAtomicMove(el)} style={{ transform: worldTransform() }}>
        <For each={sortById(rootItems())}>{(it) => <Item it={it} surface={rootSurface()} ctx={ctx} depth={0} />}</For>
      </div>
      {/* while a pan is in flight this captures the wheel (over iframes too) so
          the pan keeps going; idle → pointer-events:none, tools interactive */}
      <div class="ns-panlock" style={{ "pointer-events": panActive() ? "auto" : "none" }} />

      <svg class="ns-overlay">
        <g transform={svgTransform()}>
          <Show when={draft()}>
            {(d) => (
              <Show when={d().kind === "stroke"} fallback={
                <Show when={d().kind === "shape"} fallback={
                  <rect class={d().kind === "marquee" ? "ns-marquee" : "ns-place"} x={Math.min(d().x, d().x + d().w)} y={Math.min(d().y, d().y + d().h)} width={Math.abs(d().w)} height={Math.abs(d().h)} />
                }>
                  <For each={shapePaths(shapeRenderProps(d(), resolveColor))}>
                    {(p) => <path d={p.d} stroke={p.stroke} fill={p.fill} stroke-width={p.strokeWidth} stroke-dasharray={p.dash} stroke-linecap="round" stroke-linejoin="round" fill-rule="nonzero" opacity="0.92" />}
                  </For>
                </Show>
              }>
                <path d={freehandPath(d().points, d().size, d())} style={{ fill: colorVar(d().color), opacity: d().opacity, "mix-blend-mode": d().blend }} />
              </Show>
            )}
          </Show>
          <Show when={guides()}>
            <For each={guides()}>{(g) => (
              <Show when={g.t === "seg"} fallback={
                <Show when={g.t === "pt"} fallback={
                  <text class="ns-guide-badge" x={g.x} y={g.y}>{g.text}</text>
                }>
                  <circle class="ns-guide-pt" classList={{ hot: g.hot }} cx={g.x} cy={g.y} r="4" vector-effect="non-scaling-stroke" />
                </Show>
              }>
                <line class="ns-guide-seg" x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2} vector-effect="non-scaling-stroke" />
              </Show>
            )}</For>
          </Show>
          <Show when={selWorldBounds()}>{(b) => <rect class="ns-sel" x={b().x} y={b().y} width={b().w} height={b().h} />}</Show>
          <For each={selItemOutlines()}>{(o) => <rect class="ns-sel-each" x={o.x} y={o.y} width={o.w} height={o.h} transform={`rotate(${o.rot} ${o.cx} ${o.cy})`} vector-effect="non-scaling-stroke" />}</For>
          <Show when={groupOutline()}>{(g) => <rect class={g().entered ? "ns-group ns-group-in" : "ns-group"} x={g().x} y={g().y} width={g().w} height={g().h} rx="4" vector-effect="non-scaling-stroke" />}</Show>
          <Show when={arrowHoverBox()}>{(b) => <rect class="ns-bindhl" x={b().x - 3} y={b().y - 3} width={b().w + 6} height={b().h + 6} rx="5" transform={`rotate(${b().rotation} ${b().cx} ${b().cy})`} vector-effect="non-scaling-stroke" />}</Show>
        </g>
      </svg>

      {/* persistent wires from each wired editor inlet to its source port (always
          visible; click a wire to delete it) */}
      <Show when={wires().length}>
        <svg class="ns-wires" style={{ position: "absolute", inset: "0", width: "100%", height: "100%", "pointer-events": "none", overflow: "visible", "z-index": "30" }}>
          <For each={wires()}>
            {(wire) => (
              <>
                <path
                  d={`M${wire.from.x} ${wire.from.y} C ${(wire.from.x + wire.to.x) / 2} ${wire.from.y} ${(wire.from.x + wire.to.x) / 2} ${wire.to.y} ${wire.to.x} ${wire.to.y}`}
                  fill="none" stroke="#ff2284" stroke-width="2" opacity="0.65"
                  style={{ "pointer-events": "stroke", cursor: "pointer" }}
                  onClick={() => (wire.floatId ? removeFloat(wire.floatId) : unwire(wire.editorId, wire.inlet))}
                >
                  <title>click to unwire</title>
                </path>
                <circle cx={wire.from.x} cy={wire.from.y} r="3.5" fill="#ff2284" />
                <circle cx={wire.to.x} cy={wire.to.y} r="3.5" fill="#ff2284" />
              </>
            )}
          </For>
        </svg>
      </Show>

      {/* the canvas's own context as OUTLET ports down the right edge. All show with
          the wire tool; an in-use outlet STAYS visible after the tool is off (so its
          live wire keeps an anchor). */}
      <Show when={tool() === "wire" || usedContextOutlets().size}>
        <div class="ns-ctx-ports">
          <For each={CTX_NAMES.filter((n) => tool() === "wire" || usedContextOutlets().has(n))}>
            {(name) => <div class="ns-ctx-port" classList={{ used: usedContextOutlets().has(name) }} data-sketchy-port={name} title={`outlet: ${name}`}>{name}</div>}
          </For>
        </div>
      </Show>

      {/* user-state floating inspectors — local to this viewer, on the top layer (not
          the shared doc). Wired from a context/peer outlet. */}
      <div class="ns-floats">
        <For each={floats()}>
          {(f) => (
            <FloatInspector
              f={f}
              stream={sourceStreamFor(f.source)}
              label={f.source && (f.source.context || f.source.part || "")}
              onMove={(x, y) => moveFloat(f.id, x, y)}
              onClose={() => removeFloat(f.id)}
            />
          )}
        </For>
      </div>

      {/* pick which editor to place when a dropped wire matches several */}
      <Show when={editorChooser()}>{(c) => (
        <div class="ns-chooser-backdrop" onPointerDown={() => setEditorChooser(null)}>
          <div class="ns-chooser" style={{ left: `${c().x}px`, top: `${c().y}px` }} onPointerDown={(e) => e.stopPropagation()}>
            <For each={c().candidates}>
              {(d) => <button class="ns-chooser-item" onClick={() => { c().place(d); setEditorChooser(null); }}>{d.name || d.id}</button>}
            </For>
          </div>
        </div>
      )}</Show>

      {/* the wire being dragged (screen-space, like the segment handles) */}
      <Show when={wireDraft()}>{(w) => (
        <svg class="ns-wire-overlay" style={{ position: "absolute", inset: "0", width: "100%", height: "100%", "pointer-events": "none", overflow: "visible" }}>
          <line x1={w().from.x} y1={w().from.y} x2={w().to.x} y2={w().to.y} stroke="var(--ns-ink, #ff2284)" stroke-width="2" stroke-dasharray="5 4" stroke-linecap="round" />
          <circle cx={w().from.x} cy={w().from.y} r="4" fill="var(--ns-ink, #ff2284)" />
        </svg>
      )}</Show>

      <Show when={handleBox()}>{(b) => <Handles box={b()} onResize={startResizeSel} onRotate={startRotate} onResetRotate={resetRotation} />}</Show>
      <Show when={segSel()}>{(a) => <>
        <div class="ns-end" style={{ left: `${a().start.x}px`, top: `${a().start.y}px` }} onPointerDown={(e) => startSegEnd("start", e)} />
        <div class="ns-end" style={{ left: `${a().end.x}px`, top: `${a().end.y}px` }} onPointerDown={(e) => startSegEnd("end", e)} />
        <Show when={a().control}>{(cp) => <div class="ns-end ns-ctrl" style={{ left: `${cp().x}px`, top: `${cp().y}px` }} onPointerDown={(e) => startSegEnd("control", e)} />}</Show>
      </>}</Show>

      <PresenceLayer peers={peers} cam={cam} showViews={showViews} serviceUrl={ctx.serviceUrl} following={following} onFollow={(id) => setFollowing((f) => (f === id ? null : id))} wiring={() => tool() === "wire"} />
      <Minimap bounds={worldBounds} peers={peers} view={myViewRect} rects={() => rootItems().map((it) => { const b = itemBounds(it); return { x: b.x, y: b.y, w: b.w, h: b.h, box: it.kind === "frame" }; })} serviceUrl={ctx.serviceUrl} onJump={centerOn} />
      <button class="ns-views" classList={{ active: showViews() }} title="Overlay other people's views" onPointerDown={(e) => e.stopPropagation()} onClick={() => setShowViews(!showViews())}>
        <svg viewBox="0 0 22 22" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 11s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z" /><circle cx="11" cy="11" r="2.5" /></svg>
      </button>

      <Toolbar tool={tool} setTool={setTool} datatypes={datatypes} brushes={brushes} addOpen={addOpen} setAddOpen={setAddOpen} shapeMenuOpen={shapeMenuOpen} setShapeMenuOpen={setShapeMenuOpen} extraShape={extraShape} setExtraShape={setExtraShape} selectPlacing={selectPlacing} />

      <Show when={showProps()}>
        <Properties mode={propMode} get={getProp} set={setProp} pos={propsPos} setPos={setPropsPos} single={single} setField={setItemField} linkFor={linkFor} reorder={reorder} hasSel={() => selected().length > 0} selCount={() => selected().length} hasGroup={hasGroup} group={groupSelected} ungroup={ungroupSelected} rect={() => { const it = single(); return it ? (it.kind === "shape" && it.type === "rectangle") : tool() === "rectangle"; }} arrow={() => { const it = single(); return it ? (it.kind === "shape" && it.type === "arrow") : tool() === "arrow"; }} fillable={() => { const it = single(); const t = it ? (it.kind === "shape" ? it.type : null) : tool(); return t === "rectangle" || t === "ellipse"; }} />
      </Show>

      <div class="ns-zoom" onPointerDown={(e) => e.stopPropagation()} onClick={() => setCam((c) => ({ ...c, z: 1 }))}>{Math.round(cam().z * 100)}%</div>
    </div>
  );
}


// A user-state floating inspector — a draggable panel on the top overlay layer that
// shows a wired source (context/peer) live. NOT part of the document.
function FloatInspector(props) {
  let host;
  onMount(() => {
    if (host && props.stream) {
      const cleanup = mountInspector({ element: host, inlets: { value: props.stream } });
      onCleanup(cleanup);
    }
  });
  const startDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sx = e.clientX, sy = e.clientY, ox = props.f.x, oy = props.f.y;
    const m = (ev) => props.onMove(ox + ev.clientX - sx, oy + ev.clientY - sy);
    const u = () => { window.removeEventListener("pointermove", m); window.removeEventListener("pointerup", u); };
    window.addEventListener("pointermove", m);
    window.addEventListener("pointerup", u);
  };
  return (
    <div class="ns-float" style={{ left: `${props.f.x}px`, top: `${props.f.y}px`, width: `${props.f.w || 220}px`, height: `${props.f.h || 150}px` }}>
      <div class="ns-float-head" onPointerDown={startDrag}>
        <span class="ns-float-title">{props.label}</span>
        <button class="ns-float-close" onPointerDown={(e) => e.stopPropagation()} onClick={() => props.onClose()}>×</button>
      </div>
      <div class="ns-float-body" ref={host} />
    </div>
  );
}
