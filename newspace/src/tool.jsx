import { render } from "solid-js/web";
import { createSignal, createMemo, createEffect, For, Show, onCleanup, onMount } from "solid-js";
import { createStore } from "solid-js/store";
import { makeDocumentProjection } from "automerge-repo-solid-primitives";
import { makePersisted } from "@solid-primitives/storage";
import {
  getRegistry,
  createDocOfDatatype2,
  getSupportedToolsForType,
} from "@inkandswitch/patchwork-plugins";
import { automergeUrlToServiceWorkerUrl, getType } from "@inkandswitch/patchwork-filesystem";
import { NewspaceDatatype } from "./datatype.js";
import {
  freehandPath, shapePaths, shapeBounds, strokeBounds, roughRectPath, seedFromId,
} from "./draw.js";
import {
  rad, rot, isBoxType, localToWorld, worldToLocal, pointInFrame,
  itemBounds, cloneItem, linksNeedingItems, itemPresent, shouldUnlinkDoc, arrowGeometry, worldAnchor,
} from "./model.js";
import "./style.css";

// colours are stored as semantic NAMES, mapped to a --space-color-* palette
const PALETTE = [
  "line", "offset",
  "purple", "deep purple",
  "blue", "deep blue",
  "green", "deep green",
  "yellow", "deep yellow",
  "red", "deep red",
];
// the editor background — used for the "paper" colour (matches the canvas) and
// as the mix target for paler fills
const FILL_BG = "var(--editor-fill, var(--studio-fill, #fff))";
// a palette name -> css var; legacy css values (with digits/punctuation) pass through
const colorVar = (c) => {
  if (!c || c === "none") return c;
  if (c === "paper") return FILL_BG;
  if (/[^a-z\s]/i.test(c)) return c;
  return `var(--space-color-${c.trim().replace(/\s+/g, "-")})`;
};
// fills are a slightly PALER version of the palette colour — mixed toward the
// editor background so a filled shape reads as a tint, not a flat block. "paper"
// is the exact canvas colour (no mix), so it occludes what's behind.
const fillVar = (c) => (!c || c === "none") ? c : c === "paper" ? FILL_BG : `color-mix(in oklab, ${colorVar(c)} 55%, ${FILL_BG})`;

const SIZES = [2, 5];
const FILL_STYLES = ["hachure", "cross-hatch", "zigzag", "dots", "solid"];
// little CSS previews so the fill-style picker shows what each style looks like
const FILL_PREVIEW = {
  hachure: { "background-image": "repeating-linear-gradient(45deg, var(--ns-ink) 0 1.5px, transparent 1.5px 5px)" },
  "cross-hatch": { "background-image": "repeating-linear-gradient(45deg, var(--ns-ink) 0 1.5px, transparent 1.5px 5px), repeating-linear-gradient(-45deg, var(--ns-ink) 0 1.5px, transparent 1.5px 5px)" },
  zigzag: { "background-image": "repeating-linear-gradient(135deg, var(--ns-ink) 0 1.5px, transparent 1.5px 4px)" },
  dots: { "background-image": "radial-gradient(var(--ns-ink) 1px, transparent 1.5px)", "background-size": "5px 5px" },
  solid: { background: "var(--ns-ink)" },
};
const STROKE_STYLES = ["solid", "dashed", "dotted"];
// rectangle corner styles, shown as a top-left-corner glyph
const CORNERS = [
  { key: "squircle", icon: "M3 15 C3 6 6 3 15 3" },
  { key: "round", icon: "M3 15 L3 9 Q3 3 9 3 L15 3" },
  { key: "square", icon: "M3 15 L3 3 L15 3" },
];
// roughness + bowing collapsed into one three-step choice (default = middle),
// each shown as a little line icon: straight → gently wavy → jagged
const ROUGHNESS_LEVELS = [
  { key: "clean", label: "clean", roughness: 0, bowing: 0.05, icon: "M2 9 H22" },
  { key: "sketchy", label: "sketchy", roughness: 1.5, bowing: 0.1, icon: "M2 9 Q7 4 12 9 T22 9" },
  { key: "scratchy", label: "scratchy", roughness: 4.5, bowing: 0.28, icon: "M2 9 L5 4.5 L8 12 L11 5 L14 12 L17 5 L20 12 L22 7.5" },
];
// four text faces. "hand" is Caroni (an overridable --newspace-family-hand
// token, see style.css); the rest pull from the editor font vars.
const FONTS = {
  hand: "var(--newspace-family-hand, \"Caroni\", cursive)",
  sans: "var(--editor-font-sans, ui-sans-serif, system-ui, sans-serif)",
  serif: "var(--editor-font-serif, ui-serif, Georgia, 'Times New Roman', serif)",
  code: "var(--editor-font-mono, ui-monospace, 'SF Mono', monospace)",
};
const FONT_OPTIONS = ["hand", "sans", "serif", "code"];
const fontFamily = (f) => FONTS[f] || FONTS.hand;
// resolve a shape's colours for rough.js
function shapeRenderProps(it, resolve) {
  return { ...it, color: resolve(colorVar(it.color)), fill: resolve(fillVar(it.fill)) };
}

