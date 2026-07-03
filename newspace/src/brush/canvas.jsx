import { render } from "solid-js/web";
import { createSignal, createMemo, createEffect, For, Show, onCleanup, onMount, untrack } from "solid-js";
import { createStore } from "solid-js/store";
import { makeDocumentProjection } from "solid-automerge";
import { surfaceDoc } from "../surface-doc.js";
import { log } from "../log.js";
import { migrateStorageKey } from "../persist.js";
import { useLayerTransform, itemLayers, itemHomeLayer, defaultLayers, layerKind } from "../layers.js";
import { chainToOuter, chainToLocal, chainScale, mapInstanceFor, onSpaceChanged } from "../box-transform.js";
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
import { createCanvasContext, claimDraws, drawClaim, toolIsClaimable } from "../context.js";
import { opstreamToSignal, Source, automergeOpstream, numberSchema, anySchema, apply as applyOp } from "../opstreams.js";
import { mountInspector } from "../inspector-editor.js";
import { readPort, portWiring, makeEditorItem, editorsForStream, firstMatchingInlet, firstMatchingInletForOutlet, streamType, descriptorsFeeding, outletFeedsInlet, usedContextOutlets as computeUsedContextOutlets, paramWireFor, rawValueInlets, formatShape, seedConfigFor } from "../wire.js";
import { listEditors, nodeRole, inletDefsFor, outletDefsFor } from "../editors.js";
import { PART_DRAG_TYPE, decodePartId } from "../parts-bin.js";
import { paletteEntriesById } from "../registry/palettes.js";
import { stickyFromRect, resolveStickyScreen, stickyOf, isStuck } from "../sticky.js";
import { resolveBrushHandlers, brushParamDefault, paramDefs, listRegistryBrushes } from "../brush-host.js";
import { penHandlers } from "../pen-brush.js";
import { shapeHandlers } from "../shape-brush.js";
import { textHandlers } from "../text-brush.js";
import { eraserHandlers } from "../eraser-brush.js";
import { wireHandlers } from "../wire-brush.js";
import { placeHandlers } from "../place-brush.js";
import { describeBinary, isError, binarySafeReplacer, paramsSchema, isSnapshot, describeSchema } from "../ops.js";
import { ShareSession, myContactUrl as sessionMyUrl } from "../share-session.js";
import { listLensDescriptors } from "../lenses.js";
import { catalogDatatypes, catalogWindows, catalogLenses } from "../catalog.js";
import { viewRect, fitRect, centerCam, zoomAt, contentBounds } from "./camera.js";
import { Item } from "./items/item.jsx";
import { PresenceLayer } from "./ui/presence.jsx"; // Minimap is now a bare tool (minimap-node.js)
import { Handles, Properties, STAMPS, STAMP_IDS, sampleSvgPath } from "./ui/chrome.jsx"; // (Toolbar stays exported from chrome.jsx for its glyph tables, but the canvas no longer mounts it — the toolbar is the seeded palette window)
import {
  freehandPath, shapePaths, roughLinkPath, roughLink, roughChevron, seedFromId, strokeWorldPoints,
} from "../draw.js";
import {
  rad, rot, isBoxType, localToWorld, worldToLocal, pointInFrame, itemBox,
  ownsSpace, projectItemFromBox, annotateItemIntoBox, surfaceWithinBox, itemVisibleForActive,
  itemBounds, cloneItem, itemPresent, arrowGeometry, worldAnchor,
  linkItemId, buildItemsIndex, findById,
  applyReorder, expandGroups as expandGroupsIn, groupBounds, clickSelection, itemsInRect, portPoint,
} from "../model.js";
import { createDocsLens } from "../docs-lens.js";
import { count as perfCount, perFrame, rafBatch, startOverlay } from "../perf.js";
import "../style.css";
import {
  colorVar, SIZES, shapeRenderProps, shapePropsEqual, enableAtomicMove,
  SHAPE_TOOLS, clamp, rndSeed, uid, ensureLayout, colorFor, isTypingTarget,
  SEED_IDS, makeFlapSpace, seedPartsFlap, windowDrag,
} from "./constants.js";

// README.md Phase 4 — coalesce a high-frequency Source's PUSH side to a 16ms
// trailing edge (≤60 emissions/sec however fast the upstream writes). The lib's
// coalesce() can't do this: a Source emits only snapshots, and coalesce forwards
// snapshots immediately (pinned in its own tests). So the source's own `push` is
// wrapped instead, keeping the Source contract exact between emissions:
// `.value` is synchronously current on EVERY write (toWorld/drawClaim read it,
// and connect() snapshots it, mid-window), only the emitter is deferred — one
// emission per window carrying the latest value. Counters: `ctxSet:<name>` raw
// writes, `ctxPush:<name>` coalesced emissions. `.cancelPending()` drops a
// buffered emission (called on unmount).
function coalesceSource(src, name, ms = 16) {
  if (src.cancelPending) return src; // already wrapped
  const emit = src.push.bind(src);
  let timer = null;
  let agent0;
  src.push = (value, agent) => {
    perfCount(`ctxSet:${name}`);
    src._val = value; // current for synchronous readers + connect snapshots
    src._error = null; // a fresh value clears the error state (as push does)
    agent0 = agent; // the latest write's agent rides the coalesced emission
    if (timer == null) timer = setTimeout(() => { timer = null; perfCount(`ctxPush:${name}`); emit(src._val, agent0); }, ms);
  };
  // errors must not be masked by a buffered value: pushError emits IMMEDIATELY
  // and drops any pending coalesced push — the buffered value predates the error,
  // and flushing it afterwards would re-emit it as fresh (push clears `_error`),
  // silently swallowing the error downstream.
  if (typeof src.pushError === "function") {
    const emitError = src.pushError.bind(src);
    src.pushError = (e, agent) => { if (timer != null) { clearTimeout(timer); timer = null; } emitError(e, agent); };
  }
  src.cancelPending = () => { if (timer != null) { clearTimeout(timer); timer = null; } };
  return src;
}

// README.md Phase 5 — a Map-keyed memo over a colour resolver: `resolve` runs
// ONCE per distinct input string until `.clear()`. The canvas clears on theme
// change (clear-before-tick, so themeTick subscribers re-resolving on the bump
// see fresh colours). Exported for the color-cache pins.
export function cachedColorResolver(resolve) {
  const cache = new Map();
  const cached = (c) => {
    if (cache.has(c)) return cache.get(c);
    const v = resolve(c);
    cache.set(c, v);
    return v;
  };
  cached.clear = () => cache.clear();
  return cached;
}

