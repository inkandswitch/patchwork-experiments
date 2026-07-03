// Sketchy canvas CHROME — selection handles, the bottom toolbar, the shape
// picker, the brush + properties panels. Extracted from tool.jsx. None of this is
// the headless canvas core: each part receives the chrome `host` and READS ITS
// STATE FROM `host.context` (the canvas's camera/pointer/tool/brush/selection
// Sources, as Solid accessors via opstreamToSignal); the host adds only the
// narrow command surface (setTool, doc mutations, the param target).
import { createSignal, createMemo, createEffect, onCleanup, For, Show } from "solid-js";
import { opstreamToSignal } from "../../opstreams.js";
import { seedFromId, roughEllipsePath, roughRectPath } from "../../draw.js";
import { rot } from "../../model.js";
import { getSupportedToolsForType } from "@inkandswitch/patchwork-plugins";
import { TOOL_META, SHAPE_DRAGGABLE, BRUSH_FALLBACK_PATH, STAMPS, STAMP_IDS, byName, splitWindowsByRole } from "../../catalog.js";
import {
  colorVar, fillVar, fontFamily, PALETTE, SIZES, ARROW_SIZES, FILL_STYLES,
  FILL_PREVIEW, STROKE_STYLES, CORNERS, ROUGHNESS_LEVELS, FONT_OPTIONS, FILL_BG,
  windowDrag,
} from "../constants.js";
// ---------------------------------------------------------------------------
export const HDIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
export const hCursor = (hx, hy) => (hx === 0 ? "ns-resize" : hy === 0 ? "ew-resize" : hx === hy ? "nwse-resize" : "nesw-resize");
export function Handles(props) {
  const box = () => props.box;
  return (
    <div class="ns-handles" style={{ left: `${box().x}px`, top: `${box().y}px`, width: `${box().w}px`, height: `${box().h}px`, transform: `rotate(${box().rot}deg)` }}>
      {/* FIT-CONTENT windows (box.fit — the palette) size themselves via setSize:
          manual resize handles would silently fight the next measure (stored w/h
          drift, then snap back), so they're suppressed. Rotation stays. */}
      <Show when={!box().fit}>
        <For each={HDIRS}>{([hx, hy]) => <div class="ns-handle" style={{ left: `${((hx + 1) / 2) * 100}%`, top: `${((hy + 1) / 2) * 100}%`, cursor: hCursor(hx, hy) }} onPointerDown={(e) => props.onResize(hx, hy, e)} />}</For>
      </Show>
      <div class="ns-rotate" title="drag to rotate · double-click to reset" onPointerDown={(e) => props.onRotate(e)} onDblClick={() => props.onResetRotate?.()} />
      <div class="ns-rotate-stem" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// the tool/stamp/shape tables live in the CATALOG (catalog.js — the one census
// of placeable things); re-exported here for the existing importers.
export { TOOL_META, SHAPE_DRAGGABLE, BRUSH_FALLBACK_PATH, STAMPS, STAMP_IDS };
// sample an SVG path into [x,y] points (a temp, offscreen <path> does the maths)
let _samplePath;
export function sampleSvgPath(d, step = 2.5) {
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
export function Icon(props) {
  return (<svg viewBox="0 0 22 22" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d={props.d} /></svg>);
}

// ---------------------------------------------------------------------------
// hand-drawn PORT NUBS — the wires are rough.js, so the nubs are too: a rough
// CIRCLE for a one-way port, a rough DIAMOND for a bidi one (the same circle/
// diamond semantics the old CSS shapes + the wire's midpoint marker use).
// Deterministic per item id + port name (nubSeed), so a nub doesn't reshuffle
// every render. VISUAL ONLY: the 12px host div in editor-item stays the hit
// area (pointer-events: auto); this svg is inert.
export const nubSeed = (itemId, port) => seedFromId((itemId || "") + ":" + (port || ""));
export function nubPaths(seed, bidi) {
  // circle: a 12px-diameter rough ellipse centred in an 18px canvas (translate(1 1));
  // diamond: a rough square rotated 45° about the canvas centre (see PortNub).
  return bidi ? roughRectPath(12.5, 12.5, seed) : roughEllipsePath(16, 16, seed);
}
export function PortNub(props) {
  const paths = createMemo(() => nubPaths(nubSeed(props.id, props.name), !!props.bidi));
  return (
    <svg class="ns-nub" viewBox="0 0 18 18" aria-hidden="true">
      <Show when={props.bidi} fallback={<circle class="ns-nub-fill" cx="9" cy="9" r="5" />}>
        <rect class="ns-nub-fill" x="4.8" y="4.8" width="8.4" height="8.4" transform="rotate(45 9 9)" />
      </Show>
      <g transform={props.bidi ? "rotate(45 9 9) translate(2.75 2.75)" : "translate(1 1)"}>
        <For each={paths()}>{(p) => <path class="ns-nub-line" d={p.d} fill="none" stroke-width="1.5" stroke-linecap="round" />}</For>
      </g>
    </svg>
  );
}
// one toolbar button; shape tools are draggable onto the canvas (drops a drawn one)
export function ToolBtn(props) {
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
export function Toolbar(outer) {
  // CHROME READS THE CONTEXT: the active tool comes from the context Source (not a
  // mirrored prop); the `host` carries only commands + registry accessors. (Back-compat:
  // flat props may still hand in a `tool` accessor directly.)
  const props = outer.host || outer;
  const tool = props.tool || opstreamToSignal(props.context.tool);
  // opts.tools (an explicit subset) restricts which tool buttons show; absent ⇒ all.
  const showTool = (id) => !props.tools || props.tools.includes(id);
  const armOverflow = (id) => { props.setExtraShape(id); props.setTool(id); props.setShapeMenuOpen(false); };
  const [docQuery, setDocQuery] = createSignal("");
  createEffect(() => { if (!props.addOpen()) setDocQuery(""); });
  // ONE search filters everything in the add menu (no "New…" expander, no add-by-id —
  // those read as clutter). Each section is the filtered slice of its list.
  const q = () => docQuery().trim().toLowerCase();
  const match = (x) => { const s = q(); return !s || (x.name || x.id || "").toLowerCase().includes(s) || (x.id || "").toLowerCase().includes(s); };
  const docList = createMemo(() => props.datatypes().filter(match).sort(byName));
  // placeable nodes, split by role through the CATALOG's one grouping (the same
  // split the parts bin's census renders)
  const split = createMemo(() => splitWindowsByRole(props.editors ? props.editors() : []));
  const sources = createMemo(() => split().sources.filter(match));
  const editors = createMemo(() => split().editors.filter(match));
  const lenses = createMemo(() => (props.lenses ? props.lenses() : []).filter(match));
  return (
    <div class="ns-toolbar" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {/* nav + draw (eraser sits beside the pencil); each drags out as a drawing.
          In `minimal` mode (the sketchpad tool) only the pencil shows. */}
      <Show when={!props.minimal && showTool("select")}><ToolBtn id="select" dragId="mouse" tool={tool} setTool={props.setTool} /></Show>
      <Show when={!props.minimal && showTool("hand")}><ToolBtn id="hand" dragId="hand" tool={tool} setTool={props.setTool} /></Show>
      <Show when={showTool("pen")}><ToolBtn id="pen" dragId="pencil" tool={tool} setTool={props.setTool} /></Show>
      <Show when={!props.minimal}>
      <Show when={showTool("eraser")}><ToolBtn id="eraser" tool={tool} setTool={props.setTool} /></Show>
      <Show when={showTool("wire")}><ToolBtn id="wire" tool={tool} setTool={props.setTool} /></Show>
      <div class="ns-sep" />
      {/* shapes: rectangle, ellipse, arrow, text, the last-used overflow item, then ▾ */}
      <Show when={showTool("rectangle")}><ToolBtn id="rectangle" tool={tool} setTool={props.setTool} /></Show>
      <Show when={showTool("ellipse")}><ToolBtn id="ellipse" tool={tool} setTool={props.setTool} /></Show>
      <Show when={showTool("arrow")}><ToolBtn id="arrow" tool={tool} setTool={props.setTool} /></Show>
      <Show when={showTool("text")}><ToolBtn id="text" tool={tool} setTool={props.setTool} /></Show>
      <ToolBtn id={props.extraShape()} tool={tool} setTool={props.setTool} />
      <div class="ns-add-wrap">
        <button class="ns-tool" classList={{ active: props.shapeMenuOpen() }} title="More shapes" onClick={() => { props.setShapeMenuOpen(!props.shapeMenuOpen()); props.setAddOpen(false); }}><Icon d="M6 8l5 5 5-5" /></button>
        <Show when={props.shapeMenuOpen()}>
          <div class="ns-menu ns-menu-grid" onWheel={(e) => e.stopPropagation()}>
            <button class="ns-tool" title="Line" classList={{ active: tool() === "line" }} onClick={() => armOverflow("line")}><Icon d={TOOL_META.line[1]} /></button>
            <button class="ns-tool" title="Box" classList={{ active: tool() === "box" }} onClick={() => armOverflow("box")}><Icon d={TOOL_META.box[1]} /></button>
            <For each={props.brushes()}>{(b) => <button class="ns-tool" title={b.name || b.id} classList={{ active: tool() === b.id }} onClick={() => armOverflow(b.id)}><Icon d={(TOOL_META[b.id] || [, BRUSH_FALLBACK_PATH])[1]} /></button>}</For>
          </div>
        </Show>
      </div>
      <div class="ns-sep" />
      {/* docs overflow — a searchable add menu. HAND-ROLLED (not Kobalte Popover): the
          popover portaled to document.body and broke inside a nested <patchwork-view>
          (Sketchier) — dismiss read the opening click as "outside" and closed instantly.
          A plain positioned menu + a backdrop for outside-close works everywhere. */}
      <div class="ns-add-wrap">
        <button class="ns-tool ns-add" classList={{ active: tool() === "place" || props.addOpen() }} title="New document" onClick={() => { props.setAddOpen(!props.addOpen()); props.setShapeMenuOpen(false); }}>
          <svg viewBox="0 0 22 22" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3.5" y="4" width="15" height="14" rx="1.5" /><path d="M3.5 8h15" /><circle cx="6" cy="6" r="0.6" fill="currentColor" stroke="none" /><circle cx="8" cy="6" r="0.6" fill="currentColor" stroke="none" /><circle cx="10" cy="6" r="0.6" fill="currentColor" stroke="none" /><path d="M6.5 11.5h9M6.5 14.5h6" stroke-width="1.2" opacity="0.7" />
          </svg>
        </button>
        <Show when={props.addOpen()}>
          <div class="ns-menu-backdrop" onPointerDown={() => props.setAddOpen(false)} />
          <div class="ns-menu ns-menu-add" onWheel={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
            {/* ONE searchable list: new docs, sources, editors, lenses — all filtered together */}
            <input class="ns-text ns-menu-search" autofocus placeholder="search…" value={docQuery()} onInput={(e) => setDocQuery(e.currentTarget.value)} />
            <Show when={docList().length}>
              <div class="ns-menu-sep">new</div>
              <For each={docList()}>{(dt) => <button class="ns-menu-item" onClick={() => props.selectPlacing(dt)}>＋ {dt.name || dt.id}</button>}</For>
            </Show>
            <Show when={sources().length}>
              <div class="ns-menu-sep">sources</div>
              <For each={sources()}>{(ed) => <button class="ns-menu-item" onClick={() => { props.placeEditor(ed); props.setAddOpen(false); }}>● {ed.name || ed.id}</button>}</For>
            </Show>
            <Show when={editors().length}>
              <div class="ns-menu-sep">editors</div>
              <For each={editors()}>{(ed) => <button class="ns-menu-item" onClick={() => { props.placeEditor(ed); props.setAddOpen(false); }}>⚡ {ed.name || ed.id}</button>}</For>
            </Show>
            <Show when={lenses().length}>
              <div class="ns-menu-sep">lenses</div>
              <For each={lenses()}>{(ln) => <button class="ns-menu-item" onClick={() => { props.placeLens(ln); props.setAddOpen(false); }}>◇ {ln.name || ln.id}</button>}</For>
            </Show>
          </div>
        </Show>
      </div>
      </Show>
    </div>
  );
}

// ---------------------------------------------------------------------------
// a searchable tool selector (like patchwork-base's open-with): filter the
// supported tools, click one, or type any tool id and press Enter.
export function ToolPicker(props) {
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

// a Solid accessor over a REACTIVELY-CHOSEN Source/opstream (null ⇒ undefined) —
// how the panel shows a wired param's / raw inlet's LIVE value.
export function streamSignal(getStream) {
  const [v, setV] = createSignal(undefined);
  createEffect(() => {
    const s = typeof getStream === "function" ? getStream() : getStream;
    if (!s) return setV(undefined);
    if (!s.connect) return setV(() => s.value);
    const off = s.connect(() => setV(() => s.value));
    onCleanup(off);
  });
  return v;
}

// raw-value text round-trip for the inline raw-inlet editor (mirrors the raw value
// node's own coerce/uncoerce). parse returns undefined for unparseable json ⇒ skip.
export function rawText(v, kind) {
  if (kind === "json") { try { return JSON.stringify(v); } catch { return ""; } }
  return v == null ? "" : String(v);
}
export function parseRawText(text, kind) {
  if (kind === "number") { const n = Number(text); return Number.isFinite(n) ? n : 0; }
  if (kind === "boolean") return text === "true" || text === true;
  if (kind === "json") { try { return JSON.parse(text); } catch { return undefined; } }
  return text == null ? "" : String(text);
}

export function Properties(outer) {
  // chrome reads the context: the SELECTION comes from the context Source; the host
  // carries the commands (get/set, doc mutations). (Back-compat: flat props may hand
  // in hasSel/selCount accessors directly.)
  const props = outer.host || outer;
  const selection = props.context ? opstreamToSignal(props.context.selection) : null;
  const selCount = props.selCount || (() => (selection() || []).length);
  const hasSel = props.hasSel || (() => selCount() > 0);
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
    windowDrag(move); // settles on pointerup AND pointercancel
  }
  const docTools = createMemo(() => { const it = props.single(); if (!it || it.kind !== "doc") return []; const type = props.linkFor(it.url)?.type; try { return type ? getSupportedToolsForType(type) : []; } catch { return []; } });

  return (
    <div class="ns-props" style={{ left: `${props.pos().x}px`, top: `${props.pos().y}px` }} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <div class="ns-props-head" onPointerDown={startDrag}>
        <span class="ns-grip" />
        {isStroke() ? "Ink" : isShape() ? "Shape" : isText() ? "Text" : isMulti() ? "Multiple" : isFrame() ? "Box" : isDoc() ? "Document" : (props.params && props.params()?.title) || "Tool"}
      </div>

      {/* PARAMS — a single generic control block driven by paramDefs (schema fields OR a
          legacy array), bound to whatever the host points `params` at: a selected NODE's
          config, or the active brush's per-viewer config. One renderer, both cases.
          PARAM-INLET-WINS-WHEN-WIRED: a param that is ALSO a wired inlet is driven by
          the wire — its control shows the wired LIVE value and disables (⚡ hint),
          instead of fighting the stream. */}
      <Show when={props.params && props.params()}>{(pt) => {
        const k = (p) => p.key || p.name;
        return <For each={pt().defs}>{(p) => {
          const wire = () => (pt().wire ? pt().wire(k(p)) : null);
          const live = streamSignal(() => (wire() && pt().stream ? pt().stream(wire()) : null));
          const dis = () => !!wire();
          const get = (key) => (dis() ? (live() !== undefined ? live() : pt().get(key)) : pt().get(key));
          const set = (key, v) => { if (!dis()) pt().set(key, v); };
          return (
          <>
            <div class="ns-field">{p.label || k(p)}<Show when={dis()}><span class="ns-wired-flag" title="driven by a wire — the wire wins">⚡</span></Show></div>
            <Show when={p.type === "color"}>
              <div class="ns-row ns-swatches"><For each={PALETTE}>{(c) => <button class="ns-swatch" disabled={dis()} classList={{ active: get(k(p)) === c }} style={{ background: colorVar(c) }} onClick={() => set(k(p), c)} />}</For></div>
            </Show>
            <Show when={p.type === "size"}>
              <div class="ns-row ns-sizes"><For each={SIZES}>{(sz) => <button class="ns-size" disabled={dis()} classList={{ active: get(k(p)) === sz }} onClick={() => set(k(p), sz)}><span class="ns-fatline" style={{ height: `${Math.max(2, sz)}px` }} /></button>}</For></div>
            </Show>
            <Show when={p.type === "slider" || p.type === "number"}>
              <div class="ns-row"><input type="range" disabled={dis()} style={{ width: "100%" }} min={p.min ?? 0} max={p.max ?? 1} step={p.step ?? 0.1} value={get(k(p)) ?? p.min ?? 0} onInput={(e) => set(k(p), parseFloat(e.currentTarget.value))} /></div>
            </Show>
            <Show when={p.type === "toggle"}>
              <div class="ns-row ns-order"><button class="ns-obtn" disabled={dis()} classList={{ active: !!get(k(p)) }} onClick={() => set(k(p), !get(k(p)))}>{get(k(p)) ? "on" : "off"}</button></div>
            </Show>
            <Show when={p.type === "select"}>
              <div class="ns-row ns-order"><For each={p.options || []}>{(o) => { const val = o && typeof o === "object" ? o.value : o; const lab = o && typeof o === "object" ? o.label : o; return <button class="ns-obtn" disabled={dis()} classList={{ active: get(k(p)) === val }} onClick={() => set(k(p), val)}>{lab}</button>; }}</For></div>
            </Show>
            <Show when={p.type === "text"}>
              <div class="ns-row"><input class="ns-text" disabled={dis()} style={{ width: "100%" }} value={get(k(p)) ?? ""} onInput={(e) => set(k(p), e.currentTarget.value)} /></div>
            </Show>
          </>
          );
        }}</For>;
      }}</Show>

      {/* RAW-VALUE INLETS — an inlet wired to a raw value node is editable right here
          (not just on the node): edits write THROUGH the raw node's stream (apply), so
          its input/config stay the source of truth. */}
      <Show when={props.params && props.params()?.raws?.length}>{(_) => {
        const pt = props.params;
        return <For each={pt().raws}>{(r) => {
          const stream = () => (pt().stream ? pt().stream({ node: r.node, outlet: r.outlet }) : null);
          const live = streamSignal(stream);
          const writable = () => { const s = stream(); return !!(s && typeof s.apply === "function"); };
          const push = (v) => { if (v === undefined) return; const s = stream(); if (s && typeof s.apply === "function") s.apply({ type: "snapshot", value: v }); };
          return (
            <>
              <div class="ns-field">{r.name}<span class="ns-raw-flag" title="a wired raw value — edit it here or on the node">raw</span></div>
              <div class="ns-row">
                <Show when={r.kind === "boolean"} fallback={
                  <Show when={r.kind === "number"} fallback={
                    <input class="ns-text" style={{ width: "100%" }} disabled={!writable()} value={rawText(live(), r.kind)} onChange={(e) => push(parseRawText(e.currentTarget.value, r.kind))} />
                  }>
                    <input class="ns-text" type="number" style={{ width: "100%" }} disabled={!writable()} value={live() ?? 0} onChange={(e) => push(parseRawText(e.currentTarget.value, "number"))} />
                  </Show>
                }>
                  <button class="ns-obtn" disabled={!writable()} classList={{ active: !!live() }} onClick={() => push(!live())}>{live() ? "true" : "false"}</button>
                </Show>
              </div>
            </>
          );
        }}</For>;
      }}</Show>

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
        <div class="ns-row ns-sizes"><For each={props.arrow() ? ARROW_SIZES : SIZES}>{(sz) => <button class="ns-size" classList={{ active: g("size") === sz }} onClick={() => s("size", sz)}><span class="ns-fatline" style={{ height: `${Math.max(2, sz)}px` }} /></button>}</For></div>
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

      {/* APPEARS ON — the selected item's layer MEMBERSHIPS. The home layer (owns the
          item's coordinates) is locked on; ticking another layer adds a pure visibility
          membership: the item shows whenever ANY ticked layer is visible in the current
          mode, always rendered in its home space. Root items only (host gates `layers`). */}
      <Show when={props.layers && props.itemLayersOf && props.single() && props.layers().length > 1}>
        <div class="ns-field">appears on</div>
        <div class="ns-row ns-appears">
          <For each={props.layers()}>{(layer) => {
            const members = () => props.itemLayersOf(props.single() || {});
            const home = () => members()[0] === layer.id;
            return (
              <label class="ns-check" classList={{ "ns-appears-home": home() }} title={home() ? "home layer — owns this item's coordinates" : "show this item while this layer is visible"}>
                <input type="checkbox" checked={members().includes(layer.id)} disabled={home()} onChange={() => props.toggleItemLayer(props.single().id, layer.id)} />
                <span>{layer.name || layer.id}{home() ? " · home" : ""}</span>
              </label>
            );
          }}</For>
        </div>
      </Show>

      <Show when={(selCount() > 1 && !props.hasGroup()) || props.hasGroup()}>
        <div class="ns-field">group</div>
        <div class="ns-row ns-order">
          <Show when={selCount() > 1 && !props.hasGroup()}>
            <button class="ns-obtn" title="Group  (⌘G)" onClick={() => props.group()}>group</button>
          </Show>
          <Show when={props.hasGroup()}>
            <button class="ns-obtn" title="Ungroup  (⇧⌘G)" onClick={() => props.ungroup()}>ungroup</button>
          </Show>
        </div>
      </Show>

      <Show when={hasSel()}>
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