// Render items in a STABLE (id-sorted) order, while stacking order comes from
// the array index via z-index. So reordering a layer changes only a z-index —
// the DOM node never moves, so live embeds (a call, an iframe) are never torn
// down or relocated. (ids are stable, so this order doesn't shuffle.)
const sortById = (items) => [...(items || [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

// Reordering a layer makes Solid relocate that item's DOM node with
// insertBefore, which RESETS iframes / live embeds (a call drops its WebRTC).
// moveBefore() (the atomic-move API) relocates a node without tearing it down,
// so we route same-parent moves through it. Feature-detected; falls back to
// insertBefore where unsupported.
function enableAtomicMove(el) {
  if (!el || el.__nsAtomicMove || typeof el.moveBefore !== "function") return;
  el.__nsAtomicMove = true;
  const insertBefore = Element.prototype.insertBefore;
  el.insertBefore = function (node, ref) {
    if (node && node !== ref && node.parentNode === this) {
      try { this.moveBefore(node, ref); return node; } catch { /* fall through */ }
    }
    return insertBefore.call(this, node, ref);
  };
}
const SHAPE_TOOLS = new Set(["rectangle", "ellipse", "line", "arrow"]);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const rndSeed = () => Math.floor(Math.random() * 2147483647);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function clonePlain(o) {
  const c = { ...o };
  if (o.kind === "stroke" && Array.isArray(o.points)) c.points = o.points.map((p) => [p[0], p[1], p[2] ?? 0.5]);
  delete c.parent;
  return c;
}
// a "space" doc (folder/newspace) references its canvas layout doc via `.newspace`.
// ensureLayout makes/loads that layout doc, migrating any older top-level `items`.
async function ensureLayout(repo, folderHandle) {
  folderHandle.change((d) => { if (!d.docs) d.docs = []; });
  let url = folderHandle.doc().newspace;
  if (!url) {
    const old = folderHandle.doc().items;
    const seed = Array.isArray(old) ? old.map(clonePlain) : [];
    const layout = await repo.create2({ "@patchwork": { type: "newspace-layout" }, items: seed });
    folderHandle.change((d) => { d.newspace = layout.url; if (Array.isArray(d.items)) d.items.splice(0); });
    return layout;
  }
  const lh = await repo.find(url);
  lh.change((d) => { if (!d.items) d.items = []; });
  return lh;
}

// stable fallback colour from a contact url
function colorFor(s) {
  let h = 0;
  for (let i = 0; i < (s || "").length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `oklch(0.62 0.19 ${Math.abs(h) % 360})`;
}

function isTypingTarget(t) {
  const el = t || document.activeElement;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  return !!(el.closest && el.closest(".ns-doc-body:not(.ns-frame-body)"));
}

export function NewspaceTool(handle, element) {
  const dispose = render(() => Canvas({ handle, repo: element.repo }), element);
  return () => dispose();
}

function Canvas(props) {
  const { handle, repo } = props;
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
  const [tool, setTool] = createSignal("select");
  const [draft, setDraft] = createSignal(null);
  const [selected, setSelected] = createSignal([]);
  const [placing, setPlacing] = createSignal(null);
  const [datatypes, setDatatypes] = createSignal([]);
  const [brushes, setBrushes] = createSignal([]); // newspace:brush plugins (used later)
  const [addOpen, setAddOpen] = createSignal(false);   // docs overflow menu
  const [shapeMenuOpen, setShapeMenuOpen] = createSignal(false); // shape overflow menu
  const [extraShape, setExtraShape] = createSignal("line"); // last-used overflow shape, surfaced in the bar
  const [dropTarget, setDropTarget] = createSignal(null); // frame id a dragged item would drop INTO
  const [unclipBox, setUnclipBox] = createSignal(null); // box (surface id) to un-clip while dragging a child out
  const [panActive, setPanActive] = createSignal(false); // an in-flight pan/zoom — overlay captures wheel so it wins over tool scroll
  const [arrowHover, setArrowHover] = createSignal(null); // item id an arrow end would bind to
  const [propsPos, setPropsPos] = createSignal({ x: 16, y: 16 });

  const [brush, setBrush] = createStore({
    color: "line", size: SIZES[1], fill: "none",
    roughness: 1.5, bowing: 0.1, fillStyle: "solid", strokeStyle: "solid", corner: "squircle",
    startArrow: false, endArrow: true,
    font: "hand", fontSize: 26,
  });
  const [editingId, setEditingId] = createSignal(null); // item being text-edited

  let viewportRef;
  try { setDatatypes(getRegistry("patchwork:datatype").filter((d) => !d.unlisted)); } catch (e) { console.warn("[newspace] datatypes", e); }
  // custom brushes live in a newspace:brush registry (may not exist yet). We
  // list them in the shape overflow, and load each brush MODULE (its stroke
  // config) so drawing with the brush uses it.
  const brushMods = new Map(); // id -> brush module ({ stroke, iconPath, ... })
  try {
    const r = getRegistry("newspace:brush");
    if (r) {
      const list = typeof r.filter === "function" ? r.filter(() => true) : (Array.isArray(r) ? r : []);
      setBrushes(list);
      for (const b of list) Promise.resolve(b.load ? b.load() : b).then((m) => { if (m) brushMods.set(m.id || b.id, m); }).catch(() => {});
    }
  } catch {}
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
      const b = itemBounds(it);
      if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return it.id;
    }
    return null;
  };
  function convertToLocal(item, frame) {
    if (!frame) return;
    if (item.kind === "stroke") { item.points = item.points.map(([x, y, pr]) => { const [lx, ly] = worldToLocal(frame, x, y); return [lx, ly, pr]; }); item.rotation = 0; }
    else { const w = item.w || 0, h = item.h || 0; const [lcx, lcy] = worldToLocal(frame, item.x + w / 2, item.y + h / 2); item.x = lcx - w / 2; item.y = lcy - h / 2; item.rotation = (item.rotation || 0) - (frame.rotation || 0); }
  }
  // push a freshly-made item into whichever frame it's inside (else root)
  async function pushItem(targetFrame, item, opts = {}) {
    let dstHandle = rootLayoutH(), dstFrame = null;
    if (targetFrame) { const s = await loadSpace(targetFrame.url); if (s) { dstHandle = s.layoutHandle; dstFrame = targetFrame; } }
    if (!dstHandle) return;
    convertToLocal(item, dstFrame);
    const id = uid();
    dstHandle.change((d) => d.items.push({ id, ...item }));
    setActiveId(dstFrame ? targetFrame.url : "root");
    setSelected([id]);
    if (opts.edit) setEditingId(id);
  }

  const itemById = (id) => (active().doc?.items || []).find((x) => x.id === id);
  const selSet = createMemo(() => new Set(selected()));
  const isSelected = (id) => selSet().has(id);

  // grouping: items sharing a `group` id select / move / rotate as one unit
  function expandGroups(ids) {
    const items = active().doc?.items || [];
    const gids = new Set();
    for (const id of ids) { const o = items.find((x) => x.id === id); if (o && o.group) gids.add(o.group); }
    if (!gids.size) return ids;
    const out = new Set(ids);
    for (const o of items) if (o.group && gids.has(o.group)) out.add(o.id);
    return [...out];
  }
  function groupSelected() { const ids = selected(); if (ids.length < 2) return; const gid = "g" + uid(); active().handle.change((d) => { for (const id of ids) { const o = d.items.find((x) => x.id === id); if (o) o.group = gid; } }); }
  function ungroupSelected() { active().handle.change((d) => { for (const id of selected()) { const o = d.items.find((x) => x.id === id); if (o && o.group != null) delete o.group; } }); }
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
    if (e.shiftKey) {
      const grp = expandGroups([it.id]);
      const allIn = grp.every((id) => isSelected(id));
      setSelected(allIn ? selected().filter((id) => !grp.includes(id)) : [...new Set([...selected(), ...grp])]);
    } else if (!isSelected(it.id)) setSelected(expandGroups([it.id]));
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
      orig[c.id] = c.kind === "stroke" ? { points: c.points.map((p) => p.slice()) } : { x: c.x, y: c.y };
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
      if (o) orig[id] = o.kind === "stroke" ? { points: o.points.map((p) => p.slice()) } : { x: o.x, y: o.y, cx: o.cx, cy: o.cy };
    }
    gesture = { kind: "move", ids, start, orig, surface, fr };
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
  // remove items: drop the folder link FIRST (so docs→items can't recreate the
  // shape), then the shape a microtask later (after the reconcile has settled)
  function removeItems(_ignored, ids) {
    const idSet = new Set(ids);
    for (const id of ids) {
      const surface = surfaceOf(id);
      if (!surface) continue;
      const item = (surface.doc?.items || []).find((x) => x.id === id);
      if (!item) continue;
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
    const orig = it.kind === "stroke" ? it.points.map((p) => p.slice()) : { x: it.x, y: it.y, w: it.w, h: it.h };
    const ax = -hx * ob.w / 2, ay = -hy * ob.h / 2;
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
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
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

  function startGroupResize(hx, hy, e) {
    const surface = active();
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
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  // rotate a multi-selection as one: each item orbits the group centre AND spins
  // about its own centre by the same delta (strokes rotate their points)
  function startGroupRotate(e) {
    e.stopPropagation(); e.preventDefault();
    const surface = active(), frame = surface.frame;
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
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }

  function startRotate(e) {
    if (selected().length > 1) return startGroupRotate(e);
    e.stopPropagation(); e.preventDefault();
    const it = single();
    if (!it) return;
    const surface = active();
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
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
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
        if (which === "control") { o.cx = lx; o.cy = ly; return; }
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
    const sel = new Set(selected());
    if (!sel.size) return;
    active().handle.change((d) => {
      const arr = d.items;
      // clone to a plain object before re-inserting (re-inserting a live
      // automerge proxy doesn't move it)
      const cloneAt = (i) => cloneItem(arr[i]);
      if (mode === "front" || mode === "back") {
        const moved = [];
        for (let i = arr.length - 1; i >= 0; i--) if (sel.has(arr[i].id)) { moved.unshift(cloneAt(i)); arr.splice(i, 1); }
        if (mode === "front") for (const m of moved) arr.push(m);
        else for (let k = moved.length - 1; k >= 0; k--) arr.splice(0, 0, moved[k]);
      } else {
        const dir = mode === "forward" ? 1 : -1;
        const ids = selected().slice().sort((a, b) => arr.findIndex((x) => x.id === a) - arr.findIndex((x) => x.id === b));
        const seq = dir === 1 ? ids.reverse() : ids;
        for (const id of seq) { const i = arr.findIndex((x) => x.id === id); const j = i + dir; if (j < 0 || j >= arr.length || sel.has(arr[j].id)) continue; const m = cloneAt(i); arr.splice(i, 1); arr.splice(j, 0, m); }
      }
    });
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
      setActiveId("root");
      gesture = { kind: "marquee", x0: p.x, y0: p.y, add: selected() };
      setDraft({ kind: "marquee", x: p.x, y: p.y, w: 0, h: 0 });
    } else if (t === "pen" || isBrushTool(t)) {
      const bs = brushMods.get(t)?.stroke; // a custom brush (e.g. highlighter)
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
  function startPan(e) { const s = cam(); gesture = { kind: "pan", sx: e.clientX, sy: e.clientY, cx: s.x, cy: s.y }; beginGesture(e); }

  function onPointerMove(e) {
    if (!gesture) return;
    const k = gesture.kind;
    if (k === "pan") { setCam((c) => ({ ...c, x: gesture.cx + (e.clientX - gesture.sx), y: gesture.cy + (e.clientY - gesture.sy) })); return; }
    const p = toWorld(e.clientX, e.clientY);
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
          else { o.x = og.x + ldx; o.y = og.y + ldy; if (og.cx != null) { o.cx = og.cx + ldx; o.cy = og.cy + ldy; } }
        }
      });
      setDropTarget(gesture.ids.length === 1 ? moveDropTarget(gesture.surface, gesture.ids[0]) : null);
      // dragging a child OUT of its box: un-clip the box so you can see it leave
      setUnclipBox(gesture.surface.frame ? gesture.surface.id : null);
    }
  }

  function onPointerUp(e) {
    const g = gesture; gesture = null;
    setDropTarget(null); setUnclipBox(null);
    window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp);
    if (!g) return;
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
        g.surface.handle.change((dd) => { for (const id of g.ids) { const o = dd.items.find((x) => x.id === id); const og = g.orig[id]; if (!o || !og) continue; if (o.kind === "stroke") { for (let i = 0; i < o.points.length; i++) { o.points[i][0] = og.points[i][0]; o.points[i][1] = og.points[i][1]; } } else { o.x = og.x; o.y = og.y; } } });
      } else if (selected().length === 1) maybeReparent(g.surface, selected()[0]);
    }
    setDraft(null);
  }

  function selectInRect(x0, y0, x1, y1, add) {
    const minx = Math.min(x0, x1), maxx = Math.max(x0, x1), miny = Math.min(y0, y1), maxy = Math.max(y0, y1);
    const hit = [];
    for (const it of rootItems()) { const b = itemBounds(it); const cx = b.x + b.w / 2, cy = b.y + b.h / 2; if (cx >= minx && cx <= maxx && cy >= miny && cy <= maxy) hit.push(it.id); }
    setSelected(expandGroups([...new Set([...(add || []), ...hit])]));
  }

  // which root frame a moving item would drop INTO (null if none / already there)
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
    else { clone.x += dx; clone.y += dy; }
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
  function onWheel(e) {
    // a wheel that STARTS over an embedded tool (and we're not mid-pan) scrolls
    // the tool; once a pan is underway the overlay captures, so it keeps panning
    // even when the cursor wanders over a tool
    if (!e.ctrlKey && !panActive() && e.target.closest && e.target.closest(".ns-doc-body:not(.ns-frame-body)")) return;
    e.preventDefault();
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
      // fires when we add the folder link, sees it and doesn't duplicate
      const id = uid();
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
  function onDragOver(e) { if (!e.dataTransfer.types.includes(TOOL_DRAG) && !hasDocDrag(e.dataTransfer)) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
  async function onDrop(e) {
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
        layout.change((d) => { if (!d.items.some((x) => x.url === child.url)) d.items.push({ id: uid(), kind: "doc", url: child.url, x: pos.x, y: pos.y, w: 320, h: 240, rotation: 0, toolId: "" }); });
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
        const base = { id: uid(), url: it.url, x: pos.x, y: pos.y, w: 360, h: 280 };
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
    layout.change((d) => { if (!d.items.some((x) => x.url === child.url)) d.items.push({ id: uid(), kind: "doc", url: child.url, x: (r.width / 2 - c.x) / c.z - 160, y: (r.height / 2 - c.y) / c.z - 120, w: 320, h: 240, rotation: 0, toolId: "" }); });
    handle.change((d) => { if (!d.docs.some((l) => l.url === child.url)) d.docs.push({ name, type: "file", url: child.url }); });
  }

  function onKeyDown(e) {
    // Escape always works (even while an embedded tool has focus): blur it,
    // drop selection, back to the pointer
    if (e.key === "Escape") { const a = document.activeElement; if (a && a.blur) a.blur(); setSelected([]); setPlacing(null); setTool("select"); return; }
    // group / ungroup (works even with an embedded tool focused)
    if ((e.metaKey || e.ctrlKey) && (e.key === "g" || e.key === "G")) { e.preventDefault(); if (e.shiftKey) ungroupSelected(); else groupSelected(); return; }
    if (isTypingTarget(e.target)) return;
    if ((e.key === "Backspace" || e.key === "Delete") && selected().length) { e.preventDefault(); return deleteSelected(); }
    if (e.key === "]") return reorder("forward");
    if (e.key === "[") return reorder("backward");
    // number row 1..9 selects the toolbar tools in order, alongside the letters
    const order = ["select", "hand", "pen", "eraser", "rectangle", "ellipse", "arrow", "text", "box"];
    if (/^[1-9]$/.test(e.key)) { const t = order[+e.key - 1]; if (t) { setTool(t); return; } }
    const map = { v: "select", h: "hand", p: "pen", r: "rectangle", o: "ellipse", l: "line", a: "arrow", t: "text", f: "box", e: "eraser" };
    if (map[e.key]) { const t = map[e.key]; setTool(t); if (t === "line" || t === "box") setExtraShape(t); } // overflow tools surface into the bar
  }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("paste", onPaste);
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
        const id = uid();
        if (isBoxType(l.type)) d.items.push({ id, kind: "frame", url: l.url, x: bx + i * 28, y: by + i * 28, w: 360, h: 280 });
        else d.items.push({ id, kind: "doc", url: l.url, x: bx + i * 28, y: by + i * 28, w: 360, h: 280, rotation: 0, toolId: "" });
        i++;
      }
    });
  });

  // ---- presence (cursors, faces, shared view) -------------------------
  const [selfP, setSelfP] = createSignal(null);
  const [peers, setPeers] = createSignal(new Map(), { equals: false });
  const [showViews, setShowViews] = createSignal(false);
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
    const c = cam();
    const r = viewportRef?.getBoundingClientRect();
    if (!r) return null;
    const k = viewportRef.offsetWidth ? r.width / viewportRef.offsetWidth : 1;
    return { x: -c.x / c.z, y: -c.y / c.z, w: (r.width / k) / c.z, h: (r.height / k) / c.z };
  }
  let lastBroadcast = 0;
  function broadcastPresence(force) {
    const s = selfP();
    if (!s) return;
    const now = Date.now();
    if (!force && now - lastBroadcast < 55) return;
    lastBroadcast = now;
    handle.broadcast({ type: "ns-presence", contactUrl: s.contactUrl, name: s.name, color: s.color, avatarUrl: s.avatarUrl, cursor: myCursor(), view: myViewRect(), ts: now });
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
  const trackCursor = (e) => { setMyCursor(toWorld(e.clientX, e.clientY)); broadcastPresence(); };

  // bounds of everything (for the minimap), including peers' cursors
  const worldBounds = createMemo(() => {
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const it of rootItems()) { const b = itemBounds(it); minx = Math.min(minx, b.x); miny = Math.min(miny, b.y); maxx = Math.max(maxx, b.x + b.w); maxy = Math.max(maxy, b.y + b.h); }
    for (const p of peers().values()) if (p.cursor) { minx = Math.min(minx, p.cursor.x); miny = Math.min(miny, p.cursor.y); maxx = Math.max(maxx, p.cursor.x); maxy = Math.max(maxy, p.cursor.y); }
    const v = myViewRect();
    if (v) { minx = Math.min(minx, v.x); miny = Math.min(miny, v.y); maxx = Math.max(maxx, v.x + v.w); maxy = Math.max(maxy, v.y + v.h); }
    if (!isFinite(minx)) return { x: 0, y: 0, w: 1000, h: 1000 };
    const pad = 80;
    return { x: minx - pad, y: miny - pad, w: maxx - minx + 2 * pad, h: maxy - miny + 2 * pad };
  });
  function centerOn(wx, wy) {
    const r = viewportRef.getBoundingClientRect();
    const k = viewportRef.offsetWidth ? r.width / viewportRef.offsetWidth : 1;
    const c = cam();
    setCam({ ...c, x: (r.width / k) / 2 - wx * c.z, y: (r.height / k) / 2 - wy * c.z });
  }

  // ---- properties (single selection or brush) -------------------------
  const storedKey = (kind, key) => (key === "size" ? (kind === "shape" ? "strokeWidth" : kind === "text" ? "fontSize" : "size") : key);
  const editTargets = () => selected().map(itemById).filter((o) => o && (o.kind === "shape" || o.kind === "stroke" || o.kind === "text"));
  const SHAPE_ONLY = new Set(["fill", "fillStyle", "strokeStyle", "roughness", "bowing", "corner", "startArrow", "endArrow"]);
  const TEXT_ONLY = new Set(["font"]);
  function getProp(key) { const ts = editTargets(); if (ts.length) { const o = ts[0]; return o[storedKey(o.kind, key)]; } return brush[key]; }
  function setProp(key, val) {
    const ts = editTargets();
    if (ts.length) {
      active().handle.change((d) => { for (const t of ts) { const o = d.items.find((x) => x.id === t.id); if (!o || (SHAPE_ONLY.has(key) && o.kind !== "shape") || (TEXT_ONLY.has(key) && o.kind !== "text")) continue; o[storedKey(o.kind, key)] = val; } });
      // editing a selection ALSO becomes the default for the next thing you draw
      setBrush(key === "size" && ts[0].kind === "text" ? "fontSize" : key, val);
      return;
    }
    setBrush(key, val);
  }
  function setItemField(id, field, val) { active().handle.change((d) => { const o = d.items.find((x) => x.id === id); if (o) o[field] = val; }); }

  const propMode = createMemo(() => {
    const sel = selected();
    if (sel.length > 1) return "multi";
    if (sel.length === 1) { const it = itemById(sel[0]); return it ? it.kind : null; }
    if (tool() === "pen") return "stroke";
    if (SHAPE_TOOLS.has(tool())) return "shape";
    if (tool() === "text") return "text";
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
    removeItem: (id) => removeItems(null, [id]),
    dropTarget, unclipBox,
    boxBounds: (id) => { const f = rootItems().find((x) => x.id === id); return f ? itemBounds(f) : null; },
  };

  const handleBox = createMemo(() => {
    if (tool() !== "select") return null;
    if (editingId()) return null; // while editing text, show only the caret — no box/handles
    const c = cam();
    const it = single();
    if (it) {
      if (it.kind === "shape" && (it.type === "arrow" || it.type === "line")) return null; // use endpoint handles
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
    const ctrl = toScreen(it.cx != null ? it.cx : g.x + g.w / 2, it.cy != null ? it.cy : g.y + g.h / 2);
    return { start: toScreen(g.x, g.y), end: toScreen(g.x + g.w, g.y + g.h), control: ctrl };
  });
  // world bounds of the shape an arrow end is hovering, for the bind highlight
  const arrowHoverBox = createMemo(() => { const id = arrowHover(); if (!id) return null; const it = rootItems().find((x) => x.id === id); return it ? itemBounds(it) : null; });

  return (
    <div class={"ns-root " + cursorClass()} ref={viewportRef} onPointerDown={onPointerDown} onPointerMove={trackCursor} onDblClick={onCanvasDblClick} onWheel={onWheel} onDragOver={onDragOver} onDrop={onDrop}>
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
                    {(p) => <path d={p.d} stroke={p.stroke} fill={p.fill} stroke-width={p.strokeWidth} stroke-dasharray={p.dash} stroke-linecap="round" stroke-linejoin="round" fill-rule="evenodd" opacity="0.92" />}
                  </For>
                </Show>
              }>
                <path d={freehandPath(d().points, d().size, d())} style={{ fill: colorVar(d().color), opacity: d().opacity, "mix-blend-mode": d().blend }} />
              </Show>
            )}
          </Show>
          <Show when={selWorldBounds()}>{(b) => <rect class="ns-sel" x={b().x} y={b().y} width={b().w} height={b().h} />}</Show>
          <Show when={arrowHoverBox()}>{(b) => <rect class="ns-bindhl" x={b().x - 3} y={b().y - 3} width={b().w + 6} height={b().h + 6} rx="5" vector-effect="non-scaling-stroke" />}</Show>
        </g>
      </svg>

      <Show when={handleBox()}>{(b) => <Handles box={b()} onResize={startResizeSel} onRotate={startRotate} />}</Show>
      <Show when={segSel()}>{(a) => <>
        <div class="ns-end" style={{ left: `${a().start.x}px`, top: `${a().start.y}px` }} onPointerDown={(e) => startSegEnd("start", e)} />
        <div class="ns-end" style={{ left: `${a().end.x}px`, top: `${a().end.y}px` }} onPointerDown={(e) => startSegEnd("end", e)} />
        <Show when={a().control}>{(cp) => <div class="ns-end ns-ctrl" style={{ left: `${cp().x}px`, top: `${cp().y}px` }} onPointerDown={(e) => startSegEnd("control", e)} />}</Show>
      </>}</Show>

      <PresenceLayer peers={peers} cam={cam} showViews={showViews} serviceUrl={ctx.serviceUrl} />
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

