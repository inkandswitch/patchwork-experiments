// Item — the per-item renderer + kind dispatch — and DocOrFrame (the embedded
// patchwork-view / box). Mutually recursive (a box renders child Items), so they
// live together. Extracted from tool.jsx; prop-driven via `ctx`.
import { createSignal, createMemo, createEffect, createResource, onCleanup, Show, For, Suspense } from "solid-js";
import { makeDocumentProjection } from "solid-automerge";
import { surfaceDoc } from "../../surface-doc.js";
import { getType } from "@inkandswitch/patchwork-filesystem";
import { isBoxType, rad, rot, itemBounds, arrowGeometry } from "../../model.js";
import { roughRectPath, seedFromId, freehandPath, shapePaths } from "../../draw.js";
import { shapeRenderProps, colorVar, fontFamily, sortById, enableAtomicMove } from "../constants.js";
import { InlineEdit, TextEdit } from "./text-edit.jsx";
import { VoiceItem } from "./voice-item.jsx";
import { SketchItem } from "./sketch-item.jsx";
import { EditorItem } from "./editor-item.jsx";

export function Item(props) {
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
  const baseStyle = () => {
    const clip = dropClip();
    return { left: `${b().x}px`, top: `${b().y}px`, width: `${b().w}px`, height: `${b().h}px`, transform: `rotate(${it().rotation || 0}deg)`, "transform-origin": "center", "z-index": clip ? 8000 : z() + 1, ...(clip ? { "clip-path": clip } : {}) };
  };
  const down = (e) => ctx.onItemDown(it(), props.surface, e);
  const edit = () => { if (selectMode()) ctx.setEditingId(it().id); };
  // double-click descends into a group first; only once you're inside does it
  // reach the item's own action (text edit)
  const onDbl = (e) => { e?.stopPropagation?.(); if (selectMode() && ctx.enterGroup(it())) return; edit(); };

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
    <Show when={it().kind === "editor"} fallback={
    <Show when={it().kind === "voice"} fallback={
    <Show when={it().kind === "sketch"} fallback={
    <Show when={it().kind === "doc" || it().kind === "frame"} fallback={
      <Show when={it().kind === "text"} fallback={
        // ---- shape / stroke ----
        <div class="ns-mark" style={baseStyle()}>
          <svg class="ns-mark-svg" style={{ overflow: "visible" }}>
            <g transform={`translate(${-b().x}, ${-b().y})`}>
              <Show when={it().kind === "stroke"} fallback={
                <For each={(ctx.themeTick(), shapePaths(shapeRenderProps(renderIt(), ctx.resolveColor)))}>
                  {(p) => <path d={p.d} stroke={p.stroke} fill={p.fill} stroke-width={p.strokeWidth} stroke-dasharray={p.dash} stroke-linecap="round" stroke-linejoin="round" fill-rule="nonzero" />}
                </For>
              }>
                <path d={freehandPath(it().points, it().size, it())} style={{ fill: colorVar(it().color), opacity: it().opacity, "mix-blend-mode": it().blend }} />
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
        <div class="ns-text-item" style={baseStyle()}>
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
    // live in select mode OR while wiring (so you can grab a PORT inside an embed)
    return props.selectMode() || ctx.tool() === "wire" ? "auto" : "none";
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
              {/* list style: render the box's doc with the folder viewer */}
              <Show when={ctx.embedsReady()} fallback={<div class="ns-doc-pending" />}>
                <patchwork-view doc-url={it().url} tool-id="folder-viewer" style="display:block;width:100%;height:100%" />
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
  );
}


