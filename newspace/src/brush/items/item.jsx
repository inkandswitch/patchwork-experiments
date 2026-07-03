// Item — the per-item renderer + kind dispatch — and DocOrFrame (the embedded
// patchwork-view / box). Mutually recursive (a box renders child Items), so they
// live together. Extracted from tool.jsx; prop-driven via `ctx`.
import { createSignal, createMemo, createEffect, createResource, onCleanup, untrack, Show, For, Suspense } from "solid-js";
import { makeDocumentProjection } from "solid-automerge";
import { surfaceDoc } from "../../surface-doc.js";
import { getType } from "@inkandswitch/patchwork-filesystem";
import { isBoxType, rad, rot, itemBounds, arrowGeometry, linksNeedingItems, linkItemId, duplicateItemIds, ownsSpace, projectItemFromBox, findById } from "../../model.js";
import { roughRectPath, seedFromId, freehandPath, shapePaths, strokeWorldPoints } from "../../draw.js";
import { shapeRenderProps, colorVar, fontFamily, sortById, enableAtomicMove } from "../constants.js";
import { isStuck } from "../../sticky.js";
import { count as perfCount, rafBatch } from "../../perf.js";
import { InlineEdit, TextEdit } from "./text-edit.jsx";
import { VoiceItem } from "./voice-item.jsx";
import { SketchItem } from "./sketch-item.jsx";
import { EditorItem } from "./editor-item.jsx";
import { ASIDE_ID } from "../constants.js";