// ---------------------------------------------------------------------------
function InlineEdit(props) {
  let el;
  // a textarea that edits an item's `.text`, saving to its surface
  const save = (v) => props.surface.handle.change((d) => {
    const o = d.items.find((x) => x.id === props.id);
    if (!o) return;
    o.text = v;
    if (props.autosize && el && props.wrap) {
      // fixed-width text box (excalidraw): only the height grows
      el.style.height = "0px";
      const h = Math.max(1, el.scrollHeight);
      el.style.height = h + "px";
      if (Math.abs((o.h || 0) - h) > 1) o.h = h;
    } else if (props.autosize && el) {
      // point text: grow to fit both ways — measure with the box collapsed first
      el.style.width = "0px"; el.style.height = "0px";
      const w = Math.max(8, el.scrollWidth), h = Math.max(1, el.scrollHeight);
      el.style.width = w + "px"; el.style.height = h + "px";
      if (Math.abs((o.w || 0) - w) > 1) o.w = w;
      if (Math.abs((o.h || 0) - h) > 1) o.h = h;
    } else if (el && o.kind === "text" && Math.abs((o.h || 0) - el.scrollHeight) > 1) {
      o.h = el.scrollHeight;
    }
  });
  onMount(() => { el.focus(); el.setSelectionRange(el.value.length, el.value.length); if (props.autosize) save(el.value); });
  return (
    <textarea
      ref={el}
      class={props.cls}
      classList={{ "ns-text-wrap": !!props.wrap }}
      style={props.style}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); el.blur(); } }}
      onInput={(e) => save(e.currentTarget.value)}
      onBlur={() => props.done()}
    >{props.text}</textarea>
  );
}