export function Canvas(props) {
  const { handle, repo, element } = props;
  const opts = props.opts || {}; // { minimal?, minimap?, defaultTool? } — the sketchpad variant
  // the tool's doc is the FOLDER (holds `.docs`); its canvas `items` live in a
  // separate LAYOUT doc referenced by `.newspace`.
  const folderDoc = surfaceDoc(handle); // seam: real handle OR an opstream-backed adapter
  const [rootLayoutH, setRootLayoutH] = createSignal(null);
  // REACT to `folder.sketch` and switch to the converged layout-doc url when two peers
  // raced to create it — see README.md §Layout-doc convergence.
  // COMPONENT MODE: a patchwork:component can INJECT the layout handle (opts.layoutHandle,
  // an opstream-backed adapter); used verbatim, skipping the folder→ensureLayout derivation.
  if (opts.layoutHandle) setRootLayoutH(opts.layoutHandle);
  let ensuring = false;
  createEffect(() => {
    if (opts.layoutHandle) return; // injected — don't derive/switch
    const url = folderDoc.sketch || folderDoc.newspace; // reactive (.sketch; .newspace back-compat)
    if (!url) { if (!ensuring) { ensuring = true; ensureLayout(repo, handle).then((h) => { ensuring = false; setRootLayoutH(h); }).catch((e) => { ensuring = false; log.error("ensureLayout", e); }); } return; }
    const cur = rootLayoutH();
    if (cur && cur.url === url) return;
    repo.find(url).then((h) => { h.change((d) => { if (!d.items) d.items = []; }); if (cur && cur.url !== url) log.debug(`layout converged → ${url.slice(-8)} (was ${cur.url.slice(-8)})`); setRootLayoutH(h); }).catch((e) => log.error("layout switch", e));
  });
  const rootLayoutDoc = createMemo(() => { const h = rootLayoutH(); return h ? surfaceDoc(h) : null; }); // seam: real handle OR opstream-backed
  // seed the PARTS FLAP (constants.js seedPartsFlap) — async (it creates the
  // flap's folder+layout docs), so it runs from the ROOT canvas rather than
  // ensureLayout: boxes' loadSpace must not each grow a flap. Idempotent +
  // dismissal-respecting; re-runs if the layout doc converges to another url.
  let seededFlapFor = null;
  createEffect(() => {
    const lh = rootLayoutH();
    if (!lh || opts.minimal || seededFlapFor === lh) return;
    seededFlapFor = lh;
    seedPartsFlap(repo, lh).catch((e) => log.warn("parts flap seed", e));
  });

  const [themeTick, setThemeTick] = createSignal(0);
  // pan/zoom is remembered per-doc in localStorage (local to this viewer);
  // migrate the pre-rename `newspace:camera:` key before makePersisted reads
  const camKey = `sketchy:camera:${handle.url}`;
  migrateStorageKey(`newspace:camera:${handle.url}`, camKey);
  const [cam, setCam] = makePersisted(createSignal({ x: 0, y: 0, z: 1 }), {
    name: camKey,
    storage: localStorage,
  });
  // ── LAYERS ─────────────────────────────────────────────────────────────────
  // a sketch is an ordered stack of coordinate SPACES (layers.js). The stack is
  // DATA in the layout doc; each layer's pan/zoom/pin/geo behaviour comes from a
  // registered transform plugin — the canvas only ever asks the registry.
  const layersList = () => { const l = rootLayoutDoc()?.layers; return Array.isArray(l) && l.length ? l : defaultLayers(); };
  // null = "the base (first) layer, whatever it's called" — no hardcoded layer id
  const [activeLayerRaw, setActiveLayerId] = createSignal(null);
  const activeLayerId = () => activeLayerRaw() || baseLayer()?.id;
  // switching layers clears the selection: you only ever edit the active layer, and a move
  // gesture computes deltas in ONE layer's space — a selection spanning layers would write
  // screen-px deltas into world-coord fields (jumps at non-100% zoom).
  const switchLayer = (id) => { if (id === activeLayerId()) return; setSelected([]); setEditingId(null); setActiveLayerId(id); };
  const activeLayer = () => layersList().find((l) => l.id === activeLayerId()) || layersList()[0];
  // reactive env every transform binding reads from (camera + viewport + the layer's own config)
  const layerEnv = (getLayer) => ({ camera: cam, viewport: () => ({ w: viewportRef?.offsetWidth || 0, h: viewportRef?.offsetHeight || 0 }), layer: getLayer });
  const txFor = (layer) => useLayerTransform(layer, layerEnv(() => layer));
  const baseLayer = () => layersList()[0];
  // editing a frosting layer (e.g. the overlay) dims + blurs everything beneath it
  const frosting = () => !!(layerKind(activeLayer()?.kind) || {}).frost;
  // ── MEMBERSHIP-DRIVEN VISIBILITY (model.js itemVisibleForActive) ───────────
  // an item shows iff its HOME layer is at/below the active one (lower layers keep
  // rendering under it — the frosted compositing) OR its `layers` membership
  // includes the active layer. Hidden = display:none (DOM kept, so embeds
  // survive; nothing display:none can be hit or clicked). Root items only —
  // frame children carry no layer tags and follow their frame's node.
  const layerIdList = () => layersList().map((l) => l.id);
  const itemHidden = (it) => !itemVisibleForActive(it, layerIdList(), activeLayerId());
  // a MEMBER of the active layer that lives elsewhere opts back into pointer
  // events (its home container is inert while inactive) — membership means
  // "appears AND is usable on this layer" (the seeded palette while drawing).
  const memberOnActive = (it) => itemHomeLayer(it) !== activeLayerId() && itemLayers(it).includes(activeLayerId());
  // ALWAYS the base camera space — for coords that are inherently world (peer presence
  // cursors/views), which must not be run through the active layer's transform.
  const cameraToScreen = (wx, wy) => txFor(baseLayer()).toScreen(wx, wy);
  // ── COORDINATE-SPACE-AS-BOX (box-transform.js) — the two-half model in ONE place ─────────
  // the box chain from the canvas root down to a surface: the active LAYER (box "viewport" =
  // camera pan/zoom, else identity for a pinned overlay) then any FRAME. Composing this replaces
  // hand-rolled activeToScreen(localToWorld(...)); the frame half is proven identical in
  // box-transform.test.js. (Selection clears on layer switch, so the selected item is always on
  // the active layer — the layer box matches activeToScreen.)
  const boxEnv = { camera: cam };
  const layerBoxOf = (layerId) => {
    const layer = layersList().find((l) => l.id === layerId);
    const isCamera = (layerKind(layer && layer.kind) || {}).transform === "camera";
    return { x: 0, y: 0, transform: { kind: isCamera ? "viewport" : "identity" } }; // box "viewport" == pan/zoom
  };
  // the box chain: a LAYER, then the surface's frame(s) — each a box via itemBox (uniform).
  // The layer half comes from the ITEM's home space when an item is given (selection
  // geometry must be right for the item's own space — an overlay-home widget selected
  // while the canvas tab is momentarily active must not project through the camera).
  // A frame child carries no layer tags, so itemHomeLayer falls back to the base.
  const chainFor = (surface, it) => {
    const c = [layerBoxOf(it ? itemHomeLayer(it) : activeLayerId())];
    if (surface && surface.frame) {
      c.push(itemBox(effFrame(surface.frame)));
      // a STUCK frame (an open flap drawer) renders counter-scaled (stickyPlace's
      // k = 1/zoom, so it holds screen size) — its children's selection/port
      // geometry must compose that scale too, or it drifts at non-100% zoom.
      if (isStuck(surface.frame)) c.push({ x: 0, y: 0, transform: { kind: "scale", k: stickyPlace(surface.frame).k } });
    }
    return c;
  };
  const boxToScreen = (surface, local, it) => chainToOuter(chainFor(surface, it), local, boxEnv);
  const boxScale = (surface, it) => chainScale(chainFor(surface, it), boxEnv);
  // ── STICKY (sticky.js) — a window docked to a viewport EDGE by dragging ────
  // `sticky: { edge, t }` renders viewport-anchored: its screen rect comes from
  // resolveStickyScreen, converted back into the item's HOME-layer coords through
  // the box composer so the DOM node stays in its home container (embeds never
  // relocate). A camera-home stuck window also counter-scales (k) so it holds
  // screen size. A legacy corner `anchor` READS as sticky (stickyOf normalizes
  // it, sticky wins when both are present); interactions write sticky only.
  const [vpTick, setVpTick] = createSignal(0); // sticky positions are computed, so resize must re-run them
  onMount(() => {
    if (typeof ResizeObserver === "undefined" || !viewportRef) return;
    const ro = new ResizeObserver(() => setVpTick((t) => t + 1));
    ro.observe(viewportRef);
    onCleanup(() => ro.disconnect());
  });
  const stickyScreen = (it) => {
    vpTick();
    const { w, h } = viewportSize(); // per-frame cached (no per-event reflow)
    return resolveStickyScreen(stickyOf(it, w, h), it.w || 0, it.h || 0, w, h);
  };
  // a stuck item's render placement in its HOME layer's space: top-left + the
  // counter-scale that undoes the layer's zoom (identity layers ⇒ k = 1)
  const stickyPlace = (it) => {
    const s = stickyScreen(it);
    const chain = [layerBoxOf(itemHomeLayer(it))];
    const l = chainToLocal(chain, s, boxEnv);
    return { x: l.x, y: l.y, k: 1 / (chainScale(chain, boxEnv) || 1) };
  };
  // a DOCKED item (sticky, or a legacy corner anchor read as sticky) resolves to
  // absolute home-space coords here, per viewer's viewport — which is why a
  // shared widget can read "bottom-left" for everyone. Selection/handle geometry
  // and drags all flow through this one path.
  const resolveItemPos = (it) => {
    if (!it) return { x: 0, y: 0 };
    if (isStuck(it)) { const s = stickyScreen(it); return chainToLocal([layerBoxOf(itemHomeLayer(it))], s, boxEnv); }
    return { x: it.x || 0, y: it.y || 0 };
  };
  // ── FLAPS — a `flap: true` FRAME (a named sticky container). A STUCK flap
  // collapses to an edge TAB; clicking the tab opens it as a drawer (the frame
  // at its size, anchored to the edge — the ordinary sticky render). Open state
  // is PER-VIEWER (the top-layer doc's `flaps[id].open`, next to brushCfg — not
  // shared); un-sticking (drag away) makes it a normal floating box for free.
  const flapCollapsed = (it) => !!(it && it.kind === "frame" && it.flap && it.sticky && !flapOpen(it.id));
  function flapOpen(id) { return !!topLayerDoc()?.flaps?.[id]?.open; }
  function setFlapOpen(id, open) { changeTop((d) => { if (!d.flaps) d.flaps = {}; if (!d.flaps[id]) d.flaps[id] = {}; d.flaps[id].open = !!open; }); }
  // Escape / a click on empty canvas collapses any open flap (per-viewer)
  function closeOpenFlaps() {
    const f = topLayerDoc()?.flaps;
    if (!f) return;
    const openIds = Object.keys(f).filter((k) => f[k] && f[k].open);
    if (!openIds.length) return;
    changeTop((d) => { for (const k of openIds) if (d.flaps && d.flaps[k]) d.flaps[k].open = false; });
  }
  // a collapsed flap's TAB placement: a compact tab FLUSH to its sticky edge
  // (inset 0, unlike the drawer's 12), t along the edge, converted into the
  // item's home-layer coords exactly like stickyPlace (counter-scaled on a
  // camera-home layer). Vertical edges swap the tab's axes (the name reads
  // top-to-bottom there — CSS writing-mode).
  const FLAP_TAB = { long: 112, thick: 26 };
  const flapTabPlace = (it) => {
    vpTick();
    const edge = (it.sticky && it.sticky.edge) || "left";
    const vert = edge === "left" || edge === "right";
    const w = vert ? FLAP_TAB.thick : FLAP_TAB.long, h = vert ? FLAP_TAB.long : FLAP_TAB.thick;
    const { w: W, h: H } = viewportSize();
    const s = resolveStickyScreen(it.sticky, w, h, W, H, 0); // flush to the edge
    const chain = [layerBoxOf(itemHomeLayer(it))];
    const l = chainToLocal(chain, s, boxEnv);
    return { x: l.x, y: l.y, w, h, k: 1 / (chainScale(chain, boxEnv) || 1), edge };
  };

  // the canvas CONTEXT (camera/pointer/tool/brush/selection) via provide/accept
  // with fallback-to-own. `tool` is context-owned (so a nested canvas can inherit
  // it); cam/selection are mirrored INTO the context below so it's live for
  // providers/inspection. Exposed on element.api.context for devtools.
  const context = createCanvasContext(element, {
    fallbacks: { camera: { x: 0, y: 0, z: 1 }, pointer: { x: 0, y: 0 }, tool: opts.defaultTool || "select", brush: {}, selection: [] },
  });
  onCleanup(() => context.destroy());
  // Phase 4: the pointer is written per pointermove and fans out to every
  // subscriber (providers, magnifier, wired nodes) — coalesce its emissions.
  // Synchronous readers (toWorld, drawClaim geometry) go through `.value`,
  // which stays current on every write.
  coalesceSource(context.pointer, "pointer");
  onCleanup(() => context.pointer.cancelPending());
  // THE DRAW CLAIM (context.js): this canvas claims draw/erase gestures over embedded
  // spatial boxes — a map checks `drawsClaimed(context)` (mounts receive this very context
  // object) and, when claimed, does NOT capture draws; they land here and become items
  // parented into the box's space. Entering a box re-roots the claim (see drawTarget).
  claimDraws(context);
  // spatial boxes' projections move (a map pans/zooms): box-transform notifies, this signal
  // makes it reactive — parented items re-project on render (the one Solid seam for it).
  const [spaceEpoch, setSpaceEpoch] = createSignal(0);
  onCleanup(onSpaceChanged(() => setSpaceEpoch((n) => n + 1)));
  // a `board` source: the live root items, so a node can see what's on the canvas (the LLM
  // magnifying glass reads what its bounds cover). A plain Source kept fresh by an effect
  // below — NOT provide/accept (it's local read-only state, not inherited chrome).
  context.board = new Source([]);
  // the LAYER STACK + ACTIVE LAYER on the context — the layers bare window
  // (layers-node.js, seeded as "ns-layers") reads the stack and switches tabs
  // through these, the same raw connect/apply protocol presence uses for
  // showViews/following. `layers` is read-only ({ id, name, kind } rows, bottom
  // → top); `activeLayer` is writable — apply(snapshot(id)) switches, and the
  // mirror effects below echo local switches straight back as plain pushes.
  context.layers = new Source([]);
  context.activeLayer = new Source(null);
  context.activeLayer.apply = (op) => { const v = isSnapshot(op) ? op.value : null; if (typeof v === "string") switchLayer(v); };
  createEffect(() => context.layers.push(layersList().map((l) => ({ id: l.id, name: l.name || (layerKind(l.kind) || {}).name || l.id, kind: l.kind }))));
  createEffect(() => context.activeLayer.push(activeLayerId()));
  if (element && element.api) element.api.context = context;
  const tool = opstreamToSignal(context.tool); // reactive accessor over the Source
  const setTool = (v) => (opts.minimal && v !== "pen" ? null : context.tool.set(v)); // pencil-only locks the tool
  if (opts.defaultTool) queueMicrotask(() => { if (!context.tool.value || context.tool.value === "select") context.tool.set(opts.defaultTool); });
  const [draft, setDraft] = createSignal(null);
  const [wireDraft, setWireDraft] = createSignal(null); // {from:{x,y}, to:{x,y}} screen-space wire being dragged
  const [editorChooser, setEditorChooser] = createSignal(null); // {x,y,candidates,place} when a dropped wire matches >1 editor
  const [selectedWire, setSelectedWire] = createSignal(null); // a selected wire spec (Backspace deletes it)
  const [guides, setGuides] = createSignal(null); // snap-constraint overlay (behaviour brushes)
  const [selected, setSelected] = createSignal([]);
  // mirror camera + selection + brush INTO the context (one-way) so all five
  // context entries are live for providers / the inspect mode / nested canvases.
  // (cam/selected/brush stay owned here for now; chrome reading FROM the context
  // is the separate brush-API refactor.)
  createEffect(() => context.camera.set(cam()));
  createEffect(() => context.selection.set(selected()));
  // the camera outlet is read-WRITE: a tool wired to it (a minimap clicking to jump) can
  // MOVE the actual camera by writing its stream. `.apply` drives setCam; the mirror effect
  // above echoes the new value straight back as a plain push (never re-enters .apply), so it
  // converges without a loop. Writes merge so a partial {x,y} keeps the current zoom.
  context.camera.apply = (op) => {
    const next = isSnapshot(op) ? op.value : applyOp(context.camera.value, op);
    if (next && typeof next === "object") setCam((c) => ({ ...c, ...next }));
  };
  const [enteredGroup, setEnteredGroup] = createSignal(null); // a group you've double-clicked INTO (scoped editing of its members)
  const [placing, setPlacing] = createSignal(null); // { what:"doc"|"editor"|"lens", descriptor }
  const [placeGhost, setPlaceGhost] = createSignal(null); // world pos the to-be-placed thing follows
  const [nodeMenu, setNodeMenu] = createSignal(null); // {x,y, world} — the wire-tool dbl-click add palette
  const [portInfo, setPortInfo] = createSignal(null); // {world, title, lines} — click a port to see its full schema
  const [datatypes, setDatatypes] = createSignal([]);
  const [brushes, setBrushes] = createSignal([]); // sketchy:brush plugins (used later)
  const [addOpen, setAddOpen] = createSignal(false);   // docs overflow menu
  const [shapeMenuOpen, setShapeMenuOpen] = createSignal(false); // shape overflow menu
  const [extraShape, setExtraShape] = createSignal("line"); // last-used overflow shape, surfaced in the bar
  const [dropTarget, setDropTarget] = createSignal(null); // frame id a dragged item would drop INTO
  const [stickyHint, setStickyHint] = createSignal(null); // viewport edge a dragged window is in dock range of
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
  // README.md Phase 3 — the viewport rect is read ONCE per rAF frame: every
  // consumer below goes through this perFrame cache instead of its own
  // getBoundingClientRect (a layout flush each). When the frame loop isn't
  // ticking (headless tests) perFrame degrades to a fresh read. `gbcr` counts
  // only the real underlying reads, so the budget (≤1/frame) is measurable.
  // The no-ref case stays OUTSIDE the cache — a pre-mount call must not pin
  // `undefined` for the rest of the frame the ref appears in.
  const readViewportRect = perFrame(() => { perfCount("gbcr"); return viewportRef.getBoundingClientRect(); });
  const viewportRect = () => (viewportRef ? readViewportRect() : undefined);
  // offsetWidth/offsetHeight are ALSO forced-layout reads, and the sticky/anchor
  // paths used to take them per POINTERMOVE (stickySnapFor/resolveItemPos) — with
  // styles dirtied every frame by the gesture's own doc write, that's a synchronous
  // reflow of the whole canvas (embeds included) per event. Same per-frame cache.
  const readViewportSize = perFrame(() => { perfCount("vpSize"); return { w: viewportRef.offsetWidth || 0, h: viewportRef.offsetHeight || 0 }; });
  const viewportSize = () => (viewportRef ? readViewportSize() : { w: 0, h: 0 });
  setDatatypes(catalogDatatypes()); // the catalog's placeable-datatypes census
  // custom brushes live in the `sketchy:brush` registry. We list them in the
  // shape overflow, and load each brush MODULE (its stroke config / behaviour)
  // so drawing with the brush uses it.
  const brushMods = new Map(); // id -> brush module ({ stroke, iconPath, ... })
  // modules land ASYNC, and a plain Map is invisible to Solid — bump a version
  // signal when one resolves so isBrushTool / paramDefs / the properties panel
  // re-read it (selecting a brush before its module loads must show the params
  // the moment they arrive, not on the next unrelated update). README.md Phase 10.
  const [brushVer, setBrushVer] = createSignal(0);
  {
    const all = listRegistryBrushes();
    setBrushes(all);
    for (const b of all) Promise.resolve(b.load ? b.load() : b).then((m) => { if (m) { brushMods.set(m.id || b.id, m); setBrushVer((v) => v + 1); } }).catch(() => {});
  }
  const brushMod = (id) => (brushVer(), brushMods.get(id));
  const isBrushTool = (t) => (brushVer(), brushMods.has(t));
  // PER-BRUSH config — editing a custom brush's params (size/opacity/…) is stored
  // against THAT brush's id, so it doesn't bleed into the pen or other brushes. Backed
  // by the per-user top-layer doc (so it persists + is per-viewer). Resolution order:
  // this brush's edited config → the brush module's stroke defaults → the shared store.
  const activeBrushId = () => (isBrushTool(tool()) ? tool() : null);
  const brushParam = (id, key) => {
    const cfg = id && topLayerDoc()?.brushCfg?.[id];
    if (cfg && key in cfg) return cfg[key];
    // the brush's DECLARED default: schema default → legacy stroke[key] (brush-host.js)
    const def = id ? brushParamDefault(brushMod(id), key) : undefined;
    if (def !== undefined) return def;
    return brush[key];
  };
  const setBrushParam = (id, key, val) => changeTop((d) => { if (!d.brushCfg) d.brushCfg = {}; if (!d.brushCfg[id]) d.brushCfg[id] = {}; d.brushCfg[id][key] = val; });

  // the WIRE tool is a "pointer++": it does everything select does (pick, move,
  // resize, marquee, edit) AND it can see/grab ports. So select behaviours gate on
  // `selectish`, not just "select". (For power users it can stand in for the pointer.)
  const selectish = () => tool() === "select" || tool() === "wire";

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
  // README.md Phase 2 — one per-tick index over the root items (id → doc index),
  // shared by item.jsx (z/parent lookups via ctx.indexById) and the wire
  // geometry below (Phase 6), replacing per-read rootItems().find scans.
  const itemsIdx = createMemo(() => buildItemsIndex(rootItems(), itemLayers));
  const indexById = () => itemsIdx().indexById;
  // keep the `board` context source fresh with the live root items (read by the magnifier)
  createEffect(() => context.board.push(rootItems()));

  // Paint shapes/outlines IMMEDIATELY when the layout loads; mount the heavy
  // embedded tools (patchwork-views) a frame later so they don't block first
  // paint. (A doc's outline + title still show right away — only the live tool
  // waits, behind a striped placeholder.)
  const [embedsReady, setEmbedsReady] = createSignal(false);
  createEffect(() => { if (rootItems().length && !embedsReady()) requestAnimationFrame(() => requestAnimationFrame(() => setEmbedsReady(true))); });

  // a brief loading state: a perfect-freehand SWIRL spinning in the centre, so first
  // paint isn't a blank void. Reveals when embeds are ready, or after a max wait.
  const [booting, setBooting] = createSignal(true);
  // an Archimedean spiral of pressure-ramped points → a hand-drawn swirl (filled).
  const swirlPath = (() => {
    const pts = [], cx = 40, cy = 40, turns = 2.6, n = 80;
    for (let i = 0; i < n; i++) { const t = i / (n - 1); const a = t * turns * Math.PI * 2; const r = 3 + t * 32; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0.25 + t * 0.75]); }
    return freehandPath(pts, 7, { thinning: 0.7, smoothing: 0.6, streamline: 0.5 });
  })();
  onMount(() => {
    const t = setTimeout(() => setBooting(false), 1400);
    createEffect(() => { if (embedsReady()) { clearTimeout(t); setBooting(false); } });
  });

  // load a space's folder + layout handles together
  const spaceCache = new Map();
  function loadSpace(url) {
    if (!spaceCache.has(url)) {
      spaceCache.set(url, repo.find(url).then(async (fh) => ({ folderHandle: fh, layoutHandle: await ensureLayout(repo, fh) })).catch((e) => { log.error("loadSpace", e); return null; }));
    }
    return spaceCache.get(url);
  }
  // generic doc + datatype loaders (for resolving a doc's real title)
  const docHandleCache = new Map();
  function loadDoc(url) { if (!docHandleCache.has(url)) docHandleCache.set(url, repo.find(url).catch(() => null)); return docHandleCache.get(url); }
  const datatypeCache = new Map();
  function loadDatatype(type) { if (!datatypeCache.has(type)) { try { datatypeCache.set(type, getRegistry("patchwork:datatype").load(type).catch(() => null)); } catch { datatypeCache.set(type, Promise.resolve(null)); } } return datatypeCache.get(type); }
  // a frame is a container ON ITS HOME LAYER: the (wx,wy) being tested is in the
  // ACTIVE layer's coords, so only frames whose home is the active layer can
  // match (a canvas frame's world coords would mismatch an overlay-space point).
  // This is the extend-frames decision: FLAPS are frames placeable on any layer,
  // so containment works wherever the flap lives — an overlay flap takes drops
  // while you arrange. A STUCK frame's stored x/y are dormant; test its RESOLVED
  // position (and return a resolved copy so downstream worldToLocal math is
  // right). A COLLAPSED flap (an edge tab) is never a drop target.
  const frameAtWorld = (wx, wy, exclude) => {
    let f = null;
    for (const it of rootItems()) {
      if (it.kind !== "frame" || it.id === exclude) continue;
      if (itemHomeLayer(it) !== activeLayerId()) continue;
      if (flapCollapsed(it)) continue;
      const eff = effFrame(it);
      if (pointInFrame(eff, wx, wy)) f = eff;
    }
    return f;
  };
  // a STUCK frame (an open flap drawer) keeps its stored x/y DORMANT — every
  // geometry computation against a surface's frame must use the RESOLVED dock
  // position, or gestures/drops on the drawer's children land offset by the
  // dormant coords. One seam for all of them.
  const effFrame = (f) => (f && isStuck(f) ? { ...f, ...resolveItemPos(f) } : f);
  // the TOPMOST root item at (wx,wy) that owns a coordinate space (a frame OR a map) — the
  // draw-claim boundary. Rotation-aware containment via worldAnchor; base layer only, like frames.
  const spatialBoxAtWorld = (wx, wy, exclude) => {
    if (activeLayerId() !== baseLayer()?.id) return null;
    let hit = null;
    for (const it of rootItems()) {
      if (!ownsSpace(it) || it.id === exclude) continue;
      if (flapCollapsed(it)) continue; // a collapsed flap tab is not a draw target
      const eff = effFrame(it); // a stuck box's stored x/y are dormant
      const a = worldAnchor(eff, wx, wy);
      if (a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1) hit = eff;
    }
    return hit;
  };
  // a parented mark's spatial box (null if the parent is gone or not a space-owner)
  const parentBoxOf = (it) => {
    if (!it || !it.parent) return null;
    const p = rootItems().find((x) => x.id === it.parent);
    return p && ownsSpace(p) ? p : null;
  };
  // an item as the selection/gesture machinery should see it: parented marks project to
  // WORLD through their box (reactive to the box's projection moving — map pan/zoom)
  const projected = (it) => {
    const pb = it && parentBoxOf(it);
    if (!pb) return it;
    spaceEpoch(); // re-derive when the box's projection moves
    return projectItemFromBox(it, pb);
  };
  // WHERE a draw gesture starting at world (wx,wy) lands — the ANNOTATION vs CONTENT
  // convention, decided by the pure drawClaim predicate (context.js):
  //   • drawn from OUTSIDE an un-entered box → { targetBox }: the mark goes in THIS surface's
  //     items array with `parent: boxId` + box-local coords — an annotation ON the box (it
  //     travels with the outer canvas, and is NOT part of the inner document).
  //   • drawn while the box (or a surface inside it) is ENTERED (the active surface) → the
  //     inner surface owns the gesture: { targetFrame }, content OF the document — exactly
  //     the push-into-frame path that entering already used.
  function drawTarget(wx, wy) {
    const box = spatialBoxAtWorld(wx, wy);
    if (!box) return {};
    const entered = activeId() !== "root" && surfaceWithinBox(box, activeId(), (url) => surfaceReg.get(url)?.doc?.items);
    const route = drawClaim({ tool: tool(), claimed: true, entered });
    if (route === "content") return { targetFrame: box.kind === "frame" ? box : null };
    if (route === "annotation") return { targetBox: box };
    return {};
  }
  // topmost root item an arrow endpoint can bind to (not strokes/lines/arrows).
  // ONLY items whose HOME is the active layer — (wx,wy) is in that layer's
  // coords, and a hidden overlay widget's stored x/y are corner OFFSETS, so
  // hit-testing raw coords across all layers bound arrows to invisible chrome
  // with nonsense geometry. Positions resolve like the marquee: parented marks
  // project to world, anchored/stuck windows resolve to absolute coords.
  const bindAtWorld = (wx, wy) => {
    const items = rootItems();
    for (let i = items.length - 1; i >= 0; i--) {
      let it = items[i];
      if (it.kind === "stroke") continue;
      if (it.kind === "shape" && (it.type === "arrow" || it.type === "line")) continue;
      if (itemHomeLayer(it) !== activeLayerId()) continue;
      it = projected(it);
      if (isStuck(it)) it = { ...it, ...resolveItemPos(it), anchor: undefined, sticky: undefined };
      // hit-test the ROTATED shape (anchor in [0,1] ⇔ inside it), so you only
      // bind when over the actual tool and the stored anchor is in-bounds
      const a = worldAnchor(it, wx, wy);
      if (a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1) return items[i].id;
    }
    return null;
  };
  function convertToLocal(item, frame) {
    if (!frame) return;
    if (item.kind === "stroke") { item.points = strokeWorldPoints(item).map(([x, y, pr]) => { const [lx, ly] = worldToLocal(frame, x, y); return [lx, ly, pr]; }); item.x = 0; item.y = 0; item.rotation = 0; }
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
  // push a freshly-made item into whichever frame it's inside (else root). `opts.box` is the
  // ANNOTATION route (draw-claim): the item stays in the ROOT surface's items array, parented
  // onto the spatial box with box-local coords (lat/lng for a map) — see annotateItemIntoBox.
  async function pushItem(targetFrame, item, opts = {}) {
    let dstHandle = rootLayoutH(), dstFrame = null;
    const annotate = opts.box && (item.kind === "stroke" || item.kind === "shape");
    if (annotate) annotateItemIntoBox(item, opts.box);
    else if (targetFrame) { const s = await loadSpace(targetFrame.url); if (s) { dstHandle = s.layoutHandle; dstFrame = targetFrame; } }
    if (!dstHandle) return;
    if (!annotate) convertToLocal(item, dstFrame);
    const id = uid();
    // born on the active layer: its coords are already in that layer's space (toWorld
    // routed them there). `layers[0]` is the HOME; the legacy `layer` mirror is written
    // only for a non-base home (base was the untagged default), so old clients keep
    // placing the item in the right space. Frame children live in another doc's space —
    // no layer tags there.
    const home = !dstFrame ? activeLayerId() : null;
    const lyr = home && home !== baseLayer()?.id ? home : null;
    transact(dstHandle, "add", () => dstHandle.change((d) => { if (!d.items) d.items = []; d.items.push(home ? { id, layers: [home], ...(lyr ? { layer: lyr } : {}), ...item } : { id, ...item }); }));
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

  // "to the ACTIVE layer's item space": client px → viewport px → the layer's coords
  // via its transform. On the base canvas layer this is the camera inverse (as before);
  // on the viewport-pinned overlay it's screen coords; on a map it'd be lat/lon.
  // `layerId` overrides the target space (presence broadcasts base-world — see trackCursor).
  function toWorld(clientX, clientY, layerId) {
    const r = viewportRect();
    const sx = viewportRef.offsetWidth ? r.width / viewportRef.offsetWidth : 1;
    const sy = viewportRef.offsetHeight ? r.height / viewportRef.offsetHeight : 1;
    // input goes through the SAME box composer as output (one projection path): screen → the
    // active layer's local space. The layer box is proven-equivalent to txFor(layer).toItem.
    return chainToLocal([layerBoxOf(layerId || activeLayerId())], { x: (clientX - r.left) / sx, y: (clientY - r.top) / sy }, boxEnv);
  }
  function toSpace(clientX, clientY, frame) { const w = toWorld(clientX, clientY); const [x, y] = worldToLocal(effFrame(frame), w.x, w.y); return { x, y }; }
  function itemCenterWorld(it, frame) { const b = itemBounds(it); return localToWorld(effFrame(frame), b.x + b.w / 2, b.y + b.h / 2); }

  // resolve any colour (var() chains, color-mix(), light-dark()) to a concrete
  // value for rough.js, by letting the browser compute it on a probe element.
  // README.md Phase 5: results go through a Map cache (one getComputedStyle per
  // unique colour per theme — bumpTheme clears it). Non-resolvable inputs
  // ("none", pre-mount) bypass the cache so a value the probe never actually
  // computed can't be pinned stale.
  let _probe;
  const colorCache = cachedColorResolver((c) => {
    perfCount("colorResolve"); // README.md Phase 5: an ACTUAL probe resolution (cache miss)
    if (!_probe) { _probe = document.createElement("span"); _probe.style.cssText = "position:absolute;width:0;height:0;visibility:hidden;pointer-events:none"; viewportRef.appendChild(_probe); }
    _probe.style.color = "";
    _probe.style.color = c;
    return getComputedStyle(_probe).color || c;
  });
  const resolveColor = (c) => (typeof c !== "string" || c === "none" || !viewportRef ? c : colorCache(c));

  // ---- selection / gestures -------------------------------------------
  let gesture = null;

  function onItemDown(it, surface, e) {
    if (e.button !== 0 || gestureLive()) return; // FIRST POINTER WINS — a second finger can't start/steal a gesture
    e.stopPropagation();
    // grabbing a title/border takes focus off any embedded tool / typing target —
    // the gesture's preventDefault blocks the NATIVE focus transfer, so without
    // this an embed's editor kept focus and the next Backspace read as typing
    // (isTypingTarget) instead of deleting the selection
    const a = document.activeElement;
    if (a && a.blur && isTypingTarget(a, viewportRef)) a.blur();
    if (surface.id !== activeId()) { setActiveId(surface.id); setSelected([]); }
    if (tool() === "eraser") {
      // rubbing: delete the pressed item, then keep the erase gesture going so the
      // drag erases everything else it crosses (pinned in eraser-drag.test.js)
      removeItems(surface, [it.id]);
      const p = toWorld(e.clientX, e.clientY);
      gesture = drawGestureFor("eraser", p, drawTarget(p.x, p.y));
      beginGesture(e);
      return;
    }
    if (!selectish()) return;
    // SELECTION STAYS WITHIN THE ACTIVE LAYER (a move computes deltas in ONE
    // layer's space — see switchLayer). Inactive layers' items are still
    // clickable (pointer-events:none on the container doesn't inert descendants
    // that set their own auto, e.g. .ns-hit), so picking an item that lives on
    // another layer first SWITCHES to its home layer — the click does what it
    // meant, the invariant holds, and the selection geometry/moves are computed
    // in the item's own space.
    if (surface.id === "root") { const home = itemHomeLayer(it); if (home !== activeLayerId() && layersList().some((l) => l.id === home)) switchLayer(home); }
    setSelectedWire(null); // selecting an item drops any wire selection
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
  // snapshot the fields a move gesture rewrites. A PARENTED mark snapshots its box-local
  // geometry (points for a stroke, corners for a shape): the move applies the world delta
  // THROUGH the box transform (see onPointerMove), exact even in a warped geo space.
  const moveOrig = (o) => {
    if (parentBoxOf(o)) return o.kind === "stroke"
      ? { parent: o.parent, points: (o.points || []).map((p) => p.slice()) }
      : { parent: o.parent, x: o.x, y: o.y, w: o.w, h: o.h, cx: o.cx, cy: o.cy };
    // a STUCK window's origin is its resolved home-space position; the first real
    // move UNSTICKS it (delete sticky/anchor) and drags from there — no jump. (Size
    // stays the stored w/h, so a camera-home window loses its counter-scale on unstick.)
    if (isStuck(o)) { const p = stickyPlace(o); return { x: p.x, y: p.y, unstick: true }; }
    return o.kind === "stroke" ? { x: o.x || 0, y: o.y || 0 } : o.kind === "sketch" ? { nodes: o.nodes.map((n) => ({ x: n.x, y: n.y })) } : { x: o.x, y: o.y, cx: o.cx, cy: o.cy };
  };

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
      if (o.parent && parentBoxOf(o)) c.parent = o.parent; // an in-surface copy keeps its annotation parent (cloneItem strips it for cross-doc moves)
      clones.push(c);
      // same orig format as startMove: strokes are translate-only (origin bump)
      orig[c.id] = moveOrig(c);
    }
    if (!clones.length) return;
    // one txn spanning the clone insertion AND the drag, so ⌘Z removes the duplicate
    const txn = beginTxn(surface.handle);
    surface.handle.change((d) => { for (const c of clones) d.items.push(c); });
    const newIds = clones.map((c) => c.id);
    setSelected(newIds);
    gesture = { kind: "move", ids: newIds, start, orig, surface, fr, txn };
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
      if (o) orig[id] = moveOrig(o);
    }
    gesture = { kind: "move", ids, start, orig, surface, fr, txn: beginTxn(surface.handle) };
    beginGesture(e);
  }

  // the docs↔items join (materialize a shape per folder link, dedupe, unlink-on-delete +
  // the just-deleted-url tombstone that keeps a delete from racing the add pass). Lifted into
  // docs-lens.js (Ring 2 step 1); the effects below just trigger it.
  const docsLens = createDocsLens();
  onCleanup(() => docsLens.dispose());

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
    const before = snapshotItems(handle.doc().items || []);
    const r = fn && fn();
    const cmd = diffCommand(before, snapshotItems(handle.doc().items || []), (mut) => handle.change((d) => { if (!d.items) d.items = []; mut(d.items); }), label);
    history.push(cmd);
    return r;
  }
  // for gestures: snapshot at the start, build the command at the end
  const beginTxn = (handle) => (handle && !history.applying ? { handle, before: snapshotItems(handle.doc().items || []) } : null);
  function endTxn(txn, label) {
    if (!txn || history.applying) return;
    const cmd = diffCommand(txn.before, snapshotItems(txn.handle.doc().items || []), (mut) => txn.handle.change((d) => { if (!d.items) d.items = []; mut(d.items); }), label);
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
        // unlink the doc only when this is the LAST shape for its url (alt-drag copies share a
        // url); the lens tombstones first so the add pass can't recreate it mid-delete.
        docsLens.unlinkForDelete(surface.doc?.items || [], item.url, idSet, (fn) => surface.folderHandle.change(fn));
      }
      queueMicrotask(() => surface.handle.change((d) => { const i = d.items.findIndex((x) => x.id === id); if (i >= 0) d.items.splice(i, 1); }));
    }
    const set = new Set(ids);
    setSelected(selected().filter((s) => !set.has(s)));
    // deleting a seeded chrome widget must STICK — record it so ensureLayout won't re-seed it.
    const dismiss = ids.filter((id) => SEED_IDS.includes(id));
    if (dismiss.length) { const lh = rootLayoutH(); if (lh) lh.change((d) => { if (!d.dismissedSeeds) d.dismissedSeeds = []; for (const id of dismiss) if (!d.dismissedSeeds.includes(id)) d.dismissedSeeds.push(id); }); }
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
    if (gestureLive()) return; // first pointer wins (see gestureListeners)
    e.stopPropagation(); e.preventDefault();
    if (selected().length > 1) return startGroupResize(hx, hy, e);
    const it0 = single();
    if (!it0) return;
    const surface = active();
    const frame = surface.frame;
    const pb = parentBoxOf(it0); // a parented mark resizes in WORLD, written back box-local (applyResize)
    const it = projected(it0);
    // a STUCK window (sticky, or a legacy anchor read as sticky) renders
    // counter-scaled — it holds its SCREEN size, so its stored w/h ARE screen
    // px. Its resize gesture therefore runs in SCREEN space (dock rect +
    // viewport-px pointer); anything else would write sizes a zoom factor off
    // what the handle drag looked like.
    const stuck = isStuck(it) && surface.id === "root";
    const ob = stuck ? { ...itemBounds(it), ...stickyScreen(it) } : itemBounds(it);
    const r = rad(it.rotation || 0);
    const orig = it.kind === "stroke" ? strokeWorldPoints(it) // resize in WORLD space; result flattens to origin 0
      : it.kind === "text" ? { x: it.x, y: it.y, w: it.w, h: it.h, fontSize: it.fontSize || 20, wrap: !!it.wrap }
      : { x: ob.x, y: ob.y, w: it.w, h: it.h };
    const ax = -hx * ob.w / 2, ay = -hy * ob.h / 2;
    const txn = beginTxn(surface.handle);
    const move = (ev) => {
      perfCount("gestureEvent");
      const p = stuck ? localXY(ev) : toSpace(ev.clientX, ev.clientY, frame);
      const cx0 = ob.x + ob.w / 2, cy0 = ob.y + ob.h / 2;
      const [plx, ply] = rot(p.x - cx0, p.y - cy0, -r);
      let minx = -ob.w / 2, maxx = ob.w / 2, miny = -ob.h / 2, maxy = ob.h / 2;
      if (hx !== 0) { minx = Math.min(ax, plx); maxx = Math.max(ax, plx); }
      if (hy !== 0) { miny = Math.min(ay, ply); maxy = Math.max(ay, ply); }
      const nw = Math.max(8, maxx - minx), nh = Math.max(8, maxy - miny);
      const [ncx, ncy] = rot((minx + maxx) / 2, (miny + maxy) / 2, r);
      scheduleDocWrite(() => applyResize(surface.handle, it.id, ob, { x: cx0 + ncx - nw / 2, y: cy0 + ncy - nh / 2, w: nw, h: nh }, orig, it.kind, pb));
    };
    gestureListeners(move, () => endTxn(txn, "resize"), null, e.pointerId);
  }

  function applyResize(h, id, ob, nb, orig, kind, pb) {
    const sx = ob.w > 0.001 ? nb.w / ob.w : 1, sy = ob.h > 0.001 ? nb.h / ob.h : 1;
    const mapX = (x) => nb.x + (x - ob.x) * sx, mapY = (y) => nb.y + (y - ob.y) * sy;
    // a PARENTED mark's gesture ran on its world projection; write back box-local coords
    const rebox = (o) => { if (pb) annotateItemIntoBox(o, pb); };
    h.change((d) => {
      const o = d.items.find((x) => x.id === id);
      if (!o) return;
      if (kind === "stroke") { o.points = orig.map(([x, y, pr]) => (pr == null ? [mapX(x), mapY(y)] : [mapX(x), mapY(y), pr])); o.x = 0; o.y = 0; rebox(o); } // world result → flatten to origin 0
      else if (kind === "shape") { const x1 = mapX(orig.x), y1 = mapY(orig.y), x2 = mapX(orig.x + orig.w), y2 = mapY(orig.y + orig.h); o.x = x1; o.y = y1; o.w = x2 - x1; o.h = y2 - y1; rebox(o); }
      else if (kind === "text") { o.fontSize = Math.max(6, Math.round((orig.fontSize || 20) * (ob.h > 0.001 ? nb.h / ob.h : 1))); o.x = nb.x; o.y = nb.y; if (orig.wrap) o.w = nb.w; /* height re-measures from content */ }
      else {
        // a legacy corner-anchored widget persists its normalized sticky form the
        // first time a gesture rewrites its geometry — interactions write sticky only
        if (o.anchor) { const { w: W, h: H } = viewportSize(); o.sticky = stickyOf(o, W, H); delete o.anchor; }
        o.x = mapX(orig.x); o.y = mapY(orig.y); o.w = nb.w; o.h = nb.h;
      }
    });
  }

  const selWorldBounds = createMemo(() => {
    const ids = selected();
    if (ids.length < 2) return null;
    const frame = effFrame(active().frame);
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const id of ids) { const it = projected(itemById(id)); if (!it) continue; const b = itemBounds(it); const [wx, wy] = localToWorld(frame, b.x, b.y); minx = Math.min(minx, wx); miny = Math.min(miny, wy); maxx = Math.max(maxx, wx + b.w); maxy = Math.max(maxy, wy + b.h); }
    return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
  });

  // a faint outline around EACH selected item (only when multi-selecting), so
  // you can see exactly which shapes are in the selection
  const selItemOutlines = createMemo(() => {
    const ids = selected();
    if (ids.length < 2) return [];
    const frame = effFrame(active().frame), fr = frame ? frame.rotation || 0 : 0;
    return ids.map((id) => {
      const it = projected(itemById(id)); if (!it) return null;
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
    const ids = selected();
    const U = selWorldBounds();
    if (!U) return;
    const txn = beginTxn(surface.handle); // after the guard — beginTxn snapshots the whole doc
    const snaps = ids.map((id) => { const o = surface.doc.items.find((x) => x.id === id); if (!o || parentBoxOf(o)) return null; /* parented marks sit out group transforms (their coords are box-local) */ return o.kind === "stroke" ? { id, kind: "stroke", points: strokeWorldPoints(o) } : { id, kind: o.kind, x: o.x, y: o.y, w: o.w, h: o.h }; }).filter(Boolean);
    const move = (ev) => {
      perfCount("gestureEvent");
      const p = toWorld(ev.clientX, ev.clientY);
      let nx = U.x, ny = U.y, nw = U.w, nh = U.h;
      if (hx === 1) nw = Math.max(8, p.x - U.x);
      if (hx === -1) { nw = Math.max(8, U.x + U.w - p.x); nx = U.x + U.w - nw; }
      if (hy === 1) nh = Math.max(8, p.y - U.y);
      if (hy === -1) { nh = Math.max(8, U.y + U.h - p.y); ny = U.y + U.h - nh; }
      const sx = U.w > 0.001 ? nw / U.w : 1, sy = U.h > 0.001 ? nh / U.h : 1;
      const mapX = (x) => nx + (x - U.x) * sx, mapY = (y) => ny + (y - U.y) * sy;
      scheduleDocWrite(() => surface.handle.change((d) => {
        for (const s of snaps) {
          const o = d.items.find((x) => x.id === s.id);
          if (!o) continue;
          if (s.kind === "stroke") { o.points = s.points.map(([x, y, pr]) => [mapX(x), mapY(y), pr]); o.x = 0; o.y = 0; }
          else { o.x = mapX(s.x); o.y = mapY(s.y); o.w = s.w * sx; o.h = s.h * sy; }
        }
      }));
    };
    gestureListeners(move, () => endTxn(txn, "transform"), null, e.pointerId);
  }

  // rotate a multi-selection as one: each item orbits the group centre AND spins
  // about its own centre by the same delta (strokes rotate their points)
  function startGroupRotate(e) {
    e.stopPropagation(); e.preventDefault();
    const surface = active(), frame = surface.frame;
    const U = selWorldBounds();
    if (!U) return;
    const txn = beginTxn(surface.handle); // after the guard — beginTxn snapshots the whole doc
    const [gcx, gcy] = worldToLocal(effFrame(frame), U.x + U.w / 2, U.y + U.h / 2); // group centre (surface-local)
    const snaps = selected().map((id) => { const o = surface.doc.items.find((x) => x.id === id); if (!o || parentBoxOf(o)) return null; /* parented marks sit out group transforms */ return o.kind === "stroke" ? { id, kind: "stroke", points: strokeWorldPoints(o) } : { id, x: o.x, y: o.y, w: o.w, h: o.h, rotation: o.rotation || 0, cx: o.cx, cy: o.cy }; }).filter(Boolean);
    const s0 = toSpace(e.clientX, e.clientY, frame);
    const startAng = Math.atan2(s0.y - gcy, s0.x - gcx);
    const move = (ev) => {
      perfCount("gestureEvent");
      const p = toSpace(ev.clientX, ev.clientY, frame);
      let delta = Math.atan2(p.y - gcy, p.x - gcx) - startAng;
      if (ev.shiftKey) delta = Math.round(delta / (Math.PI / 12)) * (Math.PI / 12);
      const deg = (delta * 180) / Math.PI;
      scheduleDocWrite(() => surface.handle.change((d) => {
        for (const sn of snaps) {
          const o = d.items.find((x) => x.id === sn.id); if (!o) continue;
          if (sn.kind === "stroke") { o.points = sn.points.map(([x, y, pr]) => { const [rx, ry] = rot(x - gcx, y - gcy, delta); return [gcx + rx, gcy + ry, pr]; }); o.x = 0; o.y = 0; }
          else {
            const icx = sn.x + sn.w / 2, icy = sn.y + sn.h / 2;
            const [rx, ry] = rot(icx - gcx, icy - gcy, delta);
            o.x = gcx + rx - sn.w / 2; o.y = gcy + ry - sn.h / 2; o.rotation = sn.rotation + deg;
            if (sn.cx != null) { const [cxr, cyr] = rot(sn.cx - gcx, sn.cy - gcy, delta); o.cx = gcx + cxr; o.cy = gcy + cyr; }
          }
        }
      }));
    };
    gestureListeners(move, () => endTxn(txn, "transform"), null, e.pointerId);
  }

  // double-clicking the rotate knob resets the selection's rotation to 0
  function resetRotation() {
    transact(active().handle, "reset rotation", () => active().handle.change((d) => { for (const id of selected()) { const o = d.items.find((x) => x.id === id); if (o && o.rotation) o.rotation = 0; } }));
  }

  function startRotate(e) {
    if (gestureLive()) return; // first pointer wins (see gestureListeners)
    if (selected().length > 1) return startGroupRotate(e);
    e.stopPropagation(); e.preventDefault();
    const it = projected(single()); // parented: rotate about the WORLD-projected centre (rotation is a plain field either way)
    if (!it) return;
    const surface = active();
    const txn = beginTxn(surface.handle);
    const frame = surface.frame;
    // like startResizeSel: rotate about the item BOUNDS centre (strokes/up-left shapes
    // have bounds ≠ (x,y)); stuck ⇒ absolute centre
    const rp = resolveItemPos(it);
    const ob = isStuck(it) ? { ...itemBounds(it), x: rp.x, y: rp.y } : itemBounds(it);
    const cx = ob.x + ob.w / 2, cy = ob.y + ob.h / 2;
    const s = toSpace(e.clientX, e.clientY, frame);
    const startAng = Math.atan2(s.y - cy, s.x - cx);
    const r0 = it.rotation || 0;
    const move = (ev) => {
      perfCount("gestureEvent");
      const p = toSpace(ev.clientX, ev.clientY, frame);
      let deg = r0 + ((Math.atan2(p.y - cy, p.x - cx) - startAng) * 180) / Math.PI;
      if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
      scheduleDocWrite(() => surface.handle.change((d) => { const o = d.items.find((x) => x.id === it.id); if (o) o.rotation = deg; }));
    };
    gestureListeners(move, () => endTxn(txn, "transform"), null, e.pointerId);
  }

  // drag an endpoint (or a line's bezier control point). for arrows, dropping an
  // end over a bindable shape attaches it there (snaps to that shape's facing
  // edge midpoint); off it → detach.
  function startSegEnd(which, e) {
    if (gestureLive()) return; // first pointer wins (see gestureListeners)
    e.stopPropagation(); e.preventDefault();
    const it = single();
    if (!it || it.kind !== "shape" || (it.type !== "arrow" && it.type !== "line")) return;
    const isArrow = it.type === "arrow";
    const surface = active();
    const frame = surface.frame;
    const pb = parentBoxOf(it); // a parented segment's endpoints live in its box's space
    const txn = beginTxn(surface.handle); // endpoint drags are undoable like every other gesture
    const move = (ev) => {
      perfCount("gestureEvent");
      const p = toWorld(ev.clientX, ev.clientY);
      let [lx, ly] = worldToLocal(effFrame(frame), p.x, p.y);
      if (pb) { const l = chainToLocal([itemBox(pb)], { x: lx, y: ly }, boxEnv); lx = l.x; ly = l.y; }
      const targetId = (isArrow && which !== "control" && !frame && !pb) ? bindAtWorld(p.x, p.y) : null;
      const target = targetId && rootItems().find((x) => x.id === targetId);
      const anchor = target ? worldAnchor(target, lx, ly) : null;
      setArrowHover(targetId);
      scheduleDocWrite(() => surface.handle.change((d) => {
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
      }));
    };
    gestureListeners(move, () => { setArrowHover(null); endTxn(txn, "segment"); }, null, e.pointerId);
  }

  function reorder(mode) {
    if (!selected().length) return;
    transact(active().handle, "reorder", () => active().handle.change((d) => applyReorder(d.items, selected(), mode)));
  }

  // ---- behaviour brushes ---------------------------------------------
  // A `sketchy:brush` may carry a `behavior` ({down,move,up}) instead of (or
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
      // snap only to the ACTIVE layer's items — another layer's stored coords are
      // in a different space (same class of bug as bindAtWorld, lower stakes)
      if (itemHomeLayer(it) !== activeLayerId()) continue;
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
      pressure: (e && e.pressure) || 0.5,
      brush: { color: brush.color, size: brush.size, roughness: brush.roughness, bowing: brush.bowing },
      // resolved param for the ACTIVE brush (per-viewer edit → schema default → store)
      param: (k) => brushParam(g.brushId || tool(), k),
      geometry: g.geometry || (g.geometry = brushGeometry()),
      tol: 12 / (cam().z || 1), // snap radius: ~12 screen px, constant on screen
      preview: setDraft, setDraft, setGuides, uid, history,
      items: rootItems(),
      layout: layoutStream(), // the items as a real opstream (read + apply)
      // shape-brush helpers (the canvas-coupled bits, provided BY the host):
      shapeType: g.shapeType, seed: rndSeed, endTool: () => setTool("select"),
      // text-brush helpers: create point text / a wrapped box (both inline-edit on drop)
      createText: (x, y) => createTextAt({ x, y }),
      createTextBox: (x, y, w, h) => createTextBox(g.targetFrame, x, y, w, h),
      // eraser-brush helper: remove the item under a pointer event (hit-test via the DOM).
      // A sweep CLAIMED over a spatial box (g.targetBox) never erases the box itself —
      // it stops there (no erasing THROUGH the box at items visually beneath it).
      eraseAt: (ev) => {
        if (!ev) return;
        for (const el of document.elementsFromPoint(ev.clientX, ev.clientY)) {
          const itEl = el.closest && el.closest("[data-item-id]");
          const id = itEl && itEl.getAttribute("data-item-id");
          if (!id) continue;
          if (!(g.targetBox && id === g.targetBox.id)) removeItems(null, [id]);
          return;
        }
      },
      // place-brush helper: materialise the drawn rect — a folder "Box", or the chosen
      // doc/editor/lens (`placing()`); a click (tiny rect) gets a sensible default size.
      placeAt: (d) => {
        let { x, y, w, h } = d;
        if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; }
        const pl = placing(); const lens = pl && pl.what === "lens";
        if (w < 40 || h < 40) { w = lens ? 220 : 360; h = lens ? 96 : 280; } // a click → default size
        if (g.placeTool === "box") createDocAt("folder", x, y, w, h, "Box");
        else if (pl && pl.what === "doc") createDocAt(pl.descriptor.id, x, y, w, h);
        else if (pl && pl.what === "flap") createFlapAt(x, y, w, h);
        else if (pl && (pl.what === "editor" || pl.what === "lens")) pushItem(frameAtWorld(x, y), makeEditorItem({ id: "ed-" + uid(), editorId: pl.descriptor.id, x, y, w, h, inlets: {} }));
        setPlacing(null); setPlaceGhost(null);
      },
      bindArrow: (d) => {
        const extra = {};
        // an arrow drawn at the root binds its ends to whatever shapes/docs they land on,
        // so moving those shapes drags the arrow with them. (Not when it's headed into a
        // box — content OR annotation coords wouldn't match the bound shapes' world space.)
        if (d && d.type === "arrow" && !g.targetFrame && !g.targetBox) {
          const fromId = bindAtWorld(d.x, d.y);
          const toId = bindAtWorld(d.x + d.w, d.y + d.h);
          if (fromId) { const fi = rootItems().find((x) => x.id === fromId); extra.fromId = fromId; if (fi) extra.fromAnchor = worldAnchor(fi, d.x, d.y); }
          if (toId && toId !== fromId) { const ti = rootItems().find((x) => x.id === toId); extra.toId = toId; if (ti) extra.toAnchor = worldAnchor(ti, d.x + d.w, d.y + d.h); }
        }
        return extra;
      },
      // mutate the surface the gesture started on (root for v1 behaviour brushes)
      change: (fn) => { const h = rootLayoutH(); if (h) h.change((d) => fn(d.items, d)); },
      commit: (item) => { if (item) pushItem(g.targetFrame, item, { box: g.targetBox }); },
    };
  }
  // the active surface's items as a REAL opstream (read + apply) — the "storeOpstream"
  // bridge. A brush can connect to it (live items) and apply ops (splice/set) to draw,
  // instead of the ergonomic commit/change sugar. Memoised per layout handle so there's
  // one change-listener, not one per access.
  let _layoutStream = null, _layoutStreamH = null;
  function layoutStream() {
    const h = rootLayoutH();
    if (!h) return null;
    if (_layoutStreamH !== h) {
      if (_layoutStream) _layoutStream.disconnect(); // drop the old handle's "change" listener
      _layoutStreamH = h; _layoutStream = automergeOpstream(h, { path: ["items"] });
    }
    return _layoutStream;
  }
  onCleanup(() => { if (_layoutStream) { _layoutStream.disconnect(); _layoutStream = null; _layoutStreamH = null; } });
  // the STABLE BrushHost handed to `use(host)` at gesture start — the live context Sources,
  // transforms, the layout opstream, and resolved params. (Per-phase work uses brushCtx.)
  const brushHost = {
    context, toWorld, uid, history,
    geometry: () => brushGeometry(),
    items: () => rootItems(),
    get layout() { return layoutStream(); }, // the items as a real opstream (read + apply)
    param: (k) => brushParam(tool(), k),
  };
  function callBrush(phase, g, e, p) {
    const fn = g.handlers && g.handlers[phase];
    if (fn) fn(brushCtx(g, e, p));
  }
  // the WIRE brush's small drag state machine (wire-brush.js). Its ctx is port-based, not
  // world-point-based; the heavy drop logic stays here as the capabilities it sequences.
  function callWire(phase, g, e) {
    const fn = wireHandlers[phase]; if (!fn) return;
    fn({
      port: g.port,
      isClick: !!(g.down && Math.hypot(e.clientX - g.down.x, e.clientY - g.down.y) < 5),
      updateWire: () => setWireDraft((w) => (w ? { ...w, to: localXY(e) } : w)),
      inspectPort: () => showPortInfo(g.port, e.clientX, e.clientY),
      drop: () => finishWire(g, e),
    });
  }

  // viewport-local screen coords (ns-root origin), matching the .ns-end handles
  const localXY = (e) => { const r = viewportRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  // resolve the dragged port → an opstream, then either rewire an editor it was
  // dropped on, or place a matching editor on empty canvas wired to it.
  const finishWire = (g, e) => dropWire(g.port, e.clientX, e.clientY);

  // resolve a dropped port → an opstream, then rewire a matching editor or place one.
  // Works for pointer-drops (canvas-own ports) AND HTML5 drops (a `dataTransfer`
  // port from an embedded tool across an iframe boundary — e.g. a Form field grip).
  async function dropWire(port, clientX, clientY) {
    const api = element?.api;
    if (!port) return;
    if (port.kind === "inlet") return dropFromInlet(port, clientX, clientY); // dragged FROM an inlet
    const wiring = portWiring(port);
    let stream;
    if (port.kind === "context") {
      stream = context[port.name]; // a context outlet's opstream IS the Source
    } else if (port.kind === "peer") {
      stream = peerStream(port.contactUrl, port.part);
    } else if (port.kind === "node") {
      stream = nodeStream(port.node, port.outlet); // another node's derived stream (a lens output)
    } else {
      if (!api) return;
      const frag = port.path && port.path.length ? "#" + port.path.join("/") : "";
      try { stream = await api.find(port.url + frag); } catch (err) { return log.warn("wire: find failed", err); }
    }
    if (!stream) return;
    const type = streamType(stream);
    // the SOURCE's declared outlet type (when it's a node outlet) — lets us match by
    // type (bang→bang) instead of by the live value, which for a bang looks like json.
    let outletType = null;
    if (port.kind === "node") {
      const up = rootItems().find((x) => x.id === port.node);
      const ud = up && (listEditors().find((d) => d.id === up.editorId) || listLensDescriptors().find((d) => d.id === up.editorId));
      const od = ud && outletDefsFor(ud, up).find((o) => o.name === port.outlet);
      outletType = od ? od.type : null;
    }

    // dropped on an existing editor item → rewire an inlet. If dropped ON a named
    // inlet port, wire THAT inlet; otherwise the first matching one.
    const el = document.elementFromPoint(clientX, clientY);
    const inletEl = el && el.closest && el.closest("[data-sketchy-inlet]");
    const editorEl = el && el.closest && el.closest(".ns-editor[data-item-id]");
    if (editorEl) {
      const id = editorEl.getAttribute("data-item-id");
      const item = rootItems().find((x) => x.id === id);
      const descriptor = item && (listEditors().find((d) => d.id === item.editorId) || listLensDescriptors().find((d) => d.id === item.editorId));
      const defs = inletDefsFor(descriptor, item); // dynamic-aware (template doc)
      const rawName = inletEl && inletEl.getAttribute("data-item-id") === id && inletEl.getAttribute("data-sketchy-inlet");
      const named = rawName === "*" ? { name: "*" } : (rawName && defs.find((i) => i.name === rawName)); // "*" = the splat corner
      const inlet = named || (descriptor && firstMatchingInletForOutlet(defs, outletType, stream.value));
      if (item && inlet) {
        // the wiring graph is ROOT-only (the item was found in rootItems) — mutate the
        // root layout doc, not whichever box surface happens to be active
        const rh = rootLayoutH();
        if (rh) transact(rh, "wire", () => rh.change((dd) => {
          const o = dd.items.find((x) => x.id === id);
          if (o) { if (!o.inlets) o.inlets = {}; o.inlets[inlet.name] = wiring; }
        }));
      }
      return;
    }

    // empty canvas. A USER-STATE source (context/peer) → a LOCAL floating inspector
    // on the top layer (not the shared doc — it's this viewer's state).
    if (port.kind === "context" || port.kind === "peer") {
      const r = viewportRect();
      addFloat(wiring, clientX - r.left, clientY - r.top);
      return;
    }

    // a DOC field → place a matching consumer on the canvas. Editors AND lenses that
    // accept the stream are offered (a lens lets you transform it on the way out).
    const candidates = editorsForStream([...listEditors(), ...listLensDescriptors()], stream);
    if (!candidates.length) return log.warn("wire: no editor accepts", type);
    const p = toWorld(clientX, clientY);
    const place = (descriptor) => {
      const inlet = firstMatchingInlet(descriptor, stream.value);
      pushItem(frameAtWorld(p.x, p.y), makeEditorItem({
        id: "ed-" + uid(), editorId: descriptor.id, x: p.x, y: p.y,
        w: descriptor.lens ? 220 : 360, h: descriptor.lens ? 96 : 260,
        inlets: inlet ? { [inlet.name]: wiring } : {},
      }));
    };
    if (candidates.length === 1) return place(candidates[0]);
    // several match → a little chooser at the drop point
    setEditorChooser({ world: toWorld(clientX, clientY), candidates, place });
  }

  // dragged a wire FROM an inlet: drop on an OUTPUT port → wire it in; drop on empty
  // canvas → place a raw-value source feeding the inlet (always available for any value).
  function dropFromInlet(inletPort, clientX, clientY) {
    // root-graph operation: the inlet's node lives in the root layout doc
    const setInlet = (wiring) => { const rh = rootLayoutH(); if (rh) transact(rh, "wire", () => rh.change((dd) => {
      const o = dd.items.find((x) => x.id === inletPort.node);
      if (o) { if (!o.inlets) o.inlets = {}; o.inlets[inletPort.inlet] = wiring; }
    })); };
    const el = document.elementFromPoint(clientX, clientY);
    const target = el && readPort(el);
    if (target && target.kind !== "inlet") { setInlet(portWiring(target)); return; } // wire an existing output in

    // empty canvas → a chooser of everything that can FEED this inlet (its schema),
    // each placed + wired by its matching outlet. (Mirrors the outlet-drop chooser.)
    const item = rootItems().find((x) => x.id === inletPort.node);
    const desc = item && (listEditors().find((d) => d.id === item.editorId) || listLensDescriptors().find((d) => d.id === item.editorId));
    const inletDef = desc && inletDefsFor(desc, item).find((i) => i.name === inletPort.inlet);
    const p = toWorld(clientX, clientY);
    const place = (descriptor) => {
      const id = "ed-" + uid();
      // PREFILL FROM THE INLET'S SCHEMA: a template doc / raw value chosen here is
      // seeded with schemaExample(inlet.schema) — it arrives already shaped like
      // what the inlet wants (fields present, typed defaults, validating). No
      // derivable example ⇒ seed is null ⇒ exactly the old behaviour.
      const seed = seedConfigFor(descriptor, inletDef);
      pushItem(frameAtWorld(p.x, p.y), makeEditorItem({ id, editorId: descriptor.id, x: p.x, y: p.y, w: descriptor.lens ? 220 : 320, h: descriptor.lens ? 96 : 240, inlets: {}, config: seed || undefined }));
      const outlet = (descriptor.outlets || []).find((o) => outletFeedsInlet(o, inletDef)) || (descriptor.outlets || [])[0];
      if (outlet) setInlet({ node: id, outlet: outlet.name });
    };
    const candidates = descriptorsFeeding([...listEditors(), ...listLensDescriptors()], inletDef);
    if (!candidates.length) return place({ id: "value", outlets: [{ name: "value" }] }); // fallback: a raw value
    if (candidates.length === 1) return place(candidates[0]);
    setEditorChooser({ world: toWorld(clientX, clientY), candidates, place });
  }

  // WIRE tool: grab a PORT (a data-automerge-* element). A document-level CAPTURE
  // listener so it fires BEFORE an embedded tool / a box's `grab` can
  // stopPropagation; we walk composedPath() so the real port element is found even
  // when the event is retargeted at an embedded-tool boundary.
  function onPointerDownCapture(e) {
    if (e.button !== 0 || tool() !== "wire" || gestureLive()) return; // first pointer wins
    const path = (e.composedPath && e.composedPath()) || [e.target];
    if (viewportRef && !path.includes(viewportRef)) return; // not this canvas
    let port = null;
    for (const el of path) {
      if (el && el.nodeType === 1) { port = readPort(el); if (port) break; } // context OR automerge port
    }
    if (!port) return;
    e.preventDefault();
    e.stopPropagation(); // claim it: the embedded tool / grab must not also act
    const a = localXY(e);
    gesture = { kind: "wire", port, down: { x: e.clientX, y: e.clientY } };
    setWireDraft({ from: a, to: a });
    beginGesture(e);
  }

  // build a draw/erase gesture for the CLAIMABLE tools (stroke brushes, shapes, eraser) —
  // shared by the bubble path (onPointerDown) and the capture path (onDrawClaimCapture).
  // `target` is drawTarget()'s routing: { targetFrame } = content, { targetBox } = annotation.
  function drawGestureFor(t, p, target = {}) {
    const start = { x: p.x, y: p.y };
    if (t === "eraser") return { kind: "brush", handlers: eraserHandlers, ...target, start, state: {}, txn: null };
    if (SHAPE_TOOLS.has(t)) return { kind: "brush", handlers: shapeHandlers, shapeType: t, ...target, start, state: {}, txn: null };
    if (t === "pen" || isBrushTool(t)) {
      // ALL stroke-y tools flow through the brush host: resolve the brush's handlers
      // (use(host) → legacy behavior → the built-in pen fallback for passive stroke
      // brushes). The pen is no longer special-cased — it's just the fallback brush.
      const mod = brushMod(t);
      const handlers = resolveBrushHandlers(mod, brushHost) || penHandlers;
      const usesTxn = !!(mod && mod.behavior); // legacy behaviour brushes mutate via change → need a txn
      return { kind: "brush", mod, handlers, brushId: t, ...target, start, state: {}, txn: usesTxn ? beginTxn(rootLayoutH()) : null };
    }
    return null;
  }

  // DRAW-CLAIM capture: an embedded spatial box whose BODY swallows bubbling pointerdowns
  // (an editor box like the map — its .ns-doc-body stopPropagations to keep grabs out of
  // the tool) would otherwise eat a claimed draw gesture. So claimed draws over such a box
  // start HERE, in the capture phase — the same trick the map's own fallback capture used,
  // now owned by the claiming canvas. Frames don't need this: their bodies bubble through
  // to onPointerDown, which routes via the same drawTarget.
  function onDrawClaimCapture(e) {
    if (e.button !== 0 || gesture || gestureLive()) return; // first pointer wins (resize/rotate gestures set no `gesture`)
    const t = tool();
    if (!toolIsClaimable(t)) return; // select/hand/wire/text/place: never claimed
    const path = (e.composedPath && e.composedPath()) || [e.target];
    if (viewportRef && !path.includes(viewportRef)) return; // not this canvas
    let boxIt = null;
    for (const el of path) {
      if (!el || el.nodeType !== 1 || !el.classList || !el.classList.contains("ns-doc-body")) continue;
      const itEl = el.closest && el.closest("[data-item-id]");
      const id = itEl && itEl.getAttribute("data-item-id");
      const it = id && rootItems().find((x) => x.id === id);
      if (it && it.kind !== "frame" && ownsSpace(it)) { boxIt = it; break; }
    }
    if (!boxIt) return;
    if (drawClaim({ tool: t, claimed: true, entered: false }) !== "annotation") return; // (an editor box isn't enterable)
    e.stopPropagation(); // claim it: the box's own draw fallback / Leaflet must not also act
    const p = toWorld(e.clientX, e.clientY);
    gesture = drawGestureFor(t, p, { targetBox: boxIt });
    if (!gesture) return;
    callBrush("down", gesture, e, p);
    beginGesture(e);
  }

  // ---- canvas-level gestures (root surface) ---------------------------
  function onPointerDown(e) {
    if (gestureLive()) return; // first pointer wins (see gestureListeners)
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
      if (selectish() && e.target.closest(".ns-frame-body")) return;
    }
    const p = toWorld(e.clientX, e.clientY);
    if (selectish()) {
      // the marquee's preventDefault (beginGesture) blocks the native focus
      // transfer — drop any typing-target focus (an embed's editor, a panel
      // input) so Backspace deletes the fresh selection instead of typing
      if (ae && ae.blur && isTypingTarget(ae, viewportRef)) ae.blur();
      if (!e.shiftKey) setSelected([]);
      setSelectedWire(null); // clicking empty canvas drops a selected wire too
      setEnteredGroup(null); // clicking empty canvas exits a group
      closeOpenFlaps(); // clicking the canvas collapses an open flap drawer
      setActiveId("root");
      gesture = { kind: "marquee", x0: p.x, y0: p.y, add: selected() };
      setDraft({ kind: "marquee", x: p.x, y: p.y, w: 0, h: 0 });
    } else if (t === "pen" || isBrushTool(t) || SHAPE_TOOLS.has(t)) {
      // stroke brushes + shapes flow through the brush host (drawGestureFor), routed by
      // the draw-claim decision: content into an entered box, annotation onto an
      // un-entered spatial box, plain root item otherwise.
      gesture = drawGestureFor(t, p, drawTarget(p.x, p.y));
      callBrush("down", gesture, e, p);
      beginGesture(e);
      return;
    } else if (t === "place" || t === "box") {
      // place/box draw through the brush host too (the PlaceBrush): draw a rect, then the
      // host materialises a folder "Box" or the chosen doc/editor/lens.
      gesture = { kind: "brush", handlers: placeHandlers, placeTool: t, start: { x: p.x, y: p.y }, state: {}, txn: null };
      callBrush("down", gesture, e, p);
      beginGesture(e);
      return;
    } else if (t === "text") {
      // text draws through the brush host too (the TextBrush): click = point text, drag = box
      gesture = { kind: "brush", handlers: textHandlers, targetFrame: frameAtWorld(p.x, p.y), start: { x: p.x, y: p.y }, state: {}, txn: null };
      callBrush("down", gesture, e, p);
      beginGesture(e);
      return;
    } else if (t === "eraser") {
      // drag-to-erase across empty canvas (clicking a single item still deletes via its
      // grab). Routed like a draw: a targetBox scopes the sweep (the box itself survives).
      gesture = drawGestureFor(t, p, drawTarget(p.x, p.y));
      callBrush("down", gesture, e, p);
      beginGesture(e);
      return;
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
    if (!selectish()) return;
    if (e.target.closest(".ns-mark, .ns-text-item, .ns-doc, .ns-hit, .ns-handle, .ns-toolbar, .ns-props, .ns-minimap")) return;
    // wire tool: a searchable "add a node" palette (source / transform / sink)
    if (tool() === "wire") { const r = viewportRect(); setNodeMenu({ x: e.clientX - r.left, y: e.clientY - r.top, world: toWorld(e.clientX, e.clientY) }); return; }
    createTextAt(toWorld(e.clientX, e.clientY));
  }
  // place a surface/lens (chosen from the dbl-click palette) at a world point
  function placeNode(descriptor, world) {
    pushItem(frameAtWorld(world.x, world.y), makeEditorItem({ id: "ed-" + uid(), editorId: descriptor.id, x: world.x, y: world.y, w: descriptor.lens ? 220 : 320, h: descriptor.lens ? 96 : 240, inlets: {} }));
  }

  // README.md Phase 1 — every gesture's doc writes coalesce through ONE rAF batch
  // (latest state wins): raw pointer events stay imperative, the handle.change
  // lands ≤1/frame. The batch is PER GESTURE (created in gestureListeners): a
  // shared batch let another gesture's closure evict this gesture's FINAL write.
  // `gestureWrite` points at the ACTIVE gesture's batch; `docWrite` counts actual
  // post-coalesce writes. (No live gesture ⇒ the write runs immediately.)
  let gestureWrite = null;
  const scheduleDocWrite = (write) => {
    const run = () => { perfCount("docWrite"); write(); };
    if (gestureWrite) gestureWrite.schedule(run); else run();
  };
  // each gesture registers its window pointermove/pointerup/pointercancel set
  // here so an unmount mid-gesture detaches them (and drops the pending write).
  //
  // MULTI-TOUCH DESIGN: ONE gesture at a time, FIRST POINTER WINS. The initiating
  // pointerId gates every event (a second finger neither drives nor ends the
  // gesture), and every gesture starter declines while one is live (gestureLive).
  // Chosen deliberately over true concurrent gestures: `gesture` is single module
  // state and the selection/undo-txn semantics all assume one unit — enforcing
  // the single-gesture invariant beats heuristically merging concurrent ones.
  const liveGestures = [];
  const gestureLive = () => liveGestures.length > 0;
  function gestureListeners(move, up, cancel, pointerId) {
    const batch = rafBatch();
    gestureWrite = batch;
    // events with no pointerId (mouse-event test doubles) always match
    const mine = (e) => pointerId == null || e.pointerId == null || e.pointerId === pointerId;
    const detach = () => {
      batch.cancel(); // no-op after a flush; drops the pending write on cancel/unmount
      if (gestureWrite === batch) gestureWrite = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      const i = liveGestures.indexOf(detach);
      if (i >= 0) liveGestures.splice(i, 1);
    };
    const onMove = (e) => { if (mine(e)) move(e); };
    // FLUSH BEFORE the up handler's endTxn — the gesture must end with the doc
    // fully current or the undo diff misses the final position
    const onUp = (e) => { if (!mine(e)) return; batch.flush(); detach(); up(e); };
    // a CANCELLED gesture (touch/pen interrupted by the OS/browser) still settles:
    // the pending write is DROPPED (the doc keeps the last landed state) and the
    // txn closes via `cancel` (defaults to the up handler). Closing an unchanged
    // txn is safe: diffCommand returns null and history.push drops it, so a
    // cancelled gesture never pushes an empty undo entry.
    const onCancel = (e) => { if (!mine(e)) return; detach(); (cancel || up)(e); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    liveGestures.push(detach);
  }
  onCleanup(() => { for (const d of liveGestures.splice(0)) d(); });

  function beginGesture(e) { e.preventDefault(); gestureListeners(onPointerMove, onPointerUp, onPointerCancel, e.pointerId); }
  // the canonical gesture path's ABORT: keep what already landed (the txn diff
  // records it; unchanged ⇒ no entry) but run NO drop routing — a cancelled
  // pointer didn't finish anywhere meaningful, so no reparent/dock/map-drop.
  function onPointerCancel() {
    const g = gesture; gesture = null;
    setDropTarget(null); setEscapeId(null); setStickyHint(null);
    setDraft(null); setGuides(null); setWireDraft(null); setArrowHover(null);
    if (g && (g.kind === "move" || g.kind === "brush")) endTxn(g.txn, g.kind);
  }
  function startPan(e) { setFollowing(null); const s = cam(); gesture = { kind: "pan", sx: e.clientX, sy: e.clientY, cx: s.x, cy: s.y }; beginGesture(e); }

  function onPointerMove(e) {
    if (!gesture) return;
    const k = gesture.kind;
    if (k === "pan") { setCam((c) => ({ ...c, x: gesture.cx + (e.clientX - gesture.sx), y: gesture.cy + (e.clientY - gesture.sy) })); return; }
    if (k === "wire") { callWire("move", gesture, e); return; }
    const p = toWorld(e.clientX, e.clientY);
    if (k === "brush") return callBrush("move", gesture, e, p);
    else if (k === "marquee") setDraft((d) => ({ ...d, w: p.x - gesture.x0, h: p.y - gesture.y0 }));
    else if (k === "move") {
      perfCount("gestureEvent");
      const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
      const [ldx, ldy] = rot(dx, dy, -rad(gesture.fr));
      const g = gesture; // the deferred write outlives onPointerUp nulling `gesture`
      // UNSTICK SYNCHRONOUSLY on the FIRST real move. The decision was made at gesture
      // start (moveOrig resolved the docked origin + flagged `unstick`); applying it
      // must NOT ride the rAF-deferred write: while the delete was pending, the render
      // path still saw `sticky` and drew the item dock-resolved (resolveStickyScreen)
      // even as the gesture laid down space coords — two positions fighting, a visible
      // pin-then-jump whenever rAF lagged the pointer. One immediate change (inside the
      // gesture txn, so undo restores sticky) deletes `sticky` and writes the resolved
      // origin; from the first move the item has exactly ONE position: the gesture's.
      // (Not at pointerdown — a plain click must not undock.)
      if (!g.unstuck) {
        g.unstuck = true;
        const stuck = g.ids.filter((id) => g.orig[id] && g.orig[id].unstick);
        if (stuck.length) g.surface.handle.change((d) => {
          for (const id of stuck) {
            const o = d.items.find((x) => x.id === id); const og = g.orig[id];
            if (!o || !og) continue;
            if (o.sticky) delete o.sticky;
            if (o.anchor) delete o.anchor;
            o.x = og.x; o.y = og.y;
          }
        });
      }
      scheduleDocWrite(() => {
        g.surface.handle.change((d) => {
        for (const id of g.ids) {
          const o = d.items.find((x) => x.id === id); const og = g.orig[id];
          if (!o || !og) continue;
          if (og.parent) {
            // a PARENTED mark moves THROUGH its box's transform: newLocal = toLocal(toOuter(orig) + Δworld)
            // — exact even in a warped (geo) space, recomputed from orig each event (no drift).
            // Annotations live at root, so the raw world delta applies (no surface-frame rotation).
            const pb = parentBoxOf(o);
            if (!pb) continue;
            const chain = [itemBox(pb)];
            const shift = (x, y) => { const w0 = chainToOuter(chain, { x, y }, boxEnv); const l = chainToLocal(chain, { x: w0.x + dx, y: w0.y + dy }, boxEnv); return [l.x, l.y]; };
            if (o.kind === "stroke") o.points = og.points.map(([x, y, pr]) => { const [nx, ny] = shift(x, y); return pr == null ? [nx, ny] : [nx, ny, pr]; });
            else {
              const [nx1, ny1] = shift(og.x, og.y);
              const [nx2, ny2] = shift(og.x + (og.w || 0), og.y + (og.h || 0));
              o.x = nx1; o.y = ny1; o.w = nx2 - nx1; o.h = ny2 - ny1;
              if (og.cx != null) { const [ncx, ncy] = shift(og.cx, og.cy); o.cx = ncx; o.cy = ncy; }
            }
          }
          else if (o.kind === "stroke") { o.x = (og.x || 0) + ldx; o.y = (og.y || 0) + ldy; } // translate-only box: bump ORIGIN, points untouched (one tiny op, not the whole array)
          else if (o.kind === "sketch") for (let i = 0; i < o.nodes.length; i++) { o.nodes[i].x = og.nodes[i].x + ldx; o.nodes[i].y = og.nodes[i].y + ldy; }
          else if (og.unstick) {
            // dragging a FORMERLY-STUCK window: the synchronous first-move change above
            // already deleted `sticky`/`anchor` and wrote the resolved origin; here the
            // batched write just applies the delta from that origin. (The deletes are
            // kept as a safety net — e.g. a remote peer re-docking mid-gesture.)
            if (o.sticky) delete o.sticky;
            if (o.anchor) delete o.anchor;
            o.x = og.x + ldx; o.y = og.y + ldy;
          }
          else {
            o.x = og.x + ldx; o.y = og.y + ldy; if (og.cx != null) { o.cx = og.cx + ldx; o.cy = og.cy + ldy; }
          }
        }
        });
        // the per-move DECORATIONS — drop-target highlight, the sticky edge hint,
        // the escaping-child unclip — each cost an items scan + chain math (and the
        // snap test a viewport read). They used to run per pointermove OUTSIDE the
        // rAF batch (per event); now they ride the same batched closure, AFTER the
        // change lands (≤1/frame, reading the fresher post-write state).
        setDropTarget(g.ids.length === 1 ? moveDropTarget(g.surface, g.ids[0]) : null);
        // the edge-dock hint: show which viewport edge the dragged window would stick to
        setStickyHint(g.ids.length === 1 ? (stickySnapFor(g.surface, g.ids[0])?.edge || null) : null);
        // un-clip a box ONLY once the dragged child's CENTRE has actually left it
        // (dropping there would put it outside) — so while it's still inside it
        // stays clipped, and you feel it cross the edge
        setEscapeId(g.surface.frame && g.ids.length === 1 && childLeavingBox(g.surface, g.ids[0]) ? g.ids[0] : null);
      });
      gesture.moved = true; // a real move happened — the drop may dock/undock (sticky)
    }
  }

  function onPointerUp(e) {
    const g = gesture; gesture = null;
    setDropTarget(null); setEscapeId(null); setStickyHint(null);
    if (!g) return;
    if (g.kind === "wire") {
      setWireDraft(null);
      // the WireBrush decides: a CLICK on a port inspects its schema; a DRAG resolves the drop
      callWire("up", g, e); return;
    }
    if (g.kind === "brush") { callBrush("up", g, e, toWorld(e.clientX, e.clientY)); endTxn(g.txn, "brush"); setGuides(null); setDraft(null); return; }
    const d = draft();
    if (g.kind === "marquee" && d) selectInRect(d.x, d.y, d.x + d.w, d.y + d.h, g.add);
    else if (g.kind === "move") {
      // released OUTSIDE the canvas while moving doc(s): hand them to whatever's
      // under the pointer (the sideboard, say) and snap them back — so a normal
      // move that wanders off the edge becomes a drag-out, no separate handle
      const r = e && viewportRef ? viewportRect() : null;
      const outside = r && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom);
      const links = outside ? selectedDocLinks(g.surface) : [];
      if (links.length) {
        dropToExternal(e.clientX, e.clientY, links);
        g.surface.handle.change((dd) => { for (const id of g.ids) { const o = dd.items.find((x) => x.id === id); const og = g.orig[id]; if (!o || !og) continue; if (o.kind === "stroke") { o.x = og.x || 0; o.y = og.y || 0; } else if (o.kind === "sketch") { for (let i = 0; i < o.nodes.length; i++) { o.nodes[i].x = og.nodes[i].x; o.nodes[i].y = og.nodes[i].y; } } else { o.x = og.x; o.y = og.y; } } });
      } else if (dropOntoMap(e.clientX, e.clientY, g.surface, g.ids)) { /* dropped onto a map → geo pin(s) */ }
      else if (g.ids.length === 1 && maybeRebox(g.surface, g.ids[0])) { /* annotation drag-out / drag-in (box-transform) */ }
      else if (g.moved && g.ids.length === 1 && applyStickySnap(g.surface, g.ids[0])) { /* docked to a viewport edge (sticky) */ }
      else if (selected().length === 1) maybeReparent(g.surface, selected()[0]);
      if (!links.length) endTxn(g.txn, "move"); // record the move for undo (in-surface moves; revert/drag-out are no-ops)
    }
    setDraft(null);
  }

  function selectInRect(x0, y0, x1, y1, add) {
    // marquee is in the ACTIVE layer's coordinate space, so only consider items ON that layer
    // (else a box on the frosted overlay would grab canvas items underneath). Stuck windows
    // resolve to absolute coords the screen-space rect can hit.
    const onLayer = rootItems()
      .filter((it) => itemHomeLayer(it) === activeLayerId()) // HOME = the space the marquee rect is in
      .map((it) => projected(it)) // parented marks hit at their world projection
      .map((it) => (isStuck(it) ? { ...it, ...resolveItemPos(it), anchor: undefined, sticky: undefined } : it));
    const hit = itemsInRect(onLayer, x0, y0, x1, y1);
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
  // a map box under the pointer (skipping the items being dragged, which are on top)
  function mapUnder(clientX, clientY, exclude) {
    for (const el of document.elementsFromPoint(clientX, clientY)) {
      const itEl = el.closest && el.closest("[data-item-id]");
      const id = itEl && itEl.getAttribute("data-item-id");
      if (!id || (exclude && exclude.has(id))) continue;
      const it = rootItems().find((x) => x.id === id);
      if (it && it.kind === "editor" && it.editorId === "map") return it;
    }
    return null;
  }
  // dropping a DOC onto a map converts it into the map's coordinate space: a geo pin at that
  // point (via the live map's screen→lat/lng). The doc leaves the canvas; the map holds it.
  function dropOntoMap(clientX, clientY, surface, ids) {
    const mapItem = mapUnder(clientX, clientY, new Set(ids));
    if (!mapItem) return false;
    const inst = mapInstanceFor(mapItem.id);
    if (!inst) return false;
    // name must be a real string — assigning `undefined` throws inside handle.change
    // (an orphan shape after an undone delete has no folder link). Same fallback as
    // map-node's own drop path: the url tail, else "untitled".
    const links = ids.map((id) => { const o = surface.doc.items.find((x) => x.id === id); if (!o || (o.kind !== "doc" && o.kind !== "frame")) return null; const l = surface.folderDoc && (surface.folderDoc.docs || []).find((dl) => dl.url === o.url); return { id, url: o.url, name: (l && l.name) || (o.url ? String(o.url).replace(/^automerge:/, "").slice(0, 8) : "untitled") }; }).filter(Boolean);
    if (!links.length) return false;
    const ll = inst.mouseEventToLatLng({ clientX, clientY });
    const lh = rootLayoutH();
    if (lh) lh.change((d) => { const m = d.items.find((x) => x.id === mapItem.id); if (m) { if (!m.config) m.config = {}; if (!m.config.pins) m.config.pins = []; for (const l of links) m.config.pins.push({ lat: ll.lat, lng: ll.lng, url: l.url, name: l.name }); } });
    removeItems(null, links.map((l) => l.id));
    return true;
  }
  // ANNOTATION drag-OUT / drag-IN — the other half of the draw claim, the same code path
  // through box-transform both ways:
  //   • a mark parented onto a spatial box, dragged OFF it → local→world via
  //     projectItemFromBox and `parent` cleared: it becomes a plain canvas mark (or
  //     re-annotates onto the spatial box it landed on).
  //   • a plain root stroke/shape dropped ONTO a map → world→lat/lng via
  //     annotateItemIntoBox, parent set. (Dropping onto a FRAME keeps today's content
  //     move — maybeReparent — a drag isn't a draw.)
  // Returns true when it settled the drop (skip the frame reparent).
  function maybeRebox(srcSurface, id) {
    if (srcSurface.frame) return false; // annotations live at root
    const it = srcSurface.doc.items.find((x) => x.id === id);
    if (!it || (it.kind !== "stroke" && it.kind !== "shape")) return false;
    const pb = parentBoxOf(it);
    if (!pb && it.parent) return false; // parent gone — leave stored coords alone
    if (!pb) {
      // maybe drag-IN: centre landed on a non-enterable spatial box (a map)?
      const b = itemBounds(it);
      const over = spatialBoxAtWorld(b.x + b.w / 2, b.y + b.h / 2, id);
      if (!over || over.kind === "frame") return false;
      // plain change: the enclosing move txn (endTxn "move") records this for undo
      srcSurface.handle.change((d) => { const o = d.items.find((x) => x.id === id); if (o) annotateItemIntoBox(o, over); });
      return true;
    }
    const pit = projectItemFromBox(it, pb);
    const b = itemBounds(pit);
    const over = spatialBoxAtWorld(b.x + b.w / 2, b.y + b.h / 2, id);
    if (over && over.id === pb.id) return true; // still on its box — settled
    srcSurface.handle.change((d) => {
      const o = d.items.find((x) => x.id === id);
      if (!o) return;
      // drag-OUT: write the projected WORLD geometry, clear parent
      if (o.kind === "stroke") { o.points = pit.points.map((p) => p.slice()); o.x = 0; o.y = 0; }
      else {
        o.x = pit.x; o.y = pit.y; o.w = pit.w; o.h = pit.h;
        if (pit.cx != null) { o.cx = pit.cx; o.cy = pit.cy; }
        if (pit.rotation != null) o.rotation = pit.rotation;
      }
      delete o.parent;
      // landed on ANOTHER map → adopt its space in the same write
      if (over && over.kind !== "frame") annotateItemIntoBox(o, over);
    });
    // landed over a FRAME → the normal content reparent takes it from here
    return !(over && over.kind === "frame");
  }

  // ── the STICKY drop test: would this dragged window dock to a viewport edge? ─
  // Root windows only (doc/editor — the things with window chrome); the rect is
  // projected to SCREEN through the item's home layer, so the ~24px threshold is
  // screen-true at any zoom. Pure math in sticky.js.
  function stickySnapFor(surface, id) {
    if (surface.id !== "root") return null;
    const it = (surface.doc?.items || []).find((x) => x.id === id);
    // windows (doc/editor) dock; so does a FLAP frame (docking is what collapses it to a tab)
    if (!it || (it.kind !== "doc" && it.kind !== "editor" && !(it.kind === "frame" && it.flap)) || it.parent) return null;
    const { w: W, h: H } = viewportSize();
    if (W < 60 || H < 60) return null; // no viewport (pre-mount/headless) — never snap
    const pos = resolveItemPos(it);
    const chain = [layerBoxOf(itemHomeLayer(it))];
    const p = chainToOuter(chain, pos, boxEnv);
    const k = chainScale(chain, boxEnv) || 1;
    return stickyFromRect(p.x, p.y, (it.w || 0) * k, (it.h || 0) * k, W, H);
  }
  // dock the dropped window: write `sticky: { edge, t }` (the stored x/y go
  // dormant until it's dragged off the edge again). Inside the move txn ⇒ undoable.
  function applyStickySnap(surface, id) {
    const snap = stickySnapFor(surface, id);
    if (!snap) return false;
    surface.handle.change((d) => { const o = d.items.find((x) => x.id === id); if (o) { if (o.anchor) delete o.anchor; o.sticky = { edge: snap.edge, t: snap.t }; } });
    return true;
  }

  function moveDropTarget(srcSurface, id) {
    const it = srcSurface.doc.items.find((x) => x.id === id);
    if (!it) return null;
    if (parentBoxOf(it)) return null; // a parented mark's drop routing is maybeRebox's
    const b = itemBounds(it);
    const [wx, wy] = localToWorld(effFrame(srcSurface.frame), b.x + b.w / 2, b.y + b.h / 2);
    const tf = frameAtWorld(wx, wy, id);
    if (!tf) return null;
    if (it.kind === "frame" && tf.url === it.url) return null;
    if ((srcSurface.frame ? srcSurface.frame.id : "root") === tf.id) return null;
    return tf.id;
  }

  // move an item between docs when it's dragged into / out of a frame
  async function maybeReparent(srcSurface, id) {
    const it = srcSurface.doc.items.find((x) => x.id === id);
    if (!it || isStuck(it)) return; // a STUCK window's stored x/y are dormant — never reparent off them
    const b = itemBounds(it);
    const [wx, wy] = localToWorld(effFrame(srcSurface.frame), b.x + b.w / 2, b.y + b.h / 2);
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
    if (clone.kind === "stroke") { clone.x = (clone.x || 0) + dx; clone.y = (clone.y || 0) + dy; }
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
    // frame surfaces are keyed by URL (item.jsx childSurface / pushItem), NOT the
    // frame's item id — the item id would dangle to the root fallback and the
    // selection would silently point at nothing.
    setActiveId(targetFrame ? targetFrame.url : "root");
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
      const r = viewportRect();
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
    } catch (e) { log.error("createDocAt", e); }
  }
  function selectPlacing(dt) { setPlacing({ what: "doc", descriptor: dt }); setTool("place"); setAddOpen(false); }
  // ── FLAP creation — the place flow, like drawing a box, but the created frame
  // carries `flap: true`, a chrome-free sub-space (makeFlapSpace) and is born on
  // the ACTIVE layer (pushItem's home tags) — flaps are placeable on any layer.
  function placeFlap() { setPlacing({ what: "flap", descriptor: { id: "flap", name: "flap" } }); setTool("place"); setAddOpen(false); }
  async function createFlapAt(x, y, w, h) {
    try {
      const folder = await makeFlapSpace(repo, "flap");
      await pushItem(null, { kind: "frame", flap: true, url: folder.url, x, y, w: Math.max(w, 160), h: Math.max(h, 120), rotation: 0 });
    } catch (e) { log.error("createFlapAt", e); }
  }
  function linkFor(url) { return (folderDoc.docs || []).find((l) => l.url === url); }

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

  // create a shape/face/brush dragged off the toolbar — or a PART dragged out of
  // the parts bin (same DnD type, namespaced part ids; see parts-bin.js) —
  // centred on the drop point
  const TOOL_DRAG = PART_DRAG_TYPE;
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
    // a namespaced PART from the parts bin → land an instance at the drop point,
    // through the SAME machinery the + menu / node palette use.
    const part = decodePartId(id);
    if (part.kind === "datatype") { createDocAt(part.id, p.x - 180, p.y - 140, 360, 280); return; }
    if (part.kind === "window" || part.kind === "lens") {
      const d = (part.kind === "lens" ? listLensDescriptors() : listEditors()).find((x) => x.id === part.id);
      if (d) placeNode(d, p);
      return;
    }
    // a FLAP tile → a fresh named sticky container centred on the drop point
    if (part.kind === "flap") { createFlapAt(p.x - 130, p.y - 90, 260, 180); return; }
    // a PALETTE → a preconfigured palette window at the drop point: a registered
    // preset id ("palette:full", any sketchy:palette plugin) resolved through the
    // registry. Writes are ENTRIES-only (the legacy `config.brushes` id list is a
    // read-shim). (The ⠿-grip identity payload is gone — copying a palette is
    // alt-drag; saving one is dropping the copy into the parts flap.)
    if (part.kind === "palette") {
      const entries = paletteEntriesById(part.id);
      const w = Math.min(560, Math.max(entries.length, 1) * 34 + 48), h = 44;
      pushItem(null, makeEditorItem({ id: "ed-" + uid(), editorId: "palette", x: p.x - w / 2, y: p.y - h / 2, w, h, inlets: {}, config: { entries: JSON.parse(JSON.stringify(entries)) } }));
      return;
    }
    const tf = frameAtWorld(p.x, p.y);
    if (STAMP_IDS.has(id)) return dropStamp(id, p);
    if (!SHAPE_TOOLS.has(id)) { setTool(id); return; } // a brush etc — just arm it
    const base = { kind: "shape", type: id, color: brush.color, fill: (id === "line" || id === "arrow") ? "none" : brush.fill, strokeWidth: brush.size, roughness: brush.roughness, bowing: brush.bowing, fillStyle: brush.fillStyle, strokeStyle: brush.strokeStyle, corner: brush.corner, seed: rndSeed(), rotation: 0 };
    if (id === "line" || id === "arrow") pushItem(tf, { ...base, x: p.x - 70, y: p.y, w: 140, h: 0 });
    else pushItem(tf, { ...base, x: p.x - 70, y: p.y - 50, w: 140, h: 100 });
  }

  // dropEffect must be in the drag's effectAllowed (sideboard uses "copyMove"),
  // else the browser rejects the drop and the drop event never fires
  function onDragOver(e) { const t = e.dataTransfer.types; if (!t.includes(TOOL_DRAG) && !hasDocDrag(e.dataTransfer) && !t.includes("application/sketchy-port") && !t.includes("text/plain")) return; e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }
  async function onDrop(e) {
    // a PORT dragged from an embedded tool (HTML5 DnD crosses the iframe boundary
    // that pointer events can't) — e.g. a Form field grip → wire it. Try the custom
    // type, then text/plain (some hosts only forward known types across iframes).
    let portData = e.dataTransfer.getData("application/sketchy-port");
    if (!portData) { const t = e.dataTransfer.getData("text/plain"); if (t && t[0] === "{" && t.includes("\"kind\"")) portData = t; }
    if (portData) {
      e.preventDefault();
      try { dropWire(JSON.parse(portData), e.clientX, e.clientY); } catch (err) { log.warn("port drop", err); }
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
    // dropping a doc from the sidebar ONTO a surface → WIRE the doc into its inlet
    // (attach the dochandle to that tool), instead of embedding it as a doc item.
    // Read the drag-data store SYNCHRONOUSLY — after any await it's in protected
    // mode and returns empty (files + getData both).
    const dragged = parseDrop(e.dataTransfer);
    const files = e.dataTransfer.files;
    const firstUrl = dragged[0] && dragged[0].url;
    if (firstUrl) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const surfEl = el && el.closest && el.closest(".ns-editor[data-item-id]");
      if (surfEl) {
        const id = surfEl.getAttribute("data-item-id");
        const item = rootItems().find((x) => x.id === id);
        // drop a doc ON an AUTOMERGE source node → adopt it as the source, then SHOW it
        // by ensuring a Tool is wired to its `doc` outlet (the dataflow made visible).
        if (item && item.editorId === "automerge") {
          // root-graph operation (the item came from rootItems) — mutate the root layout doc
          const rh = rootLayoutH();
          if (rh) transact(rh, "wire", () => rh.change((dd) => {
            const o = dd.items.find((x) => x.id === id);
            if (o) { if (!o.config) o.config = {}; o.config.url = firstUrl; }
          }));
          ensureToolWiredTo(id, item);
          handle.change((d) => { if (!d.docs) d.docs = []; const dl = dragged[0]; if (dl && !d.docs.some((l) => l.url === dl.url)) d.docs.push({ name: dl.name || "Document", type: dl.type || "", url: dl.url }); });
          return;
        }
        const desc = item && (listEditors().find((d) => d.id === item.editorId) || listLensDescriptors().find((d) => d.id === item.editorId));
        const inletEl = el.closest("[data-sketchy-inlet]");
        const named = inletEl && inletEl.getAttribute("data-item-id") === id && (desc?.inlets || []).find((i) => i.name === inletEl.getAttribute("data-sketchy-inlet"));
        const inlet = named || (desc?.inlets || []).find((i) => i.name === "doc") || (desc?.inlets || [])[0];
        if (item && inlet) {
          // root-graph operation (the item came from rootItems) — mutate the root layout doc
          const rh = rootLayoutH();
          if (rh) transact(rh, "wire", () => rh.change((dd) => {
            const o = dd.items.find((x) => x.id === id);
            if (o) { if (!o.inlets) o.inlets = {}; o.inlets[inlet.name] = { url: firstUrl, path: [] }; }
          }));
          return;
        }
      }
    }
    const p = toWorld(e.clientX, e.clientY);
    // drop INTO the box under the cursor, if any (else the root surface)
    const tf = frameAtWorld(p.x, p.y);
    let layout = rootLayoutH(), folder = handle, frame = null;
    if (tf) { const s = await loadSpace(tf.url); if (s) { layout = s.layoutHandle; folder = s.folderHandle; frame = tf; } }
    if (!layout) return;
    const at = (i) => { const [lx, ly] = worldToLocal(frame, p.x + i * 24, p.y + i * 24); return { x: lx, y: ly }; };
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
    const fresh = dragged.filter((it) => !(layout.doc().items || []).some((x) => x.url === it.url));
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

  // ── CUT / COPY / PASTE — the selection over the SYSTEM clipboard, as TEXT ──
  // Copy serializes the selected items to plain JSON ({ type: "sketchy/items",
  // items: [...] }) so paste works across sketches (and the payload is readable
  // anywhere text lands). Cut = copy + the ordinary undoable delete. Paste
  // instantiates with FRESH ids at the pointer (viewport centre fallback),
  // preserving the relative arrangement, into the ACTIVE surface. The
  // isTypingTarget guard keeps embeds' own clipboards untouched.
  const CLIP_KIND = "sketchy/items";
  function serializeSelection() {
    const surface = active();
    const items = selected()
      .map((id) => (surface.doc?.items || []).find((x) => x.id === id))
      .filter(Boolean)
      .map((o) => JSON.parse(JSON.stringify(o))); // plain clones (items are store proxies)
    return items.length ? JSON.stringify({ type: CLIP_KIND, items }) : null;
  }
  function onCopy(e) {
    if (isTypingTarget(e.target, viewportRef)) return;
    const text = serializeSelection();
    if (!text || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", text);
  }
  function onCut(e) {
    if (isTypingTarget(e.target, viewportRef)) return;
    const text = serializeSelection();
    if (!text || !e.clipboardData) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", text);
    deleteSelected(); // records the undoable delete like Backspace
  }
  function pasteItems(list) {
    const surface = active();
    const h = surface.handle;
    if (!h) return;
    // strip what can't travel: a `parent` box, a `sticky` dock and an `anchor`
    // corner all bind to the SOURCE context — the pasted copy lands free-floating
    // at the target point. Docs/frames keep their url (alt-drag copy semantics).
    const clean = list
      .filter((o) => o && typeof o === "object" && o.kind)
      .map((o) => { const c = JSON.parse(JSON.stringify(o)); delete c.parent; delete c.sticky; delete c.anchor; return c; });
    if (!clean.length) return;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const o of clean) { const b = itemBounds(o); minx = Math.min(minx, b.x); miny = Math.min(miny, b.y); maxx = Math.max(maxx, b.x + (b.w || 0)); maxy = Math.max(maxy, b.y + (b.h || 0)); }
    const target = myCursor() || centerWorld(); // the pointer's last world spot, else centre
    const dx = target.x - (minx + maxx) / 2, dy = target.y - (miny + maxy) / 2;
    const idMap = new Map(), gidMap = new Map();
    const home = surface.id === "root" ? activeLayerId() : null; // born on the active layer, like pushItem
    for (const c of clean) {
      idMap.set(c.id, c.id = uid());
      if (c.group != null) { if (!gidMap.has(c.group)) gidMap.set(c.group, "g" + uid()); c.group = gidMap.get(c.group); }
      if (c.kind === "stroke") { c.x = (c.x || 0) + dx; c.y = (c.y || 0) + dy; }
      else if (c.kind === "sketch") { for (const n of c.nodes || []) { n.x += dx; n.y += dy; } }
      else { c.x = (c.x || 0) + dx; c.y = (c.y || 0) + dy; if (c.cx != null) { c.cx += dx; c.cy += dy; } }
      if (home) {
        // the paste point is in the ACTIVE layer's coords — retag the home so the
        // item lands where pasted (pushItem's convention; legacy mirror kept)
        c.layers = [home];
        if (home !== baseLayer()?.id) c.layer = home; else delete c.layer;
      } else { delete c.layers; delete c.layer; } // frame children carry no layer tags
    }
    // pasted into an ENTERED box: items were positioned in ACTIVE-LAYER world
    // coords above, but a frame surface stores FRAME-LOCAL coords — run each
    // item through the same conversion pushItem uses (origin AND rotation folded
    // in; a stuck frame's dormant x/y resolve via effFrame). Sketches convert
    // node-by-node (they have no x/y/w/h box for convertToLocal to transform).
    const frame = surface.frame ? effFrame(surface.frame) : null;
    if (frame) for (const c of clean) {
      if (c.kind === "sketch") { for (const n of c.nodes || []) { const [lx, ly] = worldToLocal(frame, n.x, n.y); n.x = lx; n.y = ly; } }
      else convertToLocal(c, frame);
    }
    // arrow bindings: remap within the pasted set, drop ones pointing outside it
    for (const c of clean) {
      for (const [idKey, anchorKey] of [["fromId", "fromAnchor"], ["toId", "toAnchor"]]) {
        if (c[idKey] == null) continue;
        const m = idMap.get(c[idKey]);
        if (m) c[idKey] = m; else { delete c[idKey]; delete c[anchorKey]; }
      }
    }
    transact(h, "paste", () => h.change((d) => { if (!d.items) d.items = []; for (const c of clean) d.items.push(c); }));
    setSelected(clean.map((c) => c.id));
  }
  async function onPaste(e) {
    if (isTypingTarget(e.target, viewportRef)) return; // scoped: our own HOST patchwork-view doesn't count
    // sketchy items travel as plain text (see onCopy) — try that first
    const text = e.clipboardData?.getData && e.clipboardData.getData("text/plain");
    if (text && text.includes(CLIP_KIND)) {
      try {
        const p = JSON.parse(text);
        if (p && p.type === CLIP_KIND && Array.isArray(p.items)) { e.preventDefault(); pasteItems(p.items); return; }
      } catch {} // not ours — fall through
    }
    const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith("image/"));
    if (!item) return;
    e.preventDefault();
    const file = item.getAsFile();
    if (!file) return;
    const buf = new Uint8Array(await file.arrayBuffer());
    const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
    const name = `Pasted image.${ext}`;
    const child = await repo.create2({ "@patchwork": { type: "file" }, content: buf, extension: ext, mimeType: file.type, name });
    const r = viewportRect();
    const c = cam();
    const layout = rootLayoutH();
    if (!layout) return;
    layout.change((d) => { if (!d.items.some((x) => x.url === child.url)) d.items.push({ id: linkItemId(child.url), kind: "doc", url: child.url, x: (r.width / 2 - c.x) / c.z - 160, y: (r.height / 2 - c.y) / c.z - 120, w: 320, h: 240, rotation: 0, toolId: "" }); });
    handle.change((d) => { if (!d.docs.some((l) => l.url === child.url)) d.docs.push({ name, type: "file", url: child.url }); });
  }

  function onKeyDown(e) {
    // Escape always works (even while an embedded tool has focus): blur it,
    // drop selection, back to the pointer
    if (e.key === "Escape") { const a = document.activeElement; if (a && a.blur) a.blur(); closeOpenFlaps(); if (enteredGroup()) { setEnteredGroup(null); return; } setSelected([]); setSelectedWire(null); setPlacing(null); setPlaceGhost(null); setTool("select"); return; }
    // group / ungroup (works even with an embedded tool focused)
    if ((e.metaKey || e.ctrlKey) && (e.key === "g" || e.key === "G")) { e.preventDefault(); if (e.shiftKey) ungroupSelected(); else groupSelected(); return; }
    // undoing IN a text buffer / an embedded tool must NOT canvas-undo: everything below
    // (⌘Z/⌘Y, Backspace/Delete, bare z, tool keys) declines when the keystroke is aimed at
    // editable content or an embed's subtree — the inner editor owns its own history.
    // Scoped to our root: the patchwork-view the canvas ITSELF is mounted in is not an
    // embed (unscoped it ate every shortcut in the real host — see isTypingTarget).
    if (isTypingTarget(e.target, viewportRef)) return;
    if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) history.redo(); else history.undo(); return; }
    if ((e.metaKey || e.ctrlKey) && (e.key === "y" || e.key === "Y")) { e.preventDefault(); history.redo(); return; }
    if ((e.key === "Backspace" || e.key === "Delete") && selectedWire()) { e.preventDefault(); return deleteWire(selectedWire()); }
    if ((e.key === "Backspace" || e.key === "Delete") && selected().length) { e.preventDefault(); return deleteSelected(); }
    // bare z = undo, shift-z = redo; = / - zoom
    if (e.key === "z") { history.undo(); return; }
    if (e.key === "Z") { history.redo(); return; }
    if (e.key === "=" || e.key === "+") { zoomBy(1.2); return; }
    if (e.key === "-" || e.key === "_") { zoomBy(1 / 1.2); return; }
    if (e.key === "]") return reorder("forward");
    if (e.key === "[") return reorder("backward");
    if (e.key === "`") { setDebug((d) => !d); return; } // toggle op-debug (ops as JSON on the wires)
    // tool-arming shortcuts never fire with a modifier held — ⌘V (paste) must not
    // also arm select, ⌘A (host select-all) must not arm arrow, ⌥-anything ditto.
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // number row selects the standard tools in their classic left-to-right order
    // (1..9, then 0 = 10th) — the same set the seeded palette ships
    // (DEFAULT_LAYOUT.tools) plus the last-used overflow shape. These shortcuts
    // are CANVAS-level: they work with no toolbar/palette mounted at all.
    const palette = ["select", "hand", "pen", "eraser", "wire", "rectangle", "ellipse", "arrow", "text", extraShape()];
    if (/^[0-9]$/.test(e.key)) { const t = palette[e.key === "0" ? 9 : +e.key - 1]; if (t) { setTool(t); if (t === "line" || t === "box") setExtraShape(t); return; } }
    const map = { v: "select", h: "hand", p: "pen", r: "rectangle", o: "ellipse", l: "line", a: "arrow", t: "text", f: "box", e: "eraser", w: "wire" };
    if (map[e.key]) { const t = map[e.key]; setTool(t); if (t === "line" || t === "box") setExtraShape(t); } // overflow tools surface into the bar
  }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("paste", onPaste);
  window.addEventListener("copy", onCopy);
  window.addEventListener("cut", onCut);
  // wire-tool port grab — document capture so embedded tools can't swallow it
  document.addEventListener("pointerdown", onPointerDownCapture, true);
  onCleanup(() => document.removeEventListener("pointerdown", onPointerDownCapture, true));
  // claimed draws over body-swallowing spatial boxes (the map) start in the capture phase
  document.addEventListener("pointerdown", onDrawClaimCapture, true);
  onCleanup(() => document.removeEventListener("pointerdown", onDrawClaimCapture, true));
  // wire-from-embed: an embedded tool (e.g. the Form) owns its drag and announces it
  // via COMPOSED custom events that bubble out to us — robust across embed boundaries.
  const clientToLocal = (cx, cy) => { const r = viewportRect(); return { x: cx - r.left, y: cy - r.top }; };
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
  // clear BEFORE ticking: renderPaths memos re-run synchronously on the bump
  // and must re-resolve against the NEW theme, not the cached old one
  const bumpTheme = () => { colorCache.clear(); setThemeTick((t) => t + 1); };
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener?.("change", bumpTheme);
  const themeObserver = new MutationObserver(bumpTheme);
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "theme", "data-theme", "style"] });
  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown); window.removeEventListener("paste", onPaste);
    window.removeEventListener("copy", onCopy); window.removeEventListener("cut", onCut);
    mq.removeEventListener?.("change", bumpTheme); themeObserver.disconnect();
  });

  createEffect(() => { if (!selectish()) { setSelected([]); setEditingId(null); setSelectedWire(null); } });
  createEffect(() => {
    if (!addOpen() && !shapeMenuOpen()) return;
    const close = (e) => { if (!e.target.closest || !e.target.closest(".ns-add-wrap")) { setAddOpen(false); setShapeMenuOpen(false); } };
    window.addEventListener("pointerdown", close, true);
    onCleanup(() => window.removeEventListener("pointerdown", close, true));
  });
  // every folder link gets one doc/frame item in the layout doc (root surface). The join
  // itself is docs-lens.js; the component injects placement (only it knows the camera),
  // read lazily so a camera move doesn't churn when nothing's missing.
  createEffect(() => {
    const layout = rootLayoutH();
    if (!layout) return;
    docsLens.reconcile(folderDoc.docs || [], rootItems(), (fn) => layout.change(fn), () => {
      const c = cam(), r = viewportRect();
      return r ? { x: (r.width / 2 - c.x) / c.z, y: (r.height / 2 - c.y) / c.z } : { x: 0, y: 0 };
    });
  });

  // collapse the doubled item two peers materialize for one new link (see docs-lens dedupe).
  createEffect(() => {
    const layout = rootLayoutH(); if (!layout) return;
    docsLens.dedupe(rootItems(), (fn) => layout.change(fn));
  });

  // ---- presence (cursors, faces, shared view) -------------------------
  const [selfP, setSelfP] = createSignal(null);
  const [peers, setPeers] = createSignal(new Map(), { equals: false });
  const [showViews, setShowViews] = createSignal(false);
  const [following, setFollowing] = createSignal(null); // a peer's contactUrl we're following
  const [myCursor, setMyCursor] = createSignal(null); // ACTIVE-layer coords (the local paste target)
  let myBaseCursor = null; // BASE-world coords — what presence broadcasts (see trackCursor)
  let myContactUrl = null;
  // presence CONTROLS on the context — writable Sources, so the presence bare
  // window (presence-node.js) reads/toggles them over raw connects/apply, the
  // same way the minimap drives the camera. The mirror effect echoes each write
  // straight back as a plain push (never re-enters .apply) — no loop.
  context.showViews = new Source(false);
  context.showViews.apply = (op) => setShowViews(!!(isSnapshot(op) ? op.value : op && op.value));
  createEffect(() => context.showViews.push(showViews()));
  context.following = new Source(null);
  context.following.apply = (op) => setFollowing((isSnapshot(op) ? op.value : null) || null);
  createEffect(() => context.following.push(following()));
  context.serviceUrl = automergeUrlToServiceWorkerUrl; // avatar chips resolve through the service worker

  let selfOff = null, selfGone = false; // the contact-doc listener, removed on cleanup
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
      if (selfGone) return; // unmounted while we were loading — don't attach
      ch.on("change", refresh);
      selfOff = () => ch.off("change", refresh);
    } catch (e) { log.warn("presence self", e); }
  })();
  onCleanup(() => { selfGone = true; if (selfOff) { selfOff(); selfOff = null; } });

  function myViewRect() {
    const r = viewportRect();
    if (!r) return null;
    const k = viewportRef.offsetWidth ? r.width / viewportRef.offsetWidth : 1;
    return viewRect(cam(), r.width / k, r.height / k);
  }
  let lastBroadcast = 0;
  // Phase 4: the 55ms rate cap stays, but a send suppressed by it now schedules
  // ONE trailing send at the window's edge — a burst that ends mid-window no
  // longer leaves peers holding a stale cursor. The trailing send re-enters
  // broadcastPresence, so it reads the LATEST cursor/view/selection at fire time.
  let presenceTrailer = null;
  function broadcastPresence(force) {
    const s = selfP();
    if (!s) return;
    const now = Date.now();
    if (!force && now - lastBroadcast < 55) {
      if (presenceTrailer == null) presenceTrailer = setTimeout(() => { presenceTrailer = null; broadcastPresence(true); }, 55 - (now - lastBroadcast));
      return;
    }
    if (presenceTrailer != null) { clearTimeout(presenceTrailer); presenceTrailer = null; }
    lastBroadcast = now;
    if (handle.broadcast) handle.broadcast({ type: "ns-presence", contactUrl: s.contactUrl, name: s.name, color: s.color, avatarUrl: s.avatarUrl, cursor: myBaseCursor, view: myViewRect(), selection: selected(), tool: tool(), ts: now });
  }
  onCleanup(() => { if (presenceTrailer != null) { clearTimeout(presenceTrailer); presenceTrailer = null; } });
  function onPresence({ message: m }) {
    if (!m || m.contactUrl === myContactUrl) return;
    if (m.type === "ns-presence-bye") { setPeers((p) => { p.delete(m.contactUrl); return p; }); return; }
    if (m.type !== "ns-presence") return;
    setPeers((p) => { p.set(m.contactUrl, m); return p; });
  }
  if (handle.on) handle.on("ephemeral-message", onPresence);
  const presHeartbeat = setInterval(() => {
    broadcastPresence(true);
    setPeers((p) => { const now = Date.now(); for (const [k, v] of p) if (now - v.ts > 5000) p.delete(k); return p; });
  }, 1000);
  onCleanup(() => {
    if (handle.off) handle.off("ephemeral-message", onPresence);
    clearInterval(presHeartbeat);
    if (myContactUrl && handle.broadcast) handle.broadcast({ type: "ns-presence-bye", contactUrl: myContactUrl, ts: Date.now() });
  });
  createEffect(() => { cam(); broadcastPresence(); }); // share view as it moves
  // DECISION: presence travels in BASE-world coords whatever tab is active —
  // every peer renders cursors through the base camera (PresenceLayer), so an
  // overlay-tab pointer is converted before broadcast, never sent in overlay
  // coords. The local `context.pointer` outlet stays ACTIVE-layer (its consumers
  // — draw claims, the magnifier, wired nodes — work in the space being edited).
  const trackCursor = (e) => {
    const w = toWorld(e.clientX, e.clientY);
    setMyCursor(w);
    myBaseCursor = activeLayerId() === baseLayer()?.id ? w : toWorld(e.clientX, e.clientY, baseLayer()?.id);
    context.pointer.set(w);
    broadcastPresence();
    if (tool() === "place" && placing()) setPlaceGhost(w);
  };

  // bounds of everything (for the minimap), including peers' cursors + my view
  const worldBounds = createMemo(() =>
    contentBounds(rootItems().map((it) => itemBounds(projected(it))), [...peers().values()].map((p) => p.cursor), myViewRect())
  );

  // THE CANVAS AS A NODE — its full reactive state exposed as opstream OUTLETS, so a tool
  // placed on a layer is fed exactly what the canvas itself sees: every shape, the bounds
  // of everything, the peers. (camera/pointer/selection are already context Sources.) A bare
  // layer tool (minimap, map) wires its inlets to these — auto-wired by type while on the
  // layer, still real ports. The map reprojects `items`+`bounds`; its outlet IS its layer's
  // transform. These are the same reactive values the canvas uses, not a parallel copy.
  // Phase 4: these are fed per doc-change / per presence message — coalesced
  // like the pointer, one emission per 16ms window with the latest value.
  context.bounds = coalesceSource(context.bounds || new Source(null), "bounds");
  context.peers = coalesceSource(context.peers || new Source([]), "peers");
  context.view = coalesceSource(context.view || new Source(null), "view");
  context.rects = coalesceSource(context.rects || new Source([]), "rects");
  onCleanup(() => { for (const s of [context.bounds, context.peers, context.view, context.rects]) s.cancelPending(); });
  createEffect(() => context.bounds.push(worldBounds()));
  createEffect(() => context.peers.push([...peers().values()]));
  createEffect(() => context.view.push(myViewRect()));
  // item bounds rects {x,y,w,h,box} — precomputed because itemBounds() (per-kind geometry)
  // lives here, not in a placed node. The map (D) uses `items` raw; the minimap uses these.
  createEffect(() => context.rects.push(rootItems().map((it) => { const b = itemBounds(projected(it)); return { x: b.x, y: b.y, w: b.w, h: b.h, box: it.kind === "frame" }; })));
  // the named outlet bundle (id → { stream, type }) the layer-tool wiring enumerates.
  const canvasOutlets = () => ({
    camera: { stream: context.camera, type: "json" },
    pointer: { stream: context.pointer, type: "json" },
    selection: { stream: context.selection, type: "json" },
    items: { stream: context.board, type: "json" },
    bounds: { stream: context.bounds, type: "json" },
    peers: { stream: context.peers, type: "json" },
    view: { stream: context.view, type: "json" },
    rects: { stream: context.rects, type: "json" },
  });
  if (element && element.api) element.api.canvasOutlets = canvasOutlets; // inspectable; the layer-tool wiring reads this

  // THE TOP LAYER — a real, user-owned overlay associated with this doc but living in
  // YOUR account (`accountDoc.tools.sketchy.docs[folderUrl]`, datatype
  // `sketchy:layer:top`), auto-created with a default if absent. It holds the things
  // that are YOURS and absolutely positioned (floating inspectors now; movable
  // palette/zoom/minimap/params later). Per-user, syncs across your devices.
  // (declared before `wires`, which reads `floats()`.)
  const [topLayerH, setTopLayerH] = createSignal(null);
  ensureTopLayer().then(setTopLayerH).catch((e) => log.warn("top layer", e));
  const topLayerDoc = createMemo(() => { const h = topLayerH(); return h ? makeDocumentProjection(h) : null; });
  const floats = () => topLayerDoc()?.floats || [];
  const changeTop = (fn) => { const h = topLayerH(); if (h) h.change(fn); };
  // CHROME / LAYOUT customization — which parts show. LAYERED (3 tiers, most-specific wins):
  //   1. per-VIEWER override  (top-layer doc `chrome[part]`)   — "just me"
  //   2. per-SKETCH shared    (layout doc `layout[part]`)      — "this sketch", seeded
  //   3. the TOOL default     (`opts[part]`)                   — what makeSketchyTool shipped
  // The per-sketch layout is a real shared doc seeded from the tool's defaults (tier 3 is
  // the seed: an unset part resolves to the tool default until someone edits it). A NEW
  // patchwork:tool over the same component just ships different `opts` → different seed.
  // (the ⊞ tray's toggle UI for these parts was removed 2026-07-02 — the resolution
  // stays; the container-types redesign will bring back the write side)
  const chromePart = (part) => {
    const mine = topLayerDoc()?.chrome?.[part];          // tier 1 — per viewer
    if (mine === true || mine === false) return mine;
    const shared = rootLayoutDoc()?.layout?.[part];      // tier 2 — per sketch (shared)
    if (shared === true || shared === false) return shared;
    return opts[part] !== false;                         // tier 3 — tool default (the seed)
  };
  // (per-viewer flap state — `flaps[id]` in this top-layer doc — is orphaned data
  // now the flap-registry chrome is gone; old docs keep the field, nothing reads it)
  const addFloat = (source, x, y) => changeTop((d) => { if (!d.floats) d.floats = []; d.floats.push({ id: "fl-" + uid(), x, y, w: 220, h: 150, source }); });
  const removeFloat = (id) => changeTop((d) => { const i = (d.floats || []).findIndex((f) => f.id === id); if (i >= 0) d.floats.splice(i, 1); });
  const moveFloat = (id, x, y) => changeTop((d) => { const f = (d.floats || []).find((f) => f.id === id); if (f) { f.x = x; f.y = y; } });
  const sourceStreamFor = (source) =>
    source && source.context ? context[source.context] : source && source.peer ? peerStream(source.peer, source.part) : null;

  // live outlet streams of placed NODES (e.g. a lens's derived output), keyed by
  // item id. An EditorItem registers its outlets on mount; a downstream inlet wired
  // `{node, outlet}` resolves through here. A plain Map — an O(1) read, no store
  // proxy (README.md Phase 7). (Un)registration must still be REACTIVE: outlets land
  // AFTER an async mount (no rootItems change fires then), and wireSpecs' bidi
  // flags, the wire-subscription effect, editor-item's inlet backings and the port
  // nubs all resolve through nodeStream — so a manual bump signal replaces the
  // store's per-key tracking (coarser, but (un)registration is rare: mount/unmount
  // and setOutlet, never per frame).
  const nodeStreamsMap = new Map();
  const [nodeStreamsAt, setNodeStreamsAt] = createSignal(0);
  const registerOutlets = (id, outlets) => { nodeStreamsMap.set(id, outlets || {}); setNodeStreamsAt((n) => n + 1); };
  const unregisterOutlets = (id) => { if (nodeStreamsMap.delete(id)) setNodeStreamsAt((n) => n + 1); };
  const nodeStream = (id, outlet) => {
    nodeStreamsAt(); // subscribe reactive callers to (un)registration
    const o = nodeStreamsMap.get(id); if (o && o[outlet]) return o[outlet];
    // a drawn shape's geometry outlet → its writable stream (seeded from the item's value)
    if (outlet === "props") {
      const it = rootItems().find((x) => x.id === id);
      if (isShapeLike(it)) { const s = shapeStreamFor(id); if (s.value === undefined) s.push(shapeProps(it)); return s; }
    }
    return undefined;
  };

  // viewport-centre in world coords (where "add" actions drop things)
  const centerWorld = () => { if (!viewportRef) return { x: 0, y: 0 }; const r = viewportRect(); return toWorld(r.left + r.width / 2, r.top + r.height / 2); };
  // add an EXISTING doc to this folder by its automerge url (link + a canvas item)
  function addDocById(url) {
    url = (url || "").trim();
    if (!url) return;
    const p = centerWorld();
    handle.change((d) => { if (!d.docs) d.docs = []; if (!d.docs.some((l) => l.url === url)) d.docs.push({ url, name: url.replace(/^automerge:/, "").slice(0, 8), type: "" }); });
    const lh = rootLayoutH();
    if (lh) lh.change((d) => { if (!d.items) d.items = []; if (!d.items.some((it) => it.url === url)) d.items.push({ id: linkItemId(url), kind: "doc", url, x: p.x, y: p.y, w: 360, h: 280, rotation: 0 }); });
  }
  // pick an editor/lens to place — it then FOLLOWS THE CURSOR (place tool) and lands
  // on click (default size) or drag (sized). Same gesture as placing a doc.
  function placeUnwiredEditor(descriptor) { setPlacing({ what: "editor", descriptor }); setTool("place"); setAddOpen(false); }
  function placeUnwiredLens(descriptor) { setPlacing({ what: "lens", descriptor }); setTool("place"); setAddOpen(false); }

  // load (or create + register) this viewer's top-layer doc for the current folder
  async function ensureTopLayer() {
    if (!repo) return null;
    const acct = typeof window !== "undefined" && window.accountDocHandle;
    if (!acct) return repo.create2({ "@patchwork": { type: "sketchy:layer:top" }, floats: [] }); // no account → ephemeral
    const key = handle.url;
    const existing = acct.doc()?.tools?.sketchy?.docs?.[key];
    if (existing) { try { return await repo.find(existing); } catch {} }
    const top = await repo.create2({ "@patchwork": { type: "sketchy:layer:top" }, floats: [] });
    acct.change((d) => {
      if (!d.tools) d.tools = {};
      if (!d.tools.sketchy) d.tools.sketchy = {};
      if (!d.tools.sketchy.docs) d.tools.sketchy.docs = {};
      d.tools.sketchy.docs[key] = top.url;
    });
    // LWW race mitigation: two devices racing first-open both create a top-layer
    // doc; the map key converges last-writer-wins and the loser's per-user state
    // orphans. Cheap re-check: if a concurrent merge already overrode our write,
    // adopt the winner (a merge landing after this read still converges on the
    // key — only OUR just-created doc is ever abandoned).
    const winner = acct.doc()?.tools?.sketchy?.docs?.[key];
    if (winner && winner !== top.url) { try { return await repo.find(winner); } catch {} }
    return top;
  }

  // ── persistent wires ───────────────────────────────────────────────────────
  // a line from each wired editor inlet back to its source port; drawn whether or
  // not the wire tool is active, until the wire (inlet) is deleted (click it).
  const CTX_NAMES = ["camera", "pointer", "tool", "brush", "selection"];
  // (the "inspect" top-edge context-port strip and its 👁 tray toggle were removed
  // 2026-07-02 — context ports are placeable source NODES now; a context wire's
  // anchor is the fixed chip position in ctxPortPos below)
  const worldToScreen = (wx, wy) => chainToOuter([layerBoxOf(activeLayerId())], { x: wx, y: wy }, boxEnv); // active-layer world → screen, via the composer (one path)
  // README.md Phase 3 — the PORT INDEX. Wire endpoints resolve through a lazy Map
  // (automerge `url|pathJSON` → element) instead of a querySelectorAll walk per
  // geometry recompute. ONE viewport-scoped MutationObserver — filtered to
  // port-bearing nodes/attributes, so pan/zoom style churn and the wires' own
  // SVG never trip it — drops the map and bumps `portsTick`; the geometry reads
  // that tick, so a wire appears the moment its port mounts and drops the
  // moment it unmounts. `portScan` counts actual rebuilds (the budget: zero on
  // pure geometry recomputes).
  const [portsTick, setPortsTick] = createSignal(0);
  let domPortIndex = null;
  const invalidatePorts = () => { domPortIndex = null; setPortsTick((t) => t + 1); };
  const PORT_SEL = "[data-automerge-path]";
  const hasPorts = (n) => n.nodeType === 1 && ((n.matches && n.matches(PORT_SEL)) || (n.querySelector && n.querySelector(PORT_SEL)));
  const portObserver = new MutationObserver((records) => {
    for (const rec of records) {
      if (rec.type === "attributes") return invalidatePorts();
      for (const n of rec.addedNodes) if (hasPorts(n)) return invalidatePorts();
      for (const n of rec.removedNodes) if (hasPorts(n)) return invalidatePorts();
    }
  });
  onMount(() => { if (viewportRef) portObserver.observe(viewportRef, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-automerge-url", "data-automerge-path"] }); });
  // embedded tools render their ports ASYNC inside <patchwork-view> — the mount
  // event is the sure signal a fresh batch of port elements just landed
  const onToolMounted = () => invalidatePorts();
  document.addEventListener("patchwork:mounted", onToolMounted);
  onCleanup(() => { portObserver.disconnect(); document.removeEventListener("patchwork:mounted", onToolMounted); });
  function buildDomPortIndex() {
    perfCount("portScan");
    const m = new Map();
    for (const el of viewportRef.querySelectorAll("[data-automerge-path]")) {
      // key by the CANONICAL path JSON (the attribute may format it differently)
      let p; try { p = JSON.stringify(JSON.parse(el.dataset.automergePath)); } catch { continue; }
      m.set((el.dataset.automergeUrl || "") + "|" + p, el);
    }
    return m;
  }
  // Map hit → element; a DISCONNECTED hit (the observer's invalidation hasn't
  // delivered yet) forces one rebuild so a wire never anchors to a zero-rect.
  function portFromIndex(get, build, key) {
    const idx = get() || build();
    let hit = idx.get(key);
    if (hit && !hit.isConnected) hit = build().get(key);
    return hit;
  }
  function ctxPortPos(name) {
    if (!viewportRef) return null;
    const i = CTX_NAMES.indexOf(name); if (i < 0) return null;
    const H = viewportRef.offsetHeight;
    const chipH = 24, gap = 5, n = CTX_NAMES.length, total = n * chipH + (n - 1) * gap;
    return { x: 78, y: H / 2 - total / 2 + i * (chipH + gap) + chipH / 2 }; // ~right edge of the left-side chip
  }
  function domPortPos(url, path) {
    if (!viewportRef) return null;
    portsTick(); // the index is REACTIVE: port mount/unmount re-runs the geometry
    const el = portFromIndex(() => domPortIndex, () => (domPortIndex = buildDomPortIndex()), url + "|" + JSON.stringify(path));
    if (!el) return null;
    const r = el.getBoundingClientRect(), vr = viewportRect();
    return { x: r.left - vr.left + r.width, y: r.top - vr.top + r.height / 2 };
  }
  // a node port's SCREEN position, from item bounds + the port's index in its
  // descriptor (pure math — no DOM, so it's lag-free and survives hidden chips).
  // EVERY DRAWN SHAPE IS ALSO A SOURCE. A stroke/shape/text item exposes its geometry as
  // writable opstreams (x, y, w, h) + a params schema (its editable look) — so you can wire a
  // shape's position/size into the graph, OR drive the shape FROM a stream (apply writes back).
  const isShapeLike = (it) => it && (it.kind === "shape" || it.kind === "stroke" || it.kind === "text");
  const shapeParamsSchema = (it) => paramsSchema(
    it.kind === "text"
      ? [{ key: "color", label: "Colour", type: "color" }, { key: "fontSize", label: "Size", type: "number" }]
      : [{ key: "color", label: "Colour", type: "color" }, { key: it.kind === "shape" ? "strokeWidth" : "size", label: "Size", type: "number" }, ...(it.kind === "shape" ? [{ key: "fill", label: "Fill", type: "color" }] : [])]
  );
  const shapeDesc = (it) => ({ id: "shape:" + it.kind, name: it.kind, outlets: [{ name: "props", type: "json", schema: anySchema() }], inlets: [], schema: shapeParamsSchema(it) });
  const descFor = (item) => isShapeLike(item) ? shapeDesc(item) : (listEditors().find((d) => d.id === item.editorId) || listLensDescriptors().find((d) => d.id === item.editorId));

  // a writable Source per shape geometry field, lazily created when first wired. `apply`
  // writes the field back to the item (so a stream can drive the shape); the effect below
  // keeps the value synced from the item (so wiring OUT reflects moves/resizes).
  const shapeStreams = new Map();
  const shapeProps = (it) => {
    // SHALLOW copy of the shape's own fields (params + geometry) — NOT a deep JSON
    // clone: the sync effect below runs on every rootItems change (every drawn point), so a
    // deep clone of every wired shape — including a growing stroke's whole points array — was
    // O(n²). Nested reassignments (points/geometry are replaced, not mutated) still re-fire.
    const o = {}; for (const k in it) if (k !== "parent") o[k] = it[k];
    return o;
  };
  function shapeStreamFor(id) {
    let s = shapeStreams.get(id);
    if (!s) {
      s = new Source(undefined);
      s.apply = (op) => {
        if (!op) return;
        if (op.type === "snapshot") { if (op.value && typeof op.value === "object") setItemFields(id, op.value); return; }
        if ((!op.path || op.path.length === 0) && op.range != null && !Array.isArray(op.range) && op.value !== undefined) setItemFields(id, { [op.range]: op.value }); // root-graph write (shape streams are root-only)
      };
      shapeStreams.set(id, s);
    }
    return s;
  }
  createEffect(() => {
    const items = rootItems();
    for (const [id, s] of shapeStreams) {
      const it = items.find((x) => x.id === id);
      if (!it) { shapeStreams.delete(id); continue; } // GC: shape deleted, drop its stream
      const props = shapeProps(it);
      // per-key identity-first compare (README.md Phase 7) — an untouched `points`
      // array keeps its projection identity, so no JSON walk of a big stroke here
      if (!shapePropsEqual(s.value, props)) s.push(props);
    }
  });

  // Click a port (no drag) → a world-anchored popover describing it FULLY: name,
  // direction, declared type, what its Standard Schema actually accepts — the REAL
  // field structure via describeSchema ("{ name: string, count?: number }", one
  // field per line when big — formatShape), and — for a live port — the current
  // value's shape + a short preview. "json" alone (or the old probed
  // "(specific shape)") wasn't enough; this shows the real story.
  function valueShape(v) {
    if (v === undefined) return "—";
    if (v === null) return "null";
    const d = describeBinary(v); if (d) return d;
    if (Array.isArray(v)) return `array(${v.length})`;
    if (typeof v === "object") return `object {${Object.keys(v).slice(0, 8).join(", ")}${Object.keys(v).length > 8 ? ", …" : ""}}`;
    return typeof v;
  }
  function showPortInfo(port, clientX, clientY) {
    if (!port) return;
    const lines = [];
    let title = "", def = null, stream = null, dir = "";
    if (port.kind === "node") {
      const up = rootItems().find((x) => x.id === port.node), ud = up && descFor(up);
      def = ud && outletDefsFor(ud, up).find((o) => o.name === port.outlet);
      stream = nodeStream(port.node, port.outlet);
      title = `${ud?.name || up?.editorId || "node"} ▸ ${port.outlet}`; dir = "outlet";
    } else if (port.kind === "inlet") {
      const it = rootItems().find((x) => x.id === port.node), d = it && descFor(it);
      def = d && inletDefsFor(d, it).find((i) => i.name === port.inlet);
      title = `${d?.name || it?.editorId || "node"} ◂ ${port.inlet}`; dir = "inlet";
    } else if (port.kind === "context") { title = `context ▸ ${port.name}`; dir = "outlet"; stream = context[port.name]; }
    else if (port.kind === "peer") { title = `peer ▸ ${port.part}`; dir = "outlet"; stream = peerStream(port.contactUrl, port.part); }
    else if (port.kind === "automerge") { title = `doc field`; dir = "field"; lines.push(`path: .${(port.path || []).join(".")}`); }
    lines.unshift(`${dir}${def?.type ? " · type " + def.type : ""}`);
    if (def?.options) lines.push(`one of: ${def.options.join(" | ")}`);
    if (def?.schema) {
      // the ACTUAL shape the schema accepts, one field per line when it's big
      const [first, ...rest] = formatShape(describeSchema(def.schema));
      if (first) lines.push(`accepts: ${first}`, ...rest);
    }
    if (def?.required) lines.push("required");
    if (stream) { lines.push(`value: ${valueShape(stream.value)}`); if (typeof stream.apply === "function") lines.push("writable (bidi)"); }
    setPortInfo({ world: toWorld(clientX, clientY), title, lines });
  }
  function nodePortScreen(item, side, name) {
    const d = descFor(item);
    const ports = (side === "out" ? outletDefsFor(d, item) : inletDefsFor(d, item)) || [];
    const idx = Math.max(0, ports.findIndex((p) => p.name === name));
    const off = side === "out" ? 12 : -12; // match the nubs' outward offset (screen px)
    if (isStuck(item)) {
      // a STUCK window renders counter-scaled (it holds its SCREEN size), so its
      // port geometry is pure screen math off the resolved dock rect — running
      // it through the layer zoom put ports 2× off at 200%.
      const sr = stickyScreen(item);
      const pt = portPoint({ x: sr.x, y: sr.y, w: item.w || 0, h: item.h || 0 }, side, idx, ports.length || 1);
      return { x: pt.x + off, y: pt.y };
    }
    const b = itemBounds(item);
    const pt = portPoint(b, side, idx, ports.length || 1);
    // project through the ITEM's HOME layer, not the active tab — an overlay
    // widget's ports must not run through the base camera (and vice versa)
    const s = chainToOuter([layerBoxOf(itemHomeLayer(item))], pt, boxEnv);
    return { x: s.x + off, y: s.y };
  }
  // a ROUND node's port rides the perimeter toward whatever it connects to (the
  // "wire spines around it" behaviour) — point on the ellipse edge facing `toScreen`.
  function roundPortToward(item, toScreen) {
    const b = itemBounds(item);
    const chain = [layerBoxOf(itemHomeLayer(item))]; // the node's HOME space (cf. nodePortScreen)
    const c = chainToOuter(chain, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, boxEnv);
    const z = chainScale(chain, boxEnv) || 1;
    const rx = (b.w / 2) * z, ry = (b.h / 2) * z;
    const ang = Math.atan2(toScreen.y - c.y, toScreen.x - c.x);
    return { x: c.x + Math.cos(ang) * rx, y: c.y + Math.sin(ang) * ry };
  }
  // The STRUCTURE of the wires (which ports connect, bidi-ness) — recomputed only
  // when the wiring graph changes, NOT on pan/zoom/move. Stable identity (returns
  // the previous array when the structural signature is unchanged) so the <For>
  // doesn't recreate rows every frame. Geometry is a separate per-row memo below.
  const wireSpecs = createMemo((prev) => {
    const specs = [];
    for (const it of rootItems()) {
      if (it.kind !== "editor" || !it.inlets) continue;
      for (const [name, w] of Object.entries(it.inlets)) {
        if (!w) continue;
        let bidi = false;
        if (w.node) { const s = nodeStream(w.node, w.outlet); bidi = !!(s && typeof s.apply === "function"); }
        else if (w.url) bidi = !w.heads;
        specs.push({ key: it.id + ":" + name, editorId: it.id, inlet: name, wire: w, bidi, dir: w.dir || "both" });
      }
    }
    for (const f of floats()) if (f.source && (f.source.context || f.source.peer)) specs.push({ key: f.id, floatId: f.id, source: f.source });
    const sig = specs.map((s) => s.key + (s.bidi ? "!" : "") + (s.dir || "")).join("|");
    if (prev && prev.sig === sig) return prev; // unchanged structure ⇒ reuse identity
    specs.sig = sig;
    return specs;
  });
  // a wire belongs to the layer of its downstream node; render only the active layer's wires
  // (each in that layer's space, via worldToScreen → activeToScreen). floats sit in the base.
  // README.md Phase 6 — a MEMO, so the two JSX callsites (the <Show> gate + the
  // <For>) share ONE computation per change instead of filtering twice per render.
  const visibleWires = createMemo(() => {
    perfCount("visibleWires"); // README.md Phase 6: an ACTUAL wire-list recompute
    const active = activeLayerId(), base = baseLayer()?.id;
    // a non-base layer (the overlay) is CHROME — its wires are plumbing (minimap ← canvas node,
    // etc.). Hide them unless you're actually wiring, so the overlay isn't a tangle of pink.
    if (active !== base && tool() !== "wire") return [];
    const layerById = new Map(rootItems().map((it) => [it.id, itemHomeLayer(it)])); // built ONCE, not per-spec (a wire lives in its node's HOME space)
    const homeOf = (id) => layerById.get(id) || base;
    return wireSpecs().filter((s) => {
      if (s.floatId) return base === active;
      if (homeOf(s.editorId) !== active) return false;
      // BOTH endpoints must live on the active layer: a wire SPANNING layers is
      // HIDDEN (rule) — each end needs its own transform and one of them is in a
      // space that isn't on screen; it draws only on a layer holding both nodes.
      // (context/peer/url anchors are screen chrome — the downstream check covers them.)
      const w = s.wire;
      if (w && w.node && homeOf(w.node) !== active) return false;
      return true;
    });
  });

  // geometry for one wire spec — reads cam + the live item positions, so it updates
  // fine-grained (just the transform/d attrs) on pan/zoom/move without rebuilding DOM.
  function geomFor(spec) {
    cam(); peers();
    if (spec.floatId) {
      const f = floats().find((x) => x.id === spec.floatId);
      if (!f) return null;
      let from = null;
      if (f.source.context) from = ctxPortPos(f.source.context);
      else if (f.source.peer) { const p = peers().get(f.source.peer); if (p && p.view) from = cameraToScreen(p.view.x + p.view.w, p.view.y + p.view.h / 2); }
      return from ? { from, to: { x: f.x, y: f.y + 10 } } : null;
    }
    const it = findById(rootItems(), spec.editorId, indexById()); // O(1) port lookups (Phase 2 index)
    if (!it) return null;
    const w = spec.wire;
    let from = null;
    if (w.context) from = ctxPortPos(w.context);
    else if (w.peer) { const p = peers().get(w.peer); if (p && p.view) from = cameraToScreen(p.view.x + p.view.w, p.view.y + p.view.h / 2); }
    else if (w.node) { const up = findById(rootItems(), w.node, indexById()); if (up) from = descFor(up)?.round ? roundPortToward(up, nodePortScreen(it, "in", spec.inlet)) : nodePortScreen(up, "out", w.outlet); }
    else if (w.url) from = domPortPos(w.url, w.path);
    return from ? { from, to: nodePortScreen(it, "in", spec.inlet) } : null;
  }
  // the live SOURCE opstream feeding a wire spec (for error tracking)
  const wireSourceStream = (spec) => {
    if (spec.source) return sourceStreamFor(spec.source);
    const w = spec.wire; if (!w) return null;
    if (w.context) return context[w.context];
    if (w.peer) return peerStream(w.peer, w.part);
    if (w.node) return nodeStream(w.node, w.outlet);
    return null; // url sources resolve async — not error-tracked here
  };
  // ERROR VISUALIZATION: errors live on mutable stream objects, so subscribe per-wire
  // to its source and mirror the error state into a STORE the render can read reactively.
  // A wire carrying an error draws red (see the wire <g> below).
  const [wireErrors, setWireErrors] = createStore({});
  // WIRE PULSE: a per-wire token bumped whenever a value flows; the render replays a
  // dot along the wire (snake-eats-apple). Same subscription as the error tracking.
  const [wirePulse, setWirePulse] = createStore({});
  // DEBUG: ops are the heart of the system but the least visible thing. In debug mode (` key)
  // we capture the actual op JSON flowing on each wire and render it on the wire as it flows.
  const [debug, setDebug] = makePersisted(createSignal(false), { name: "sketchy:debug" });
  // the PERF OVERLAY (perf.js startOverlay — README.md Phase 0): the same ` toggle
  // also mounts the frame-time + __perf-counter readout (.ns-perf, style.css)
  // into the canvas root; toggle-off / unmount stops the loop and removes it.
  createEffect(() => {
    if (!debug() || !viewportRef) return;
    const el = document.createElement("div");
    el.className = "ns-perf";
    viewportRef.append(el);
    const stop = startOverlay(el);
    onCleanup(() => { stop(); el.remove(); });
  });
  const [wireOps, setWireOps] = createStore({});
  createEffect(() => {
    const specs = wireSpecs();
    const offs = [];
    for (const spec of specs) {
      const s = wireSourceStream(spec);
      if (!s || !s.connect) continue;
      let first = true, tick = 0;
      offs.push(s.connect((op) => {
        if (isError(op)) { setWireErrors(spec.key, op.error); return; }
        setWireErrors(spec.key, undefined);
        if (first) { first = false; return; }              // skip the initial snapshot
        setWirePulse(spec.key, (n) => ((n || 0) + 1) % 1e9); // a value flowed → pulse
        if (debug()) setWireOps(spec.key, { text: opPreview(op), n: ++tick }); // the op JSON, live
      }));
    }
    onCleanup(() => offs.forEach((o) => o && o()));
  });
  // a compact, binary-safe JSON preview of an op (camera frames etc. never stringified)
  function opPreview(op) {
    try { const s = JSON.stringify(op, binarySafeReplacer); return s.length > 140 ? s.slice(0, 137) + "…" : s; }
    catch { return String(op); }
  }

  // context outlets in use (by an editor inlet OR a floating top-layer inspector)
  // — these stay visible after the wire tool is deselected. (pure: wire.js)
  const usedContextOutlets = createMemo(() => computeUsedContextOutlets(rootItems(), floats()));
  function unwire(editorId, inlet) {
    // wire specs come from rootItems — the wiring graph lives in the root layout doc
    const rh = rootLayoutH();
    if (rh) transact(rh, "unwire", () => rh.change((d) => {
      const o = d.items.find((x) => x.id === editorId);
      // null (not delete): the EXPLICIT-DISCONNECT tombstone. A bare tool's inlet whose
      // name matches a canvas outlet auto-wires whenever it has NO entry — deleting the
      // key would let the minimap etc. silently rebind to the same ambient stream, so
      // "remove the wire" would be a no-op. editor-item's inletBackingPlan honours the
      // tombstone: a cut inlet reverts to its own buffer (no splat/auto fallback).
      if (o && o.inlets && o.inlets[inlet] !== undefined) o.inlets[inlet] = null;
    }));
  }
  // delete a SELECTED wire (Backspace/Delete) — disconnects it / removes the float
  function deleteWire(spec) {
    if (!spec) return;
    if (spec.floatId) removeFloat(spec.floatId); else unwire(spec.editorId, spec.inlet);
    setSelectedWire(null);
  }
  // OVERRIDE a bidi wire's flow direction. Cycles both → fwd → back → both (the inlet
  // proxy enforces it: "fwd" reads only, "back" writes only). Persisted as `inlet.dir`.
  function cycleWireDir(spec) {
    if (!spec || spec.floatId || !spec.bidi) return;
    const next = { both: "fwd", fwd: "back", back: "both" }[spec.dir || "both"];
    // wire specs come from rootItems — the wiring graph lives in the root layout doc
    const rh = rootLayoutH();
    if (rh) transact(rh, "wire-dir", () => rh.change((d) => {
      const o = d.items.find((x) => x.id === spec.editorId);
      if (!o || !o.inlets || !o.inlets[spec.inlet]) return;
      if (next === "both") delete o.inlets[spec.inlet].dir; else o.inlets[spec.inlet].dir = next;
    }));
  }

  // Ensure a Tool (patchwork-tool) is wired to a source node's `doc` outlet — so a doc
  // adopted by an Automerge source is actually SHOWN. No-op if one already is; otherwise
  // places a Tool just to the right of the source, wired in.
  function ensureToolWiredTo(srcId, srcItem) {
    const already = rootItems().some((x) => x.kind === "editor" && x.inlets && Object.values(x.inlets).some((w) => w && w.node === srcId && w.outlet === "doc"));
    if (already) return;
    const lh = rootLayoutH(); if (!lh) return; // root graph: srcItem + its coords are root's
    const x = (srcItem?.x || 0) + (srcItem?.w || 220) + 60, y = srcItem?.y || 0;
    const tid = "ed-" + uid();
    lh.change((d) => { if (!d.items) d.items = []; d.items.push(makeEditorItem({ id: tid, editorId: "patchwork-tool", x, y, w: 360, h: 280, inlets: { doc: { node: srcId, outlet: "doc" } } })); });
  }

  // peer-state opstreams: a Source per (contactUrl, part), kept fresh from presence
  // by one effect. So wiring a peer outlet → an inspector shows that peer's live part.
  const peerStreams = new Map();
  const PEER_SEP = "|";
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

  function centerOn(wx, wy) {
    const r = viewportRect();
    const k = viewportRef.offsetWidth ? r.width / viewportRef.offsetWidth : 1;
    setCam(centerCam(cam(), wx, wy, r.width / k, r.height / k));
  }
  // FOLLOW MODE: fit my camera to a peer's view rect (whole rect visible, centred).
  function fitCameraTo(pv) {
    if (!viewportRef || !pv || !pv.w || !pv.h) return;
    const r = viewportRect();
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
  function getProp(key) { const ts = editTargets(); if (ts.length) { const o = ts[0]; return o[storedKey(o.kind, key)]; } const bid = activeBrushId(); if (bid) return brushParam(bid, key); return brush[key]; }
  function setProp(key, val) {
    const ts = editTargets();
    const bid = !editTargets().length && activeBrushId();
    if (bid) { setBrushParam(bid, key, val); return; } // a custom brush's own param (persisted per-viewer)
    if (ts.length) {
      transact(active().handle, "style", () => active().handle.change((d) => { for (const t of ts) { const o = d.items.find((x) => x.id === t.id); if (!o || (SHAPE_ONLY.has(key) && o.kind !== "shape") || (TEXT_ONLY.has(key) && o.kind !== "text")) continue; o[storedKey(o.kind, key)] = val; } }));
      // editing a selection ALSO becomes the default for the next thing you draw
      setBrush(key === "size" && ts[0].kind === "text" ? "fontSize" : key, val);
      return;
    }
    setBrush(key, val);
  }
  // setItemField/setItemConfig edit the SELECTED item (Properties panel) — the selection
  // lives on the active surface, so `active()` is right there. setItemFields is only
  // driven by the shape streams (root-only wiring graph), so it targets the ROOT doc.
  function setItemField(id, field, val) { transact(active().handle, "edit", () => active().handle.change((d) => { const o = d.items.find((x) => x.id === id); if (o) o[field] = val; })); }
  // the Properties "appears on" row: flip a VISIBILITY membership on/off. The HOME
  // (layers[0]) is locked on — it owns the coordinates — so it never toggles here,
  // and the legacy `layer` mirror (home) is left untouched (never deleted).
  function toggleItemLayer(id, layerId) {
    const rh = rootLayoutH(); if (!rh) return;
    transact(rh, "layers", () => rh.change((d) => {
      const o = d.items.find((x) => x.id === id); if (!o) return;
      const cur = itemLayers(o);
      if (layerId === cur[0]) return;
      o.layers = cur.includes(layerId) ? cur.filter((l) => l !== layerId) : [...cur, layerId];
    }));
  }
  function setItemFields(id, obj) { const rh = rootLayoutH(); if (!rh) return; transact(rh, "param", () => rh.change((d) => { const o = d.items.find((x) => x.id === id); if (o) for (const k in obj) if (k !== "id" && k !== "kind") o[k] = obj[k]; })); }
  // write a key into a NODE's persisted config (its params live here; a mounted node reacts
  // via onConfig). Same shape setConfig uses inside editor-item, but driven from the popup.
  function setItemConfig(id, key, val) { transact(active().handle, "param", () => active().handle.change((d) => { const o = d.items.find((x) => x.id === id); if (o) { if (!o.config) o.config = {}; o.config[key] = val; } })); }

  // PARAM TARGET for the properties popup — params come from EITHER a single selected NODE
  // (read/write its config) OR the active brush (read/write its per-viewer brush config).
  // Same control set renders both; this is "a knob is a knob, on a node or a brush".
  const selectedNodeDesc = createMemo(() => {
    const s = selected(); if (s.length !== 1) return null;
    const it = itemById(s[0]); if (!it || it.kind !== "editor") return null;
    const d = listEditors().find((e) => e.id === it.editorId) || listLensDescriptors().find((e) => e.id === it.editorId);
    return d ? { it, d } : null;
  });
  // the SYNC-resolvable stream behind a wiring entry (url wires resolve async — the
  // panel just disables those and shows the config value with the wire hint).
  const wireStreamSync = (w) => {
    if (!w) return null;
    if (w.context) return context[w.context];
    if (w.peer) return peerStream(w.peer, w.part);
    if (w.node) return nodeStream(w.node, w.outlet);
    return null;
  };
  const paramTarget = createMemo(() => {
    const n = selectedNodeDesc();
    if (n) {
      const defs = paramDefs(n.d);
      // inlets wired to a RAW VALUE node — editable inline in the popup (through the
      // raw node's stream), not just on the node itself.
      const raws = rawValueInlets(n.it, inletDefsFor(n.d, n.it), rootItems());
      if (!defs.length && !raws.length) return null;
      return { title: n.d.name, defs, raws,
        get: (k) => { const c = n.it.config || {}; return k in c ? c[k] : brushParamDefault(n.d, k); },
        set: (k, v) => setItemConfig(n.it.id, k, v),
        // param-inlet-wins-when-wired: the wiring entry for a param key (null/absent ⇒
        // unwired) + the live stream behind any wiring, for the panel to display.
        wire: (k) => paramWireFor(n.it, k),
        stream: wireStreamSync };
    }
    const bid = activeBrushId();
    if (bid) { const m = brushMod(bid); const defs = paramDefs(m); if (defs.length) return { title: m?.name, defs, get: (k) => brushParam(bid, k), set: (k, v) => setBrushParam(bid, k, v) }; }
    return null;
  });

  const propMode = createMemo(() => {
    const sel = selected();
    if (sel.length > 1) return "multi";
    if (sel.length === 1) { const it = itemById(sel[0]); return it ? it.kind : null; }
    if (tool() === "pen") return "stroke";
    if (SHAPE_TOOLS.has(tool())) return "shape";
    if (tool() === "text") return "text";
    if (isBrushTool(tool()) && paramDefs(brushMod(tool())).length) return "brush";
    return null;
  });
  // show the popup for a style mode OR whenever there are params to show (node or brush)
  const showProps = createMemo(() => chromePart("properties") && (propMode() !== null || !!paramTarget()));

  // CHROME HOST — what every chrome part (and a wrapping tool's SLOT,
  // opts.slots[part](host)) receives. STATE is read from `host.context` — the same
  // camera/pointer/tool/brush/selection (+ peers/board/…) Sources the canvas itself
  // runs on (README.md §3a: the component exposes state; it doesn't own chrome) —
  // while the host adds only the narrow COMMAND/QUERY surface (setTool, doc
  // mutations, the param target). No mirrored state accessors: chrome derives its
  // signals from the context (opstreamToSignal), so a custom slot renderer reads
  // exactly what the built-ins read.
  const chromeHost = {
    context, // camera/pointer/tool/brush/selection (+ board/bounds/peers/view/rects) Sources
    // toolbar — `tools` is the per-sketch list from the LAYOUT DOC (editable as data),
    // falling back to the tool's opts. A getter so it stays reactive to the doc.
    minimal: opts.minimal,
    get tools() { return rootLayoutDoc()?.layout?.tools ?? opts.tools; },
    setTool, datatypes, brushes,
    addOpen, setAddOpen, shapeMenuOpen, setShapeMenuOpen, extraShape, setExtraShape,
    selectPlacing, editors: catalogWindows, lenses: catalogLenses,
    addById: addDocById, placeEditor: placeUnwiredEditor, placeLens: placeUnwiredLens, placeFlap,
    // properties
    mode: propMode, params: paramTarget, get: getProp, set: setProp, pos: propsPos, setPos: setPropsPos,
    single, setField: setItemField, linkFor, reorder,
    // the "appears on" row (layer memberships) — root-surface items only (a frame
    // child lives in another doc's space, so it has no layer tags to edit)
    layers: () => (activeId() === "root" ? layersList() : []),
    itemLayersOf: itemLayers, toggleItemLayer,
    hasGroup, group: groupSelected, ungroup: ungroupSelected,
    rect: () => { const it = single(); return it ? (it.kind === "shape" && it.type === "rectangle") : tool() === "rectangle"; },
    arrow: () => { const it = single(); return it ? (it.kind === "shape" && it.type === "arrow") : tool() === "arrow"; },
    fillable: () => { const it = single(); const t = it ? (it.kind === "shape" ? it.type : null) : tool(); return t === "rectangle" || t === "ellipse"; },
    // presence (commands/queries; peer + camera STATE come from the context)
    serviceUrl: automergeUrlToServiceWorkerUrl,
    showViews, setShowViews, following,
    follow: (id) => setFollowing((f) => (f === id ? null : id)),
    // commands for richer custom slots (their state reads come from `context`)
    setCam, setSelected,
  };
  // a chrome part's SLOT, if a wrapping tool supplied one (opts.slots[part]) — else null.
  const slot = (part) => (opts.slots && opts.slots[part]) || null;

  // the base layer's CSS transform, from its registered transform plugin (dogfoods the
  // registry — for the camera plugin this is the same translate/scale as before).
  const worldTransform = () => txFor(baseLayer()).transform();
  // the draft/selection svg lives in the ACTIVE layer's space. Derive the affine from the
  // transform's toScreen of three basis points → a matrix() that works for ANY transform
  // (camera, viewport, a future geo projection), so the live preview is sharp on any layer.
  const svgTransform = () => {
    const t = txFor(activeLayer()); const o = t.toScreen(0, 0), bx = t.toScreen(1, 0), by = t.toScreen(0, 1);
    return `matrix(${bx.x - o.x} ${bx.y - o.y} ${by.x - o.x} ${by.y - o.y} ${o.x} ${o.y})`;
  };
  const cursorClass = () => { const t = tool(); if (t === "hand") return "ns-cur-grab"; if (t === "select" || t === "wire") return "ns-cur-default"; return "ns-cur-cross"; };

  // the WebRTC mesh for node sharing — values over a data channel, streams over tracks,
  // signalled on the folder-doc ephemeral channel (the CallSession concept, reused).
  // Identity resolves through the presence heartbeat store (the ONE peer store):
  // the session holds connection state only, keyed by the same contactUrls.
  const shareSession = new ShareSession(handle, sessionMyUrl(), (url) =>
    untrack(() => { const s = selfP(); return (s && s.contactUrl === url ? s : peers().get(url)) || null; }));
  onCleanup(() => shareSession.destroy());

  const ctx = {
    shareSession,
    indexById, // the per-tick root-items index (README.md Phase 2) — item.jsx z/parent lookups
    tool, themeTick, resolveColor, onItemDown, isSelected, linkFor, itemBounds,
    spaceEpoch, // bumps when a spatial box's projection moves (map pan/zoom) → parented items re-project
    serviceUrl: automergeUrlToServiceWorkerUrl, loadSpace, loadDoc, loadDatatype, registerSurface, unregisterSurface,
    editingId, setEditingId, tombstoned: (url) => docsLens.isTombstoned(url),
    deselect: () => setSelected([]),
    toWorld, select: (ids) => setSelected(ids),
    removeItem: (id) => removeItems(null, [id]),
    dropTarget, escapeId, embedsReady, history,
    enteredGroup,
    // double-clicking a grouped item descends INTO its group (figma-style); a
    // second double-click then reaches the member's own action (text edit, …)
    enterGroup: (it) => { if (it.group && it.group !== enteredGroup()) { setEnteredGroup(it.group); setSelected([it.id]); return true; } return false; },
    boxBounds: (id) => { const f = rootItems().find((x) => x.id === id); return f ? itemBounds(effFrame(f)) : null; }, // effFrame: a STUCK box's stored x/y are dormant — the drop preview must clip at the resolved dock rect
    api: element?.api, // the sketchy api (find → opstream, editors, …) for EditorItem
    context, // the canvas context Sources, for context-wired editor inlets
    peerStream, // (contactUrl, part) → a live Source of a peer's state, for peer-wired inlets
    nodeStream, registerOutlets, unregisterOutlets, // node outlets (lens outputs) — see registry above
    canvasOutlets, // the canvas-as-node reactive state (items/bounds/peers/camera/…) for bare layer tools
    // a bare tool shows its ports + auto-wires while ITS (home) layer is the active one
    layerIsActive: (it) => itemHomeLayer(it) === activeLayerId(),
    // membership-driven visibility + sticky placement (root items; item.jsx baseStyle)
    itemHidden, memberOnActive, stickyPlace,
    // FLAPS — the collapsed-tab render + per-viewer open state (DocOrFrame)
    flapOpen, setFlapOpen, flapTabPlace,
  };

  const handleBox = createMemo(() => {
    if (!selectish()) return null;
    if (editingId()) return null; // while editing text, show only the caret — no box/handles
    const raw = single();
    const it = projected(raw); // a parented mark's handles sit on its WORLD projection
    if (it) {
      if (it.kind === "shape" && (it.type === "arrow" || it.type === "line")) return null; // use endpoint handles
      if (it.kind === "sketch") return null; // sketches articulate via their nodes, not resize/rotate handles
      const frame = active().frame;
      // FIT-CONTENT windows (descriptor.fit — the palette) size themselves via
      // setSize; the Handles chrome suppresses their resize dots (box.fit).
      const fit = it.kind === "editor" && !!descFor(it)?.fit;
      if (isStuck(it) && active().id === "root") {
        // a STUCK window renders counter-scaled (stickyPlace k = 1/zoom) so it
        // HOLDS its screen size: its handle box is exactly the resolved dock
        // rect at the stored size — scaling by the layer zoom put the handles
        // 2× off at 200% (and made resize mistrack).
        const sr = stickyScreen(it);
        return { x: sr.x, y: sr.y, w: it.w || 0, h: it.h || 0, rot: it.rotation || 0, kind: it.kind, fit };
      }
      const z = boxScale(active(), raw); // the ITEM's home-layer scale (not the active tab's)
      // like startResizeSel: strokes/up-left shapes have bounds ≠ (x,y)
      const ob = itemBounds(it);
      const s = boxToScreen(active(), { x: ob.x + ob.w / 2, y: ob.y + ob.h / 2 }, raw); // compose the item's home layer → frame → screen
      const sw = ob.w * z, sh = ob.h * z;
      return { x: s.x - sw / 2, y: s.y - sh / 2, w: sw, h: sh, rot: (it.rotation || 0) + (frame ? frame.rotation || 0 : 0), kind: it.kind, fit };
    }
    const z = boxScale(active());
    const u = selWorldBounds();
    // u is already in WORLD (selWorldBounds applied the frame), so project by the LAYER only.
    if (u) { const s = chainToOuter([layerBoxOf(activeLayerId())], { x: u.x, y: u.y }, boxEnv); return { x: s.x, y: s.y, w: u.w * z, h: u.h * z, rot: 0, kind: "multi" }; }
    return null;
  });

  // screen positions of a selected arrow/line's grab dots (2 endpoints + a
  // line's bezier control point)
  const segSel = createMemo(() => {
    if (!selectish() || editingId()) return null;
    const raw = single();
    const it = projected(raw); // parented line/arrow: endpoint dots on the world projection
    if (!it || it.kind !== "shape" || (it.type !== "arrow" && it.type !== "line")) return null;
    const frame = active().frame;
    const g = (it.type === "arrow" && (it.fromId || it.toId)) ? arrowGeometry(it, active().doc?.items || []) : it;
    const toScreen = (lx, ly) => boxToScreen(active(), { x: lx, y: ly }, raw); // the item's home layer → frame → screen, composed
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
    <div class={"ns-root " + cursorClass()} classList={{ "ns-wiring": tool() === "wire", "ns-frosted": frosting() }} ref={viewportRef} onPointerDown={onPointerDown} onPointerMove={trackCursor} onDblClick={onCanvasDblClick} onWheel={onWheel} onDragOver={onDragOver} onDrop={onDrop}>
      {/* BASE layer (the camera coordinate space). An item renders in its HOME layer's
          space only (one DOM node, never twice) — the byHome buckets are id-sorted, the
          old sortById(filter) order. Extra memberships affect VISIBILITY, not placement. */}
      <div class="ns-world" ref={(el) => enableAtomicMove(el)} style={{ transform: worldTransform() }}>
        <For each={itemsIdx().byHome.get(baseLayer()?.id) || []}>{(it) => <Item it={it} surface={rootSurface()} ctx={ctx} depth={0} />}</For>
      </div>
      {/* while a pan is in flight this captures the wheel (over iframes too) so
          the pan keeps going; idle → pointer-events:none, tools interactive */}
      <div class="ns-panlock" style={{ "pointer-events": panActive() ? "auto" : "none" }} />

      {/* first-paint loader — a perfect-freehand SWIRL spinning in the centre */}
      <Show when={booting()}>
        <div class="ns-booting">
          <svg class="ns-shoot" viewBox="0 0 80 80" width="84" height="84">
            <path d={swirlPath} fill="currentColor" />
          </svg>
        </div>
      </Show>

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
          {/* placement ghost — the picked editor/lens/doc follows the cursor until you click */}
          <Show when={placeGhost() && tool() === "place" && placing() && !draft()}>
            {(g) => {
              const lens = placing()?.what === "lens";
              const w = lens ? 220 : 360, h = lens ? 96 : 280;
              return (<g opacity="0.55">
                <rect class="ns-place" x={g().x} y={g().y} width={w} height={h} />
                <text class="ns-guide-badge" x={g().x + 8} y={g().y + 18}>{placing()?.descriptor?.name || placing()?.descriptor?.id || ""}</text>
              </g>);
            }}
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

      {/* persistent wires — only the ACTIVE layer's (a wire lives in the coordinate space of
          its node's layer). On the base canvas the svg sits behind the nodes (z5); on the
          overlay it lifts above the frost (z24) so overlay wires read on the glass. */}
      <Show when={visibleWires().length}>
        <svg class="ns-wires" style={{ position: "absolute", inset: "0", width: "100%", height: "100%", "pointer-events": "none", overflow: "visible", "z-index": frosting() ? "24" : "5" }}>
          <For each={visibleWires()}>
            {(spec) => {
              // geometry is a per-row memo → updates the transform/d ATTRS on
              // pan/zoom/move, never rebuilds these DOM nodes. rough paths are
              // cached + pan-invariant (drawn relative to `from`, positioned by translate).
              const g = createMemo(() => geomFor(spec));
              const seed = seedFromId(spec.key); // per-row constant, computed once
              // README.md Phase 6 — dx/dy as MEMOS (numbers, equality-cut) instead of
              // accessors re-run at every read site: a pure pan moves from+to together
              // so dx/dy hold and only the <g> translate updates; the rough-link paths
              // memo below then rebuilds only when the span actually changes (and
              // draw.js's roughLink cache still absorbs repeat spans).
              const dx = createMemo(() => { const v = g(); return v ? v.to.x - v.from.x : 0; });
              const dy = createMemo(() => { const v = g(); return v ? v.to.y - v.from.y : 0; });
              const link = createMemo(() => roughLink(dx(), dy(), seed));
              return (
                <Show when={g()}>
                  <g style={{ color: wireErrors[spec.key] ? "#e5484d" : selectedWire()?.key === spec.key ? "var(--ns-sky, #5b8def)" : "#ff2284" }} transform={`translate(${g().from.x} ${g().from.y})`}>
                    <Show when={wireErrors[spec.key]}><title>{"⚠ " + wireErrors[spec.key]}</title></Show>
                    <For each={link()}>{(p) => <path d={p.d} fill="none" stroke="currentColor" stroke-width={selectedWire()?.key === spec.key ? p.strokeWidth + 1.5 : p.strokeWidth} opacity={selectedWire()?.key === spec.key ? 1 : 0.7} stroke-linecap="round" />}</For>
                    {/* PULSE: a fresh keyed dot per value-flow tick → its animateMotion replays once */}
                    <For each={wirePulse[spec.key] ? [wirePulse[spec.key]] : []}>{() => {
                      const d = untrack(() => `M0 0 C ${dx() / 2} 0 ${dx() / 2} ${dy()} ${dx()} ${dy()}`); // frozen at flow time (no pan-replay)
                      return (
                        <circle r="4.5" fill="currentColor" opacity="0">
                          <animateMotion dur="0.45s" begin="0s" path={d} />
                          <animate attributeName="opacity" values="0;1;1;0" dur="0.45s" begin="0s" />
                        </circle>
                      );
                    }}</For>
                    {/* click to SELECT (like any item); Backspace/Delete removes it.
                        stop the POINTERDOWN (never the click — Solid delegates clicks to
                        document) so the canvas marquee doesn't also start/clear selection */}
                    <path d={`M0 0 C ${dx() / 2} 0 ${dx() / 2} ${dy()} ${dx()} ${dy()}`} fill="none" stroke="transparent" stroke-width="12" style={{ "pointer-events": "stroke", cursor: "pointer" }} onPointerDown={(e) => e.stopPropagation()} onClick={() => { setSelected([]); setSelectedWire(spec); }}><title>click to select · ⌫ to delete</title></path>
                    <circle cx="0" cy="0" r="3.5" fill="currentColor" />
                    <circle cx={dx()} cy={dy()} r="3.5" fill="currentColor" />
                    {/* DEBUG: the actual op JSON, flashed on the wire as each op flows (` to toggle).
                        Keyed by the flow tick so a fresh label re-triggers its fade per op. */}
                    <Show when={debug() && wireOps[spec.key]}>
                      <For each={[wireOps[spec.key].n]}>{() => (
                        <g transform={`translate(${dx() / 2} ${dy() / 2})`} style={{ "pointer-events": "none" }}>
                          <rect x="6" y="-9" width={Math.min(8.2 * wireOps[spec.key].text.length + 8, 360)} height="16" rx="3" fill="#1a1a1a" opacity="0">
                            <animate attributeName="opacity" values="0;0.9;0.9;0" dur="1.6s" begin="0s" fill="freeze" />
                          </rect>
                          <text x="10" y="2" fill="#7CFFB2" style={{ font: "10px ui-monospace, monospace" }} opacity="0">{wireOps[spec.key].text}
                            <animate attributeName="opacity" values="0;1;1;0" dur="1.6s" begin="0s" fill="freeze" />
                          </text>
                        </g>
                      )}</For>
                    </Show>
                    {/* MIDPOINT MARKER = FLOW DIRECTION. both → diamond; fwd/back → a
                        chevron pointing that way. On a bidi wire it's clickable (when the
                        wire is selected) to cycle both → fwd → back. read-only ⇒ fwd chevron. */}
                    {(() => {
                      const effDir = () => (spec.bidi ? spec.dir || "both" : "fwd");
                      const ang = () => Math.atan2(2 * dy(), dx()) * 180 / Math.PI;
                      const hot = () => spec.bidi && selectedWire()?.key === spec.key; // clickable to cycle
                      return (
                        <g transform={`translate(${dx() / 2} ${dy() / 2})`} style={{ cursor: hot() ? "pointer" : "default", "pointer-events": hot() ? "auto" : "none" }}
                           onPointerDown={(e) => { if (hot()) e.stopPropagation(); }}
                           onClick={() => { if (hot()) cycleWireDir(spec); }}>
                          <Show when={effDir() === "both"} fallback={
                            <g transform={`rotate(${effDir() === "back" ? ang() + 180 : ang()})`}>
                              <For each={roughChevron(seed)}>{(p) => <path d={p.d} fill="none" stroke="currentColor" stroke-width={p.strokeWidth} stroke-linecap="round" stroke-linejoin="round" />}</For>
                            </g>
                          }>
                            <rect x="-5.5" y="-5.5" width="11" height="11" rx="1.5" fill="currentColor" transform="rotate(45)" />
                          </Show>
                          <Show when={hot()}><title>{`flow: ${effDir()} — click to change`}</title></Show>
                        </g>
                      );
                    })()}
                  </g>
                </Show>
              );
            }}
          </For>
        </svg>
      </Show>

      {/* FROSTED GLASS: while editing a frosting layer (the overlay), a backdrop-blurred
          tinted pane sits over the base layer + wires, so the active layer reads as glass
          floating above. Below the active layer, above everything else. */}
      <Show when={frosting()}>
        <div class="ns-frost" />
      </Show>

      {/* NON-BASE layers — viewport-pinned (or whatever their transform says) coordinate
          spaces, rendered above the frost. The active one is interactive + casts a themed
          shadow; inactive ones still show their widgets. Generic over the layer stack. */}
      <For each={layersList().filter((l) => l.id !== baseLayer()?.id)}>
        {(layer) => (
          <div class="ns-layer" classList={{ "ns-layer-active": activeLayerId() === layer.id }} style={{ transform: txFor(layer).transform() }}>
            <For each={itemsIdx().byHome.get(layer.id) || []}>{(it) => <Item it={it} surface={rootSurface()} ctx={ctx} depth={0} />}</For>
          </div>
        )}
      </For>

      {/* the LAYER SWITCHER is no longer fixed chrome — it's the seeded `layers`
          bare window ("ns-layers", layers-node.js): overlay-home with a canvas
          membership (you need it everywhere to switch), movable + dismissable
          like any seed. It reads/writes context.layers / context.activeLayer. */}

      {/* the canvas-level context inputs (camera/pointer/tool/brush/selection) are no
          longer bottom chips — they're placeable source NODES (each with the 👤 own ⟷
          📡 mine toggle), added from the palette. (The "inspect" top-edge port strip
          was removed 2026-07-02 with its tray eyeball.) */}

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

      {/* wire-tool double-click: a searchable palette to add a source/transform/sink.
          WORLD-anchored (worldToScreen) so it pans with the canvas once open. */}
      <Show when={nodeMenu()}>{(m) => (
        <NodeAddMenu screen={() => worldToScreen(m().world.x, m().world.y)} items={[...catalogWindows(), ...catalogLenses()]} onPick={(d) => { placeNode(d, m().world); setNodeMenu(null); }} onClose={() => setNodeMenu(null)} />
      )}</Show>

      {/* click a port (no drag) → its FULL schema, world-anchored so it pans with you */}
      <Show when={portInfo()}>{(p) => (
        <div class="ns-chooser-backdrop" onPointerDown={() => setPortInfo(null)}>
          <div class="ns-portinfo" style={{ left: `${worldToScreen(p().world.x, p().world.y).x}px`, top: `${worldToScreen(p().world.x, p().world.y).y}px` }} onPointerDown={(e) => e.stopPropagation()}>
            <div class="ns-portinfo-title">{p().title}</div>
            <For each={p().lines}>{(l) => <div class="ns-portinfo-line">{l}</div>}</For>
          </div>
        </div>
      )}</Show>

      {/* pick which editor to place when a dropped wire matches several (world-anchored).
          Reuses the SEARCHABLE node palette so you can filter the candidates. */}
      <Show when={editorChooser()}>{(c) => (
        <NodeAddMenu screen={() => worldToScreen(c().world.x, c().world.y)} items={c().candidates} onPick={(d) => { c().place(d); setEditorChooser(null); }} onClose={() => setEditorChooser(null)} />
      )}</Show>

      {/* op-debug indicator — ops are the heart of the system; this shows it's watching them */}
      <Show when={debug()}>
        <div class="ns-debug-badge" onPointerDown={(e) => e.stopPropagation()} onClick={() => setDebug(false)} title="op debug on — click or ` to turn off">● ops</div>
      </Show>

      {/* the wire being dragged (screen-space, like the segment handles). Stacked
          like the persistent wires: while a frosting layer (the overlay) is
          active it lifts above the frost (z24) — without this the draft drew at
          z-auto UNDER the glass, reading as if it were on the base canvas layer. */}
      <Show when={wireDraft()}>{(w) => (
        <svg class="ns-wire-overlay" style={{ position: "absolute", inset: "0", width: "100%", height: "100%", "pointer-events": "none", overflow: "visible", "z-index": frosting() ? "24" : "5" }}>
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

      {/* CHROME — every part is composable: a wrapping patchwork:tool passes `opts` to
          turn parts off (this is how the headless component is built on — see tool.jsx).
          presence/properties each gate on opts.<part> !== false. */}
      {/* presence chrome = the CURSOR/VIEW layer only (it draws in world space, so it
          stays canvas-level). The bar/controls — the user button, the views toggle,
          follow — are the seeded `presence` bare window now ("ns-presence" —
          presence-node.js); the fixed .ns-views eyeball went with them. */}
      <Show when={chromePart("presence")}>
        <Show when={slot("presence")} fallback={<PresenceLayer host={chromeHost} />}>{slot("presence")(chromeHost)}</Show>
      </Show>
      {/* the minimap is no longer hardcoded chrome — it's a BARE `minimap` tool seeded on
          the overlay layer (minimap-node.js), fed by the canvas outlets. Add/move/remove it
          like any item. */}

      {/* the TOOLBAR is no longer fixed chrome — it's the seeded `palette` bare
          window ("ns-toolbar-palette"): overlay-home with a canvas membership, so
          it's arrangeable on the overlay and usable while drawing. Keyboard tool
          shortcuts live in onKeyDown above, independent of any toolbar DOM.
          (The old flap-registry chrome went with it.) */}

      <Show when={showProps()}>
        {slot("properties") ? slot("properties")(chromeHost) : <Properties host={chromeHost} />}
      </Show>

      {/* zoom is now a bare `zoom` tool seeded on the overlay (zoom-node.js) */}

      {/* the STICKY dock hint — a soft glow on the viewport edge a dragged window
          is within snap range of (drop there to dock it) */}
      <Show when={stickyHint()}>
        <div class={"ns-sticky-hint ns-sticky-hint-" + stickyHint()} />
      </Show>
    </div>
  );
}


// The wire-tool double-click palette: a searchable list of surfaces + lenses to
// drop a node at the cursor, marked by role (source/transform/sink/lens).
function NodeAddMenu(props) {
  const [q, setQ] = createSignal("");
  const MARK = { source: "●", lens: "◇", sink: "▣", editor: "⚡" };
  const filtered = createMemo(() => {
    const s = q().trim().toLowerCase();
    return (props.items || []).filter((d) => !s || (d.name || d.id || "").toLowerCase().includes(s) || (d.id || "").toLowerCase().includes(s));
  });
  return (
    <div class="ns-chooser-backdrop" onPointerDown={() => props.onClose()}>
      <div class="ns-chooser ns-node-menu" style={{ left: `${props.screen().x}px`, top: `${props.screen().y}px` }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <input class="ns-text ns-menu-search" autofocus placeholder="add a node…" value={q()}
          onInput={(e) => setQ(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { const f = filtered(); if (f[0]) props.onPick(f[0]); } else if (e.key === "Escape") props.onClose(); }} />
        <div class="ns-node-menu-list">
          <For each={filtered()}>{(d) => <button class="ns-chooser-item" onClick={() => props.onPick(d)}>{MARK[nodeRole(d)] || "•"} {d.name || d.id}</button>}</For>
        </div>
      </div>
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
    windowDrag(m); // settles on pointerup AND pointercancel
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