export function Item(props) {
  const it = () => props.it;
  const ctx = props.ctx;
  // a PARENTED mark (stroke/shape with `parent: <spatial box id>`) stores BOX-LOCAL coords
  // (lat/lng for a map, frame-local px for a frame — see model.js). It renders through this
  // same rough.js/perfect-freehand pipeline, projected to world via the parent box's
  // transform — so selection, undo, z-order, properties all apply with zero special cases.
  const parentBox = createMemo(() => {
    const i = it();
    if (!i.parent || (i.kind !== "stroke" && i.kind !== "shape")) return null;
    // ctx.indexById is per-tick (rebuilt with each memo recompute), used only for root items
    const p = findById(props.surface.doc?.items || [], i.parent, props.surface.id === "root" ? ctx.indexById() : null);
    return p && ownsSpace(p) ? p : null; // parent gone/unspatial → render coords as-is
  });
  // a bound arrow's geometry is DERIVED from the shapes it connects (so it
  // follows them); everything else renders from its own stored coords
  const renderIt = createMemo(() => {
    const i = it();
    const pb = parentBox();
    if (pb) {
      if (ctx.spaceEpoch) ctx.spaceEpoch(); // re-project when the parent's projection moves (map pan/zoom)
      return projectItemFromBox(i, pb);
    }
    if (i.kind === "shape" && i.type === "arrow" && (i.fromId || i.toId)) return { ...i, ...arrowGeometry(i, props.surface.doc?.items || []) };
    return i;
  });
  const b = createMemo(() => ctx.itemBounds(renderIt()));
  // README.md Phase 5: resolve colours + rough.js paths once per shape/theme change
  // instead of per reactive flush. Deps: renderIt() (carries the spaceEpoch /
  // parent-projection tracking, so parented marks keep re-projecting on map
  // pan/zoom) + themeTick (canvas.jsx clears its colour cache on the same bump).
  const renderPaths = createMemo(() => {
    const i = renderIt();
    if (i.kind !== "shape") return [];
    ctx.themeTick();
    perfCount("shapePaths"); // README.md Phase 5: an ACTUAL per-shape path rebuild
    return shapePaths(shapeRenderProps(i, ctx.resolveColor));
  });
  // stacking comes from the item's position in its surface's array (not DOM order);
  // root items read it O(1) off the shared index, child surfaces stay linear
  const z = createMemo(() => (props.surface.id === "root" ? ctx.indexById().get(it().id) ?? -1 : (props.surface.doc?.items || []).findIndex((x) => x.id === it().id)));
  // the wire tool is a pointer++ — items are selectable/movable/editable in it too
  const selectMode = () => ctx.tool() === "select" || ctx.tool() === "wire";
  const hittable = () => selectMode() || ctx.tool() === "eraser";
  const editing = () => ctx.editingId() === it().id;
  // while dragging this item INTO a box, preview the drop: clip it to the box's
  // bounds (only the part that'll end up inside shows) and lift it on top
  const dropClip = () => {
    if (props.surface.frame || !ctx.isSelected(it().id)) return null; // root items only (box-local coords don't match)
    const box = ctx.dropTarget() && ctx.boxBounds(ctx.dropTarget());
    if (!box) return null;
    // clip the (possibly ROTATED) item to the box: express the box's corners in
    // the item's own local space (clip-path is applied pre-transform), so the
    // clip rotates with the shape
    const a = b();
    const r = -rad(it().rotation || 0), wcx = a.x + a.w / 2, wcy = a.y + a.h / 2;
    const corners = [[box.x, box.y], [box.x + box.w, box.y], [box.x + box.w, box.y + box.h], [box.x, box.y + box.h]];
    const local = corners.map(([wx, wy]) => { const [rx, ry] = rot(wx - wcx, wy - wcy, r); return `${rx + a.w / 2}px ${ry + a.h / 2}px`; });
    return `polygon(${local.join(", ")})`;
  };
  // a parented mark CLIPS to its box (like frame children clip): the parent's (possibly
  // rotated) world rect expressed in the item's own local space (clip-path is pre-transform)
  const parentClip = () => {
    const pb = parentBox();
    if (!pb) return null;
    const a = b();
    const r = -rad(renderIt().rotation || 0), wcx = a.x + a.w / 2, wcy = a.y + a.h / 2;
    const pr = rad(pb.rotation || 0), pcx = pb.x + (pb.w || 0) / 2, pcy = pb.y + (pb.h || 0) / 2;
    const corners = [[pb.x, pb.y], [pb.x + pb.w, pb.y], [pb.x + pb.w, pb.y + pb.h], [pb.x, pb.y + pb.h]]
      .map(([x, y]) => { const [rx, ry] = rot(x - pcx, y - pcy, pr); return [pcx + rx, pcy + ry]; });
    const local = corners.map(([wx, wy]) => { const [rx, ry] = rot(wx - wcx, wy - wcy, r); return `${rx + a.w / 2}px ${ry + a.h / 2}px`; });
    return `polygon(${local.join(", ")})`;
  };
  // MEMBERSHIP-DRIVEN VISIBILITY (root items; model.js itemVisibleForActive via
  // ctx.itemHidden): hidden = display:none — the DOM node stays (embeds survive)
  // and nothing display:none can be hit-tested or clicked. A parented mark
  // follows its PARENT's visibility (it lives in the parent's space).
  const hidden = () => !!(ctx.itemHidden && props.surface.id === "root" && ctx.itemHidden(parentBox() || it()));
  // a MEMBER of the active layer whose home container is inert opts back into
  // pointer events — membership means "appears AND is usable on this layer"
  const memberActive = () => !!(ctx.memberOnActive && props.surface.id === "root" && ctx.memberOnActive(it()));
  const baseStyle = () => {
    const clip = dropClip() || parentClip();
    const vis = hidden() ? { display: "none" } : memberActive() ? { "pointer-events": "auto" } : {};
    // a STUCK window (sticky, or a legacy corner anchor read as sticky) positions
    // from ctx.stickyPlace: the resolved screen spot converted into its HOME
    // layer's coords, with a counter-scale so a camera-home window holds its
    // screen size while docked. (Viewport resizes re-run it via vpTick.)
    if (isStuck(it()) && ctx.stickyPlace && props.surface.id === "root") {
      const st = ctx.stickyPlace(it());
      return { left: `${st.x}px`, top: `${st.y}px`, width: `${b().w}px`, height: `${b().h}px`, transform: `scale(${st.k}) rotate(${renderIt().rotation || 0}deg)`, "transform-origin": "0 0", "z-index": z() + 1, ...vis, ...(clip ? { "clip-path": clip } : {}) };
    }
    return { left: `${b().x}px`, top: `${b().y}px`, width: `${b().w}px`, height: `${b().h}px`, transform: `rotate(${renderIt().rotation || 0}deg)`, "transform-origin": "center", "z-index": dropClip() ? 8000 : z() + 1, ...vis, ...(clip ? { "clip-path": clip } : {}) };
  };
  const down = (e) => ctx.onItemDown(it(), props.surface, e);
  const edit = () => { if (selectMode()) ctx.setEditingId(it().id); };
  // double-click descends into a group first; only once you're inside does it
  // reach the item's own action (text edit)
  const onDbl = (e) => { e?.stopPropagation?.(); if (selectMode() && ctx.enterGroup(it())) return; edit(); };

  // keep a text item's stored w/h in sync with the actually-rendered text, so
  // the selection box always fits (size changes from the panel re-measure too).
  // The element sizes ITSELF — the stored w/h only feed the selection box — so
  // the persist is deferred a frame (rafBatch, latest wins): it lands OUTSIDE
  // any synchronous transact/gesture-txn window and creates no undo entry.
  // The measure tracks only text/font/fontSize/wrap — NOT w/h — so an undo
  // that restores a size can't re-trigger the measurer into fighting it.
  // README.md Phase 10 (plan-2 §9).
  let staticEl;
  const persistSize = rafBatch();
  onCleanup(() => persistSize.flush());
  createEffect(() => {
    const item = it();
    if (item.kind !== "text" || editing() || !staticEl) return;
    void [item.text, item.font, item.fontSize, item.wrap]; // the re-measure deps
    const id = item.id, wrap = !!item.wrap;
    // a wrapped text box keeps its (fixed) width, only its height grows
    const w = wrap ? 0 : Math.max(8, staticEl.offsetWidth);
    const h = Math.max(1, staticEl.offsetHeight);
    untrack(() => {
      if ((!wrap && Math.abs((item.w || 0) - w) > 1) || Math.abs((item.h || 0) - h) > 1)
        persistSize.schedule(() => props.surface.handle.change((d) => { const o = d.items.find((x) => x.id === id); if (o && o.kind === "text") { if (!wrap) o.w = w; o.h = h; } }));
    });
  });

  return (
    <Show when={it().kind === "editor"} fallback={
    <Show when={it().kind === "voice"} fallback={
    <Show when={it().kind === "sketch"} fallback={
    <Show when={it().kind === "doc" || it().kind === "frame"} fallback={
      <Show when={it().kind === "text"} fallback={
        // ---- shape / stroke ----
        <div class="ns-mark" data-item-id={it().id} style={baseStyle()}>
          <svg class="ns-mark-svg" style={{ overflow: "visible" }}>
            <g transform={`translate(${-b().x}, ${-b().y})`}>
              <Show when={it().kind === "stroke"} fallback={
                <For each={renderPaths()}>
                  {(p) => <path d={p.d} stroke={p.stroke} fill={p.fill} stroke-width={p.strokeWidth} stroke-dasharray={p.dash} stroke-linecap="round" stroke-linejoin="round" fill-rule="nonzero" />}
                </For>
              }>
                <path d={freehandPath(strokeWorldPoints(renderIt()), it().size, it())} style={{ fill: colorVar(it().color), opacity: it().opacity, "mix-blend-mode": it().blend }} />
              </Show>
            </g>
            </svg>
          <Show when={it().kind === "shape"}>
            <Show when={editing()} fallback={
              <Show when={it().text}>
                <div class="ns-shape-text" style={{ color: "var(--ns-ink)", "font-size": `${it().fontSize || 28}px` }}>{it().text}</div>
              </Show>
            }>
              <InlineEdit id={it().id} surface={props.surface} text={it().text || ""} cls="ns-shape-edit" style={{ "font-size": `${it().fontSize || 28}px` }} done={() => ctx.setEditingId(null)} />
            </Show>
          </Show>
          {/* SHAPE OUTLETS — a drawn shape's geometry as wireable opstreams (x/y/w/h),
              grabbable in wire mode. Writable, so a stream can also DRIVE the shape. */}
          <Show when={ctx.tool() === "wire"}>
            <div class="ns-node-outlets">
              <div class="ns-node-port ns-node-outlet bidi" data-sketchy-node={it().id} data-sketchy-outlet="props" data-tip="props : json (read/write)" />
            </div>
          </Show>
          <Show when={hittable() && !editing()}>
            <Show when={it().kind === "shape" && (it().type === "line" || it().type === "arrow")} fallback={
              <div class="ns-hit" onPointerDown={down} onDblClick={() => { if (selectMode() && ctx.enterGroup(it())) return; if (it().kind === "shape") edit(); }} />
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
        <div class="ns-text-item" data-item-id={it().id} style={baseStyle()}>
          <Show when={editing()} fallback={
            <div class="ns-text-static" classList={{ "ns-text-wrap": !!it().wrap }} ref={staticEl} style={{ color: colorVar(it().color), "font-family": fontFamily(it().font), "font-size": `${it().fontSize || 20}px`, ...(it().wrap ? { width: `${it().w}px` } : {}) }} onPointerDown={(e) => hittable() && down(e)} onDblClick={onDbl}>
              {it().text || ""}
            </div>
          }>
            <TextEdit id={it().id} surface={props.surface} text={it().text || ""} wrap={!!it().wrap} style={{ color: colorVar(it().color), "font-family": fontFamily(it().font), "font-size": `${it().fontSize || 20}px`, ...(it().wrap ? { width: `${it().w}px` } : {}) }} done={() => { ctx.setEditingId(null); if (!(it().text || "").trim()) ctx.removeItem(it().id); }} />
          </Show>
        </div>
      </Show>
    }>
      <DocOrFrame it={it} b={b} ctx={ctx} surface={props.surface} depth={props.depth || 0} baseStyle={baseStyle} selectMode={selectMode} />
    </Show>
    }>
      <SketchItem it={it} b={b} ctx={ctx} surface={props.surface} baseStyle={baseStyle} down={down} />
    </Show>
    }>
      <VoiceItem it={it} ctx={ctx} surface={props.surface} baseStyle={baseStyle} down={down} />
    </Show>
    }>
      <EditorItem it={it} ctx={ctx} surface={props.surface} baseStyle={baseStyle} down={down} />
    </Show>
  );
}


export function DocOrFrame(props) {
  const it = props.it;
  const b = props.b;
  const ctx = props.ctx;
  const isFrame = () => it().kind === "frame";
  const seed = createMemo(() => seedFromId(it().id));
  const outline = createMemo(() => roughRectPath(b().w, b().h, seed()));

  // ── FLAP — a `flap: true` frame (a named sticky container). While STUCK it
  // renders as a compact edge TAB (its name, vertical on left/right edges);
  // clicking the tab opens the drawer — the ordinary sticky frame render —
  // and clicking it again (or Escape / a canvas click, canvas.jsx) collapses.
  // Open state is per-VIEWER (ctx.flapOpen — the top-layer doc). Root items
  // only: sticky itself only applies at root (baseStyle).
  const isFlap = () => isFrame() && !!it().flap;
  const stuckFlap = () => isFlap() && !!it().sticky && props.surface.id === "root" && !!ctx.flapOpen;
  const flapIsOpen = () => stuckFlap() && ctx.flapOpen(it().id);
  const collapsed = () => stuckFlap() && !flapIsOpen();
  const tabEdge = () => (it().sticky && it().sticky.edge) || "left";
  const toggleFlap = () => ctx.setFlapOpen && ctx.setFlapOpen(it().id, !ctx.flapOpen(it().id));
  const tabStyle = () => {
    const t = ctx.flapTabPlace(it());
    const hidden = ctx.itemHidden && props.surface.id === "root" && ctx.itemHidden(it());
    const activeMember = ctx.memberOnActive && props.surface.id === "root" && ctx.memberOnActive(it());
    return { left: `${t.x}px`, top: `${t.y}px`, width: `${t.w}px`, height: `${t.h}px`, transform: `scale(${t.k})`, "transform-origin": "0 0", "z-index": 500, ...(activeMember ? { "pointer-events": "auto" } : {}), ...(hidden ? { display: "none" } : {}) };
  };

  const isWell = () => isFrame() && !!it().well;
  const isList = () => isFrame() && it().style === "list";
  // render box CONTENTS only ~2 levels deep; deeper boxes are just named (and
  // we don't load their surface, which also stops any cyclic nesting)
  const tooDeep = () => (props.depth || 0) >= 2;
  // the folder link for this item lives in ITS surface's folder doc
  const link = () => props.surface.folderDoc?.docs.find((l) => l.url === it().url);

  // a box loads + manages a SEPARATE space (folder doc + its layout doc) as a surface
  const [space, setSpace] = createSignal(null);
  createEffect(() => { if (isFrame() && it().url && !tooDeep()) ctx.loadSpace(it().url).then((s) => s && setSpace(s)); });
  const childSurface = createMemo(() => {
    const s = space();
    if (!s) return null;
    return { id: it().url, handle: s.layoutHandle, doc: surfaceDoc(s.layoutHandle), folderHandle: s.folderHandle, folderDoc: makeDocumentProjection(s.folderHandle), frame: it() };
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
        const id = linkItemId(l.url); // deterministic (collab-safe, see root reconcile)
        if (isBoxType(l.type)) d.items.push({ id, kind: "frame", url: l.url, x: 24 + i * 26, y: 24 + i * 26, w: 300, h: 220 });
        else d.items.push({ id, kind: "doc", url: l.url, x: 24 + i * 26, y: 24 + i * 26, w: 300, h: 220, rotation: 0, toolId: "" });
        i++;
      }
    });
  });
  // de-dup the box's own layout too (same two-viewers race as the root)
  createEffect(() => {
    const s = childSurface(); if (!s) return;
    const dup = duplicateItemIds(s.doc.items || []);
    if (dup.length) s.handle.change((d) => { for (let k = dup.length - 1; k >= 0; k--) d.items.splice(dup[k], 1); });
  });

  // resolve the doc's REAL title via its datatype's getTitle (a box reads its
  // FOLDER doc; a plain doc loads itself), reactive to the doc's own changes. As a
  // RESOURCE so a <Suspense> on the body renders a fallback until the doc is in hand
  // (best-effort: the title shows, the embed swaps in when ready). Frames pass a
  // falsy source → the fetcher never runs (they use childSurface instead).
  const [docHandle] = createResource(() => (isFrame() ? false : it().url), (url) => ctx.loadDoc(url));
  const proj = createMemo(() => (isFrame() ? childSurface()?.folderDoc : (docHandle() ? makeDocumentProjection(docHandle()) : null)));
  // the datatype comes from the DOC's own @patchwork.type (the link's type can
  // be empty/stale), so getTitle uses the right datatype
  const [dt, setDt] = createSignal(null);
  createEffect(() => { const p = proj(); const t = (p && getType(p)) || link()?.type; if (t) ctx.loadDatatype(t).then(setDt); });
  const title = createMemo(() => {
    const p = proj(), d = dt();
    if (p && d) { const gt = d.getTitle || d.module?.getTitle; if (gt) { try { const t = gt(p); if (t) return t; } catch {} } }
    return p?.title || it().title || it().name || link()?.name || "Untitled";
  });
  const asideRows = () => (it().id === ASIDE_ID && ctx.asideItems ? ctx.asideItems() : []);
  const rowTitle = (row) => row.title || row.name || props.surface.folderDoc?.docs.find((l) => l.url === row.url)?.name || (row.url ? row.url.replace(/^automerge:/, "").slice(0, 8) : row.kind || "item");

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
    // live in select mode OR while wiring (so you can grab a PORT inside an embed)
    return props.selectMode() || ctx.tool() === "wire" ? "auto" : "none";
  };
  const openToolId = () => isFrame() ? (isList() ? "folder-viewer" : "sketchy") : it().toolId || undefined; // "sketchy" is the registered tool id ("newspace" never was)
  // no stopPropagation on click (breaks Solid's document-level delegation) — the
  // button's own pointerdown already stops the grab; the click just dispatches.
  const open = (e) => {
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
    <>
    <Show when={!collapsed()}>
    <div class="ns-doc" classList={{ "ns-frame": isFrame(), "ns-flap": isFlap(), "ns-flap-open": flapIsOpen(), well: isFrame() && !!it().well, sel: ctx.isSelected(it().id), "ns-drop-into": isFrame() && ctx.dropTarget() === it().id }} {...(it().theme ? { theme: it().theme } : {})} data-item-id={it().id} style={props.baseStyle()} onPointerDown={grab}>
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
      <div class="ns-doc-body" ref={(el) => { bodyRef = el; enableAtomicMove(el); }} classList={{ "ns-frame-body": isFrame() && !isList() }} style={{ "pointer-events": bodyPE() }} onFocusIn={() => ctx.deselect()}>
        <Show when={isFrame()} fallback={
          <Show when={link()?.type === "file"} fallback={
            // Suspense: render a placeholder until the doc handle resolves (reading the
            // resource is what suspends), then swap in the live embed best-effort.
            <Suspense fallback={<div class="ns-doc-pending">{title()}</div>}>
              <Show when={ctx.embedsReady() && docHandle()} fallback={<div class="ns-doc-pending">{title()}</div>}>
                {/* @ts-ignore custom element */}
                <patchwork-view doc-url={it().url} {...(it().toolId ? { "tool-id": it().toolId } : {})} style="display:block;width:100%;height:100%" />
              </Show>
            </Suspense>
          }>
            <img class="ns-doc-img" src={ctx.serviceUrl(it().url)} alt={title()} />
          </Show>
        }>
          <Show when={!tooDeep()} fallback={<div class="ns-box-stub">{title()}</div>}>
            <Show when={isList()} fallback={
            <Show when={childSurface()}>
                {/* the child whose centre has left this box renders in the
                    unclipped escape layer below (so only IT shows escaping, not
                    every overflowing item) */}
                <For each={sortById(childSurface().doc.items).filter((c) => c.id !== ctx.escapeId())}>{(child) => <Item it={child} surface={childSurface()} ctx={ctx} depth={(props.depth || 0) + 1} />}</For>
              </Show>
            }>
              <Show when={it().id === ASIDE_ID} fallback={
                <>
                  {/* list style: render the box's doc with the folder viewer */}
                  <Show when={ctx.embedsReady()} fallback={<div class="ns-doc-pending" />}>
                    <patchwork-view doc-url={it().url} tool-id="folder-viewer" style="display:block;width:100%;height:100%" />
                  </Show>
                </>
              }>
                <div class="ns-aside-list">
                  <For each={asideRows()}>{(row) => (
                    <div class="ns-aside-row" draggable="true" data-item-id={row.id}
                      onDragStart={(e) => ctx.startAsideDrag && ctx.startAsideDrag(row.id, e)}
                      onPointerDown={(e) => e.stopPropagation()}>
                      <span class="ns-aside-kind">{row.kind === "frame" ? "□" : "doc"}</span>
                      <span class="ns-aside-name">{rowTitle(row)}</span>
                    </div>
                  )}</For>
                  <Show when={!asideRows().length}><div class="ns-aside-empty">empty</div></Show>
                </div>
              </Show>
            </Show>
          </Show>
        </Show>
      </div>
      {/* escape layer: an unclipped sibling that renders ONLY the child currently
          leaving this box, at the same coords as the body — so it spills out
          while everything else stays clipped */}
      <Show when={isFrame() && !isList() && !tooDeep() && childSurface() && childSurface().doc.items.some((c) => c.id === ctx.escapeId())}>
        <div class="ns-doc-escape">
          <For each={childSurface().doc.items.filter((c) => c.id === ctx.escapeId())}>{(child) => <Item it={child} surface={childSurface()} ctx={ctx} depth={(props.depth || 0) + 1} />}</For>
        </div>
      </Show>
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
    </Show>
    {/* the flap's edge TAB — rendered whenever the flap is stuck: alone when
        collapsed, peeking out from under the drawer's edge when open (clicking
        it again collapses). pointerDOWN stopped (the house rule); the click
        toggles per-viewer open state. */}
    <Show when={stuckFlap()}>
      <div class="ns-flap-tab-box" classList={{ open: flapIsOpen() }} data-item-id={it().id} style={tabStyle()}>
        <button class={"ns-flap-tab ns-flap-tab-" + tabEdge()} title={flapIsOpen() ? `${title()} — close` : `${title()} — open`} onPointerDown={(e) => e.stopPropagation()} onClick={toggleFlap}>{title()}</button>
      </div>
    </Show>
    </>
  );
}