function Item(props) {
  const it = () => props.it;
  const ctx = props.ctx;
  // a bound arrow's geometry is DERIVED from the shapes it connects (so it
  // follows them); everything else renders from its own stored coords
  const renderIt = createMemo(() => {
    const i = it();
    if (i.kind === "shape" && i.type === "arrow" && (i.fromId || i.toId)) return { ...i, ...arrowGeometry(i, props.surface.doc?.items || []) };
    return i;
  });
  const b = createMemo(() => ctx.itemBounds(renderIt()));
  // stacking comes from the item's position in its surface's array (not DOM order)
  const z = createMemo(() => (props.surface.doc?.items || []).findIndex((x) => x.id === it().id));
  const selectMode = () => ctx.tool() === "select";
  const hittable = () => selectMode() || ctx.tool() === "eraser";
  const editing = () => ctx.editingId() === it().id;
  // while dragging this item INTO a box, preview the drop: clip it to the box's
  // bounds (only the part that'll end up inside shows) and lift it on top
  const dropClip = () => {
    if (props.surface.frame || !ctx.isSelected(it().id)) return null; // root items only (box-local coords don't match)
    const box = ctx.dropTarget() && ctx.boxBounds(ctx.dropTarget());
    if (!box) return null;
    const a = b();
    const top = Math.max(0, box.y - a.y), left = Math.max(0, box.x - a.x);
    const right = Math.max(0, (a.x + a.w) - (box.x + box.w)), bottom = Math.max(0, (a.y + a.h) - (box.y + box.h));
    return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
  };
  const baseStyle = () => {
    const clip = dropClip();
    return { left: `${b().x}px`, top: `${b().y}px`, width: `${b().w}px`, height: `${b().h}px`, transform: `rotate(${it().rotation || 0}deg)`, "transform-origin": "center", "z-index": clip ? 8000 : z() + 1, ...(clip ? { "clip-path": clip } : {}) };
  };
  const down = (e) => ctx.onItemDown(it(), props.surface, e);
  const edit = () => { if (selectMode()) ctx.setEditingId(it().id); };

  // keep a text item's stored w/h in sync with the actually-rendered text, so
  // the selection box always fits (size changes from the panel re-measure too)
  let staticEl;
  createEffect(() => {
    const item = it();
    if (item.kind !== "text" || editing() || !staticEl) return;
    const _deps = [item.text, item.font, item.fontSize]; // track for re-measure
    // a wrapped text box keeps its (fixed) width, only its height grows
    const w = item.wrap ? (item.w || 0) : Math.max(8, staticEl.offsetWidth);
    const h = Math.max(1, staticEl.offsetHeight);
    if ((!item.wrap && Math.abs((item.w || 0) - w) > 1) || Math.abs((item.h || 0) - h) > 1)
      props.surface.handle.change((d) => { const o = d.items.find((x) => x.id === item.id); if (o && o.kind === "text") { if (!item.wrap) o.w = w; o.h = h; } });
  });

  return (
    <Show when={it().kind === "doc" || it().kind === "frame"} fallback={
      <Show when={it().kind === "text"} fallback={
        // ---- shape / stroke ----
        <div class="ns-mark" style={baseStyle()}>
          <svg class="ns-mark-svg" style={{ overflow: "visible" }}>
            <g transform={`translate(${-b().x}, ${-b().y})`}>
              <Show when={it().kind === "stroke"} fallback={
                <For each={(ctx.themeTick(), shapePaths(shapeRenderProps(renderIt(), ctx.resolveColor)))}>
                  {(p) => <path d={p.d} stroke={p.stroke} fill={p.fill} stroke-width={p.strokeWidth} stroke-dasharray={p.dash} stroke-linecap="round" stroke-linejoin="round" fill-rule="evenodd" />}
                </For>
              }>
                <path d={freehandPath(it().points, it().size, it())} style={{ fill: colorVar(it().color), opacity: it().opacity, "mix-blend-mode": it().blend }} />
              </Show>
            </g>
            </svg>
          <Show when={it().kind === "shape"}>
            <Show when={editing()} fallback={
              <Show when={it().text}>
                <div class="ns-shape-text" style={{ color: "var(--ns-ink)", "font-size": `${it().fontSize || 16}px` }}>{it().text}</div>
              </Show>
            }>
              <InlineEdit id={it().id} surface={props.surface} text={it().text || ""} cls="ns-shape-edit" style={{ "font-size": `${it().fontSize || 16}px` }} done={() => ctx.setEditingId(null)} />
            </Show>
          </Show>
          <Show when={hittable() && !editing()}>
            <Show when={it().kind === "shape" && (it().type === "line" || it().type === "arrow")} fallback={
              <div class="ns-hit" onPointerDown={down} onDblClick={() => it().kind === "shape" && edit()} />
            }>
              {/* a line/arrow is hit only ALONG the stroke, not its bounding box */}
              <svg class="ns-hit-svg" style={{ overflow: "visible" }}>
                <g transform={`translate(${-b().x}, ${-b().y})`}>
                  {(() => { const r = renderIt(); const ex = r.x + r.w, ey = r.y + r.h; const d = (r.cx != null && r.cy != null) ? `M${r.x} ${r.y} Q${r.cx} ${r.cy} ${ex} ${ey}` : `M${r.x} ${r.y} L${ex} ${ey}`; return <path d={d} fill="none" stroke="transparent" stroke-width={Math.max(16, (it().strokeWidth || 2) + 12)} stroke-linecap="round" style={{ "pointer-events": "stroke" }} onPointerDown={down} />; })()}
                </g>
              </svg>
            </Show>
          </Show>
        </div>
      }>
        {/* ---- text ---- */}
        <div class="ns-text-item" style={baseStyle()}>
          <Show when={editing()} fallback={
            <div class="ns-text-static" classList={{ "ns-text-wrap": !!it().wrap }} ref={staticEl} style={{ color: colorVar(it().color), "font-family": fontFamily(it().font), "font-size": `${it().fontSize || 20}px`, ...(it().wrap ? { width: `${it().w}px` } : {}) }} onPointerDown={(e) => hittable() && down(e)} onDblClick={edit}>
              {it().text || ""}
            </div>
          }>
            <InlineEdit id={it().id} surface={props.surface} text={it().text || ""} cls="ns-text-edit" autosize wrap={!!it().wrap} style={{ color: colorVar(it().color), "font-family": fontFamily(it().font), "font-size": `${it().fontSize || 20}px`, ...(it().wrap ? { width: `${it().w}px` } : {}) }} done={() => { ctx.setEditingId(null); if (!(it().text || "").trim()) ctx.removeItem(it().id); }} />
          </Show>
        </div>
      </Show>
    }>
      <DocOrFrame it={it} b={b} ctx={ctx} surface={props.surface} depth={props.depth || 0} baseStyle={baseStyle} selectMode={selectMode} />
    </Show>
  );
}

function DocOrFrame(props) {
  const it = props.it;
  const b = props.b;
  const ctx = props.ctx;
  const isFrame = () => it().kind === "frame";
  const seed = createMemo(() => seedFromId(it().id));
  const outline = createMemo(() => roughRectPath(b().w, b().h, seed()));

  const isWell = () => isFrame() && !!it().well;
  const isList = () => isFrame() && it().style === "list";
  // render box CONTENTS only ~2 levels deep; deeper boxes are just named (and
  // we don't load their surface, which also stops any cyclic nesting)
  const tooDeep = () => (props.depth || 0) >= 2;
  // the folder link for this item lives in ITS surface's folder doc
  const link = () => props.surface.folderDoc?.docs.find((l) => l.url === it().url);

  // a box loads + manages a SEPARATE space (folder doc + its layout doc) as a surface
  const [space, setSpace] = createSignal(null);
  createEffect(() => { if (isFrame() && !tooDeep()) ctx.loadSpace(it().url).then((s) => s && setSpace(s)); });
  const childSurface = createMemo(() => {
    const s = space();
    if (!s) return null;
    return { id: it().url, handle: s.layoutHandle, doc: makeDocumentProjection(s.layoutHandle), folderHandle: s.folderHandle, folderDoc: makeDocumentProjection(s.folderHandle), frame: it() };
  });
  createEffect(() => { const s = childSurface(); if (s) { ctx.registerSurface(s.id, s); onCleanup(() => ctx.unregisterSurface(s.id)); } });
  // a canvas box reconciles its folder's links into positioned layout items
  // (so an embedded folder shows its contents laid out on the canvas)
  createEffect(() => {
    const s = childSurface();
    if (!s || isList()) return;
    const missing = linksNeedingItems(s.folderDoc.docs, s.doc.items, ctx.tombstoned);
    if (!missing.length) return;
    s.handle.change((d) => {
      let i = 0;
      for (const l of missing) {
        if (d.items.some((x) => x.url === l.url)) continue;
        const id = uid();
        if (isBoxType(l.type)) d.items.push({ id, kind: "frame", url: l.url, x: 24 + i * 26, y: 24 + i * 26, w: 300, h: 220 });
        else d.items.push({ id, kind: "doc", url: l.url, x: 24 + i * 26, y: 24 + i * 26, w: 300, h: 220, rotation: 0, toolId: "" });
        i++;
      }
    });
  });

  // resolve the doc's REAL title via its datatype's getTitle (a box reads its
  // FOLDER doc; a plain doc loads itself), reactive to the doc's own changes
  const [docHandle, setDocHandle] = createSignal(null);
  createEffect(() => { if (!isFrame()) ctx.loadDoc(it().url).then((h) => h && setDocHandle(h)); });
  const proj = createMemo(() => (isFrame() ? childSurface()?.folderDoc : (docHandle() ? makeDocumentProjection(docHandle()) : null)));
  // the datatype comes from the DOC's own @patchwork.type (the link's type can
  // be empty/stale), so getTitle uses the right datatype
  const [dt, setDt] = createSignal(null);
  createEffect(() => { const p = proj(); const t = (p && getType(p)) || link()?.type; if (t) ctx.loadDatatype(t).then(setDt); });
  const title = createMemo(() => {
    const p = proj(), d = dt();
    if (p && d) { const gt = d.getTitle || d.module?.getTitle; if (gt) { try { const t = gt(p); if (t) return t; } catch {} } }
    return p?.title || link()?.name || "Untitled";
  });

  let bodyRef;
  const grab = (e) => {
    const t = ctx.tool();
    if (t !== "select" && t !== "eraser") return;
    // only THIS doc's own body should be left for the embedded tool — an
    // ancestor frame's body must not swallow a child's grab
    if (bodyRef && bodyRef.contains(e.target)) return;
    ctx.onItemDown(it(), props.surface, e);
  };
  // patchwork-views/boxes are interactive INSIDE and only grabbable by their
  // edges + title (never grab-from-the-middle). So the body stays live; a deep
  // stub is grab-anywhere.
  const bodyPE = () => {
    if (tooDeep()) return "none";
    if (isFrame() && !isList()) return "auto"; // canvas box: children manage
    return props.selectMode() ? "auto" : "none"; // doc / list box: live in select
  };
  const openToolId = () => isFrame() ? (isList() ? "folder-viewer" : "newspace") : it().toolId || undefined;
  const open = (e) => {
    e.stopPropagation();
    e.currentTarget.dispatchEvent(new CustomEvent("patchwork:open-document", {
      detail: { url: it().url, toolId: openToolId(), title: title() },
      bubbles: true, composed: true,
    }));
  };

  // double-click the title to rename the underlying doc (via its datatype)
  const [titleEditing, setTitleEditing] = createSignal(false);
  function saveTitle(v) {
    const h = isFrame() ? childSurface()?.folderHandle : docHandle();
    const d = dt();
    if (!h) return;
    h.change((doc) => { const st = d && (d.setTitle || d.module?.setTitle); if (st) st(doc, v); else doc.title = v; });
  }

  return (
    <div class="ns-doc" classList={{ "ns-frame": isFrame(), well: isFrame() && !!it().well, sel: ctx.isSelected(it().id), "ns-drop-into": isFrame() && ctx.dropTarget() === it().id }} {...(it().theme ? { theme: it().theme } : {})} style={props.baseStyle()} onPointerDown={grab}>
      <div class="ns-doc-title">
        <Show when={titleEditing()} fallback={
          <span class="ns-doc-name" onDblClick={(e) => { e.stopPropagation(); if (props.selectMode()) setTitleEditing(true); }}>{title()}</span>
        }>
          <input class="ns-title-edit" autofocus value={title()} onPointerDown={(e) => e.stopPropagation()}
            onChange={(e) => { saveTitle(e.currentTarget.value); setTitleEditing(false); }}
            onKeyDown={(e) => { if (e.key === "Enter") { saveTitle(e.currentTarget.value); setTitleEditing(false); e.currentTarget.blur(); } else if (e.key === "Escape") setTitleEditing(false); }}
            onBlur={() => setTitleEditing(false)} />
        </Show>
        <Show when={ctx.isSelected(it().id)}>
          <button class="ns-doc-open" title="Open this document" onPointerDown={(e) => e.stopPropagation()} onClick={open}>enter</button>
        </Show>
      </div>
      <Show when={!isWell()}>
        <svg class="ns-doc-outline" style={{ overflow: "visible" }}>
          <For each={outline()}>{(p) => <path d={p.d} stroke="currentColor" fill="none" stroke-width={p.strokeWidth} stroke-linecap="round" />}</For>
        </svg>
      </Show>
      <div class="ns-doc-body" ref={(el) => { bodyRef = el; enableAtomicMove(el); }} classList={{ "ns-frame-body": isFrame() && !isList(), "ns-unclip": ctx.unclipBox() === it().url }} style={{ "pointer-events": bodyPE() }} onFocusIn={() => ctx.deselect()}>
        <Show when={isFrame()} fallback={
          <Show when={link()?.type === "file"} fallback={
            // @ts-ignore custom element
            <patchwork-view doc-url={it().url} {...(it().toolId ? { "tool-id": it().toolId } : {})} style="display:block;width:100%;height:100%" />
          }>
            <img class="ns-doc-img" src={ctx.serviceUrl(it().url)} alt={title()} />
          </Show>
        }>
          <Show when={!tooDeep()} fallback={<div class="ns-box-stub">{title()}</div>}>
            <Show when={isList()} fallback={
              <Show when={childSurface()}>
                <For each={sortById(childSurface().doc.items)}>{(child) => <Item it={child} surface={childSurface()} ctx={ctx} depth={(props.depth || 0) + 1} />}</For>
              </Show>
            }>
              {/* list style: render the box's doc with the folder viewer */}
              <patchwork-view doc-url={it().url} tool-id="folder-viewer" style="display:block;width:100%;height:100%" />
            </Show>
          </Show>
        </Show>
      </div>
      {/* interiors are interactive, so a doc/box is only movable by its outline:
          thin grab strips around the edge (select/eraser only, so drawing at
          the edge still works) */}
      <Show when={!tooDeep() && (ctx.tool() === "select" || ctx.tool() === "eraser")}>
        <div class="ns-grabframe">
          <div class="ns-gf ns-gf-t" onPointerDown={grab} />
          <div class="ns-gf ns-gf-b" onPointerDown={grab} />
          <div class="ns-gf ns-gf-l" onPointerDown={grab} />
          <div class="ns-gf ns-gf-r" onPointerDown={grab} />
        </div>
      </Show>
      {/* the well shadow sits ABOVE the contents so the box looks sunken */}
      <Show when={isWell()}><div class="ns-well" /></Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// presence
function Face(props) {
  const img = () => (props.entry.avatarUrl ? props.serviceUrl(props.entry.avatarUrl) : null);
  return (
    <div class="ns-face" style={{ "--c": props.entry.color || "#888", ...(img() ? { "background-image": `url("${img()}")`, color: "transparent" } : {}) }} title={props.entry.name}>
      {(props.entry.name || "?")[0].toUpperCase()}
    </div>
  );
}
function PresenceLayer(props) {
  const list = () => [...props.peers().values()];
  const sx = (wx) => wx * props.cam().z + props.cam().x;
  const sy = (wy) => wy * props.cam().z + props.cam().y;
  return (
    <div class="ns-presence">
      <Show when={props.showViews()}>
        <For each={list()}>
          {(p) => (
            <Show when={p.view}>
              <div class="ns-view-box" style={{ left: `${sx(p.view.x)}px`, top: `${sy(p.view.y)}px`, width: `${p.view.w * props.cam().z}px`, height: `${p.view.h * props.cam().z}px`, "border-color": p.color, background: `color-mix(in srgb, ${p.color}, transparent 50%)` }}>
                <span class="ns-view-tag" style={{ background: p.color }}>{p.name}</span>
              </div>
            </Show>
          )}
        </For>
      </Show>
      <For each={list()}>
        {(p) => (
          <Show when={p.cursor}>
            <div class="ns-cursor" style={{ left: `${sx(p.cursor.x)}px`, top: `${sy(p.cursor.y)}px`, color: p.color }}>
              <svg viewBox="0 0 16 16" width="18" height="18"><path d="M2 1l11 5.5-4.6 1.4L6.2 13z" fill="currentColor" stroke="#fff" stroke-width="1" stroke-linejoin="round" /></svg>
              <div class="ns-cursor-tag" style={{ background: p.color }}>
                <Face entry={p} serviceUrl={props.serviceUrl} />
                <span>{p.name}</span>
              </div>
            </div>
          </Show>
        )}
      </For>
    </div>
  );
}
function Minimap(props) {
  const SIZE = { w: 180, h: 130 };
  const scale = () => { const b = props.bounds(); return Math.min(SIZE.w / b.w, SIZE.h / b.h); };
  const fx = (wx) => (wx - props.bounds().x) * scale();
  const fy = (wy) => (wy - props.bounds().y) * scale();
  const list = () => [...props.peers().values()];
  function jump(e) {
    const r = e.currentTarget.getBoundingClientRect();
    const b = props.bounds(), s = scale();
    props.onJump(b.x + (e.clientX - r.left) / s, b.y + (e.clientY - r.top) / s);
  }
  return (
    <div class="ns-minimap" style={{ width: `${SIZE.w}px`, height: `${SIZE.h}px` }} onPointerDown={(e) => { e.stopPropagation(); jump(e); }}>
      <For each={props.rects()}>
        {(r) => <div class="ns-mm-rect" classList={{ box: r.box }} style={{ left: `${fx(r.x)}px`, top: `${fy(r.y)}px`, width: `${Math.max(1, r.w * scale())}px`, height: `${Math.max(1, r.h * scale())}px` }} />}
      </For>
      <Show when={props.view()}>
        <div class="ns-mm-view" style={{ left: `${fx(props.view().x)}px`, top: `${fy(props.view().y)}px`, width: `${props.view().w * scale()}px`, height: `${props.view().h * scale()}px` }} />
      </Show>
      <For each={list()}>
        {(p) => (
          <Show when={p.cursor}>
            <div class="ns-mm-face" style={{ left: `${fx(p.cursor.x)}px`, top: `${fy(p.cursor.y)}px` }}>
              <Face entry={p} serviceUrl={props.serviceUrl} />
            </div>
          </Show>
        )}
      </For>
    </div>
  );
}

// ---------------------------------------------------------------------------
const HDIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const hCursor = (hx, hy) => (hx === 0 ? "ns-resize" : hy === 0 ? "ew-resize" : hx === hy ? "nwse-resize" : "nesw-resize");
function Handles(props) {
  const box = () => props.box;
  return (
    <div class="ns-handles" style={{ left: `${box().x}px`, top: `${box().y}px`, width: `${box().w}px`, height: `${box().h}px`, transform: `rotate(${box().rot}deg)` }}>
      <For each={HDIRS}>{([hx, hy]) => <div class="ns-handle" style={{ left: `${((hx + 1) / 2) * 100}%`, top: `${((hy + 1) / 2) * 100}%`, cursor: hCursor(hx, hy) }} onPointerDown={(e) => props.onResize(hx, hy, e)} />}</For>
      <div class="ns-rotate" onPointerDown={(e) => props.onRotate(e)} />
      <div class="ns-rotate-stem" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// id -> [label, icon path]
const TOOL_META = {
  select: ["Select  (V)", "M4 3l14 6-6 2-2 6z"],
  hand: ["Pan  (H)", "M7 11V6a1.5 1.5 0 013 0v4m0-4.5a1.5 1.5 0 013 0V11m0-3a1.5 1.5 0 013 0v5a5 5 0 01-5 5h-2a4 4 0 01-3-1.7L6 16"],
  pen: ["Draw  (P)", "M3 17l9-9 3 3-9 9H3v-3zM13 6l2-2 3 3-2 2z"],
  eraser: ["Eraser  (E)", "M4 14l7-7 7 7-5 5H8z"],
  rectangle: ["Rectangle  (R)", "M3 5h16v12H3z"],
  ellipse: ["Ellipse  (O)", "M11 5a8 6 0 100 12 8 6 0 000-12z"],
  line: ["Line  (L)", "M4 18L18 5"],
  arrow: ["Arrow  (A)", "M4 18L17 6m0 0H9m8 0v8"],
  text: ["Text  (T)", "M5 6h12M11 6v11"],
  box: ["Box  (F)", "M8 3H3V8 M14 3H19V8 M14 19H19V14 M8 19H3V14"],
  highlighter: ["Highlighter", "M5 15l7-7 4 4-7 7H5v-4z M14 6l3-3 3 3-3 3z M4 21h8"],
};
const SHAPE_DRAGGABLE = new Set(["rectangle", "ellipse", "line", "arrow"]);

// little hand-drawn "stamps" — multi-stroke line drawings. Dragging the matching
// toolbar item drops them onto the canvas as freehand (pencil) strokes; the same
// paths render the toolbar glyph. Each path string is one stroke.
const STAMPS = {
  // the cat face (replaces the old ◕ᴥ◕)
  face: { view: "0 0 64 52", paths: [
    "M17 31 L25 14 L31 29", "M33 29 L40 14 L47 31",
    "M31 30 C27.5 30 27.5 41 31 41 C34.5 41 34.5 30 31 30",
    "M28 33 L8 31", "M27 36 L10 45", "M28 39 L18 51",
    "M35 33 L57 30", "M35 37 L53 43",
  ] },
  // a pencil (for the pen tool)
  pencil: { view: "0 0 48 48", paths: [
    "M10 38 L30 18 L34 22 L14 42 Z", "M10 38 L14 42 L7 45 Z", "M28 20 L32 24",
  ] },
  // an open hand — 4 fingers + thumb (for the hand tool)
  hand: { view: "0 0 110 124", paths: [
    "M34 116 C31 104 31 96 34 82 C27 76 17 68 15 58 C13 52 21 49 27 56 C32 62 37 70 39 74 L39 36 C39 27 51 27 51 36 L51 54 L53 54 L53 26 C53 17 65 17 65 26 L65 54 L67 54 L67 32 C67 23 79 23 79 32 L79 56 L81 56 L81 44 C81 36 91 36 91 46 C93 68 93 100 88 116 C80 122 42 122 34 116 Z",
  ] },
  // a head-down mouse with a big ear and a long curling tail (for select)
  mouse: { view: "0 0 120 120", paths: [
    "M34 104 C26 98 24 84 30 70 C36 48 54 34 74 40 C88 44 92 60 86 76 C80 92 60 102 44 100 C40 99 36 106 34 104 Z",
    "M58 42 C54 24 80 22 84 40 C86 50 80 58 70 56",
    "M66 44 C64 36 76 34 78 44",
    "M33 103 C29 105 29 110 34 110 C38 110 38 105 34 103",
    "M33 107 L13 112", "M34 110 L15 120", "M35 105 L16 100",
    "M48 84 C46 82 50 80 51 84",
    "M72 42 C96 33 108 54 96 72 C90 81 83 83 79 78",
  ] },
};
const STAMP_IDS = new Set(["face", "pencil", "hand", "mouse"]);
// sample an SVG path into [x,y] points (a temp, offscreen <path> does the maths)
let _samplePath;
function sampleSvgPath(d, step = 2.5) {
  if (!_samplePath) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none";
    _samplePath = document.createElementNS(NS, "path");
    svg.appendChild(_samplePath);
    document.body.appendChild(svg);
  }
  _samplePath.setAttribute("d", d);
  const len = _samplePath.getTotalLength();
  const n = Math.max(2, Math.ceil(len / step));
  const pts = [];
  for (let i = 0; i <= n; i++) { const pt = _samplePath.getPointAtLength((i / n) * len); pts.push([pt.x, pt.y]); }
  return pts;
}
function Icon(props) {
  return (<svg viewBox="0 0 22 22" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={props.d} /></svg>);
}
// one toolbar button; shape tools are draggable onto the canvas (drops a drawn one)
function ToolBtn(props) {
  const meta = () => TOOL_META[props.id] || [props.id, "M5 5h12v12H5z"];
  const dragId = () => props.dragId || props.id;
  const draggable = () => SHAPE_DRAGGABLE.has(dragId()) || STAMP_IDS.has(dragId());
  return (
    <button class="ns-tool" classList={{ active: props.tool() === props.id }} title={(props.label || meta()[0]) + (draggable() ? "  ·  drag to canvas" : "")}
      draggable={draggable()}
      onDragStart={(e) => { e.dataTransfer.setData("text/x-newspace-tool", dragId()); e.dataTransfer.effectAllowed = "copy"; }}
      onClick={() => props.onClick ? props.onClick() : props.setTool(props.id)}>
      <Icon d={meta()[1]} />
    </button>
  );
}
function Toolbar(props) {
  const armOverflow = (id) => { props.setExtraShape(id); props.setTool(id); props.setShapeMenuOpen(false); };
  const [docQuery, setDocQuery] = createSignal("");
  createEffect(() => { if (!props.addOpen()) setDocQuery(""); });
  const docList = createMemo(() => {
    const q = docQuery().trim().toLowerCase();
    const label = (dt) => (dt.name || dt.id || "").toLowerCase();
    return props.datatypes()
      .filter((dt) => !q || label(dt).includes(q) || (dt.id || "").toLowerCase().includes(q))
      .sort((a, b) => label(a).localeCompare(label(b)));
  });
  return (
    <div class="ns-toolbar" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {/* nav + draw (eraser sits beside the pencil); each drags out as a drawing */}
      <ToolBtn id="select" dragId="mouse" tool={props.tool} setTool={props.setTool} />
      <ToolBtn id="hand" dragId="hand" tool={props.tool} setTool={props.setTool} />
      <ToolBtn id="pen" dragId="pencil" tool={props.tool} setTool={props.setTool} />
      <ToolBtn id="eraser" tool={props.tool} setTool={props.setTool} />
      <div class="ns-sep" />
      {/* shapes: rectangle, ellipse, arrow, text, the last-used overflow item, then ▾ */}
      <ToolBtn id="rectangle" tool={props.tool} setTool={props.setTool} />
      <ToolBtn id="ellipse" tool={props.tool} setTool={props.setTool} />
      <ToolBtn id="arrow" tool={props.tool} setTool={props.setTool} />
      <ToolBtn id="text" tool={props.tool} setTool={props.setTool} />
      <ToolBtn id={props.extraShape()} tool={props.tool} setTool={props.setTool} />
      <div class="ns-add-wrap">
        <button class="ns-tool" classList={{ active: props.shapeMenuOpen() }} title="More shapes" onClick={() => { props.setShapeMenuOpen(!props.shapeMenuOpen()); props.setAddOpen(false); }}><Icon d="M6 8l5 5 5-5" /></button>
        <Show when={props.shapeMenuOpen()}>
          <div class="ns-menu ns-menu-grid" onWheel={(e) => e.stopPropagation()}>
            <button class="ns-tool" title="Line" classList={{ active: props.tool() === "line" }} onClick={() => armOverflow("line")}><Icon d={TOOL_META.line[1]} /></button>
            <button class="ns-tool" title="Box" classList={{ active: props.tool() === "box" }} onClick={() => armOverflow("box")}><Icon d={TOOL_META.box[1]} /></button>
            <For each={props.brushes()}>{(b) => <button class="ns-tool" title={b.name || b.id} classList={{ active: props.tool() === b.id }} onClick={() => armOverflow(b.id)}><Icon d={(TOOL_META[b.id] || [, "M5 16c4-1 5-9 9-10M14 6l3-2"])[1]} /></button>}</For>
          </div>
        </Show>
      </div>
      <div class="ns-sep" />
      {/* docs overflow — a little window with a titlebar + three dots */}
      <div class="ns-add-wrap">
        <button class="ns-tool ns-add" classList={{ active: props.tool() === "place" || props.addOpen() }} title="New document" onClick={() => { props.setAddOpen(!props.addOpen()); props.setShapeMenuOpen(false); }}>
          <svg viewBox="0 0 22 22" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3.5" y="4" width="15" height="14" rx="1.5" /><path d="M3.5 8h15" /><circle cx="6" cy="6" r="0.6" fill="currentColor" stroke="none" /><circle cx="8" cy="6" r="0.6" fill="currentColor" stroke="none" /><circle cx="10" cy="6" r="0.6" fill="currentColor" stroke="none" /><path d="M6.5 11.5h9M6.5 14.5h6" stroke-width="1.2" opacity="0.7" />
          </svg>
        </button>
        <Show when={props.addOpen()}>
          <div class="ns-menu" onWheel={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            <input class="ns-text ns-menu-search" autofocus placeholder="search documents…" value={docQuery()} onInput={(e) => setDocQuery(e.currentTarget.value)} />
            <For each={docList()}>{(dt) => <button class="ns-menu-item" onClick={() => props.selectPlacing(dt)}>{dt.name || dt.id}</button>}</For>
          </div>
        </Show>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// a searchable tool selector (like patchwork-base's open-with): filter the
// supported tools, click one, or type any tool id and press Enter.
function ToolPicker(props) {
  const [text, setText] = createSignal(props.value() || "");
  const [open, setOpen] = createSignal(false);
  createEffect(() => { if (!open()) setText(props.value() || ""); });
  const filtered = createMemo(() => {
    const q = text().toLowerCase();
    return (props.tools() || []).filter((t) => !q || (t.name || t.id).toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
  });
  const commit = (v) => { props.onPick((v || "").trim()); setOpen(false); };
  return (
    <div class="ns-picker">
      <input
        class="ns-text"
        placeholder="default"
        value={text()}
        onFocus={() => setOpen(true)}
        onInput={(e) => { setText(e.currentTarget.value); setOpen(true); }}
        onChange={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { commit(e.currentTarget.value); e.currentTarget.blur(); } }}
      />
      <Show when={open() && filtered().length}>
        <div class="ns-picker-list">
          <button class="ns-picker-item" onPointerDown={(e) => e.preventDefault()} onClick={() => { setText(""); commit(""); }}>default</button>
          <For each={filtered()}>
            {(t) => <button class="ns-picker-item" onPointerDown={(e) => e.preventDefault()} onClick={() => { setText(t.id); commit(t.id); }}>{t.name || t.id}</button>}
          </For>
        </div>
      </Show>
    </div>
  );
}

const FONT_SIZES = [
  { label: "S", size: 18 },
  { label: "M", size: 26 },
  { label: "L", size: 40 },
  { label: "XL", size: 60 },
];
function Properties(props) {
  const g = props.get, s = props.set, mode = props.mode;
  const isStroke = () => mode() === "stroke";
  const isShape = () => mode() === "shape";
  const isMulti = () => mode() === "multi";
  const isText = () => mode() === "text";
  const isDoc = () => mode() === "doc";
  const isFrame = () => mode() === "frame";
  const hasStroke = () => isStroke() || isShape() || isMulti();
  // only closed shapes (rectangle/ellipse) take a fill — not arrows/lines
  const hasFill = () => (isShape() && props.fillable()) || isMulti();
  const fillVal = createMemo(() => g("fill"));

  function startDrag(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, o = props.pos();
    const move = (ev) => props.setPos({ x: o.x + (ev.clientX - sx), y: o.y + (ev.clientY - sy) });
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  }
  const docTools = createMemo(() => { const it = props.single(); if (!it || it.kind !== "doc") return []; const type = props.linkFor(it.url)?.type; try { return type ? getSupportedToolsForType(type) : []; } catch { return []; } });

  return (
    <div class="ns-props" style={{ left: `${props.pos().x}px`, top: `${props.pos().y}px` }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div class="ns-props-head" onPointerDown={startDrag}>
        <span class="ns-grip" />
        {isStroke() ? "Ink" : isShape() ? "Shape" : isText() ? "Text" : isMulti() ? "Multiple" : isFrame() ? "Box" : isDoc() ? "Document" : "Tool"}
      </div>

      <Show when={isText()}>
        <div class="ns-field">color</div>
        <div class="ns-row ns-swatches"><For each={PALETTE}>{(c) => <button class="ns-swatch" classList={{ active: g("color") === c }} style={{ background: colorVar(c) }} onClick={() => s("color", c)} />}</For></div>
        <div class="ns-field">font</div>
        <div class="ns-row ns-order">
          <For each={FONT_OPTIONS}>{(f) => <button class="ns-obtn" classList={{ active: (g("font") || "hand") === f }} style={{ "font-family": fontFamily(f) }} onClick={() => s("font", f)}>Aa</button>}</For>
        </div>
        <div class="ns-field">size</div>
        <div class="ns-row ns-order"><For each={FONT_SIZES}>{(fs) => <button class="ns-obtn" classList={{ active: g("size") === fs.size }} onClick={() => s("size", fs.size)}>{fs.label}</button>}</For></div>
      </Show>

      <Show when={hasStroke()}>
        <div class="ns-field">color</div>
        <div class="ns-row ns-swatches"><For each={PALETTE}>{(c) => <button class="ns-swatch" classList={{ active: g("color") === c }} style={{ background: colorVar(c) }} onClick={() => s("color", c)} />}</For></div>
        <div class="ns-field">how fat</div>
        <div class="ns-row ns-sizes"><For each={SIZES}>{(sz) => <button class="ns-size" classList={{ active: g("size") === sz }} onClick={() => s("size", sz)}><span class="ns-fatline" style={{ height: `${Math.max(2, sz)}px` }} /></button>}</For></div>
        <Show when={isShape()}>
          <div class="ns-field">stroke style</div>
          <div class="ns-row ns-styles">
            <For each={STROKE_STYLES}>{(ss) => <button class="ns-stylebtn" classList={{ active: (g("strokeStyle") || "solid") === ss }} title={ss} onClick={() => s("strokeStyle", ss)}><span class="ns-strokeprev" style={{ "border-top-style": ss }} /></button>}</For>
          </div>
        </Show>
        <Show when={props.arrow()}>
          <div class="ns-field">arrowheads</div>
          <div class="ns-row ns-order">
            <button class="ns-obtn ns-iconbtn" classList={{ active: g("startArrow") === true }} title="start" onClick={() => s("startArrow", g("startArrow") !== true)}><svg viewBox="0 0 24 12" width="30" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 6H3M3 6l5-3M3 6l5 3" /></svg></button>
            <button class="ns-obtn ns-iconbtn" classList={{ active: g("endArrow") !== false }} title="end" onClick={() => s("endArrow", g("endArrow") === false)}><svg viewBox="0 0 24 12" width="30" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6h19M21 6l-5-3M21 6l-5 3" /></svg></button>
          </div>
        </Show>
      </Show>

      <Show when={hasFill()}>
        <div class="ns-field">fill</div>
        <div class="ns-row ns-swatches ns-fillswatches">
          <button class="ns-swatch ns-none" classList={{ active: fillVal() === "none" }} title="no fill" onClick={() => s("fill", "none")} />
          <button class="ns-swatch" classList={{ active: fillVal() === "paper" }} title="canvas colour" style={{ background: FILL_BG }} onClick={() => s("fill", "paper")} />
          <For each={PALETTE}>{(c) => <button class="ns-swatch" classList={{ active: fillVal() === c }} style={{ background: fillVar(c) }} onClick={() => s("fill", c)} />}</For>
        </div>
        <Show when={fillVal() && fillVal() !== "none"}>
          <div class="ns-field">fill style</div>
          <div class="ns-row ns-styles">
            <For each={FILL_STYLES}>{(f) => <button class="ns-stylebtn" classList={{ active: (g("fillStyle") || "solid") === f }} title={f} onClick={() => s("fillStyle", f)}><span style={FILL_PREVIEW[f]} /></button>}</For>
          </div>
        </Show>
      </Show>

      <Show when={isShape()}>
        <div class="ns-field">sketchiness</div>
        <div class="ns-row ns-order">
          <For each={ROUGHNESS_LEVELS}>{(lvl) => <button class="ns-obtn ns-iconbtn" title={lvl.label} classList={{ active: (g("roughness") ?? 1.5) === lvl.roughness }} onClick={() => { s("roughness", lvl.roughness); s("bowing", lvl.bowing); }}><svg viewBox="0 0 24 18" width="24" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={lvl.icon} /></svg></button>}</For>
        </div>
        <Show when={props.rect()}>
          <div class="ns-field">corners</div>
          <div class="ns-row ns-order">
            <For each={CORNERS}>{(cn) => <button class="ns-obtn ns-iconbtn" title={cn.key} classList={{ active: (g("corner") || "squircle") === cn.key }} onClick={() => s("corner", cn.key)}><svg viewBox="0 0 18 18" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={cn.icon} /></svg></button>}</For>
          </div>
        </Show>
      </Show>

      <Show when={isFrame()}>
        <div class="ns-field">box style</div>
        <div class="ns-row ns-order">
          <button class="ns-obtn" classList={{ active: (props.single()?.style || "canvas") === "canvas" }} onClick={() => props.setField(props.single().id, "style", "canvas")}>canvas</button>
          <button class="ns-obtn" classList={{ active: props.single()?.style === "list" }} onClick={() => props.setField(props.single().id, "style", "list")}>list</button>
        </div>
        <label class="ns-check"><input type="checkbox" checked={!!props.single()?.well} onChange={(e) => props.setField(props.single().id, "well", e.currentTarget.checked)} /><span>well (inset)</span></label>
        <div class="ns-field">theme</div>
        <input class="ns-text" placeholder="(inherit)" value={props.single()?.theme || ""} onChange={(e) => props.setField(props.single().id, "theme", e.currentTarget.value.trim())} />
      </Show>

      <Show when={isDoc()}>
        <div class="ns-field">document url</div>
        <input class="ns-text" value={props.single()?.url || ""} onChange={(e) => props.setField(props.single().id, "url", e.currentTarget.value.trim())} />
        <div class="ns-field">tool</div>
        <ToolPicker value={() => props.single()?.toolId || ""} tools={docTools} onPick={(v) => props.setField(props.single().id, "toolId", v)} />
        <div class="ns-field">theme</div>
        <input class="ns-text" placeholder="(inherit)" value={props.single()?.theme || ""} onChange={(e) => props.setField(props.single().id, "theme", e.currentTarget.value.trim())} />
      </Show>

      <Show when={(props.selCount() > 1 && !props.hasGroup()) || props.hasGroup()}>
        <div class="ns-field">group</div>
        <div class="ns-row ns-order">
          <Show when={props.selCount() > 1 && !props.hasGroup()}>
            <button class="ns-obtn" title="Group  (⌘G)" onClick={() => props.group()}>group</button>
          </Show>
          <Show when={props.hasGroup()}>
            <button class="ns-obtn" title="Ungroup  (⇧⌘G)" onClick={() => props.ungroup()}>ungroup</button>
          </Show>
        </div>
      </Show>

      <Show when={props.hasSel()}>
        <div class="ns-field">arrange</div>
        <div class="ns-row ns-order">
          <button class="ns-obtn" title="Send to back" onClick={() => props.reorder("back")}>⤓</button>
          <button class="ns-obtn" title="Send backward" onClick={() => props.reorder("backward")}>↓</button>
          <button class="ns-obtn" title="Bring forward" onClick={() => props.reorder("forward")}>↑</button>
          <button class="ns-obtn" title="Bring to front" onClick={() => props.reorder("front")}>⤒</button>
        </div>
      </Show>
    </div>
  );
}
