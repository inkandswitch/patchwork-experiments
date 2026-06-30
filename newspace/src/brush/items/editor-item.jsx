// A canvas item that hosts a `sketchy:editor` (e.g. codemirror) OR a `sketchy:lens`
// (e.g. number→string), wired to live opstreams. The item stores
// `{ editorId, inlets: { name: {url,path,heads?} | {context} | {peer,part} | {node,outlet} } }`;
// here we resolve the descriptor (editor OR lens), rebuild each inlet opstream from
// its wiring, and either mount the editor or apply the lens. An editor/lens
// exposes OUTLET ports (right edge) you can wire FROM into another node's inlet.
import { createEffect, createMemo, onCleanup, untrack, For, Show } from "solid-js";
import { listEditors, mountEditor, inletDefsFor, outletDefsFor } from "../../editors.js";
import { listLensDescriptors, applyLens } from "../../lenses.js";
import { roughRectPath, roughEllipsePath, seedFromId } from "../../draw.js";
import { jsonPathStream } from "../../json-path.js";
import { snapshot, describeBinary, isError } from "../../ops.js";
import { Opstream } from "../../opstreams.js";

// A node is a function: set up reactive data once, return DOM. Inlets are STABLE
// proxies whose BACKING swaps as you plug/unplug — the node connects once and just
// receives new values; nothing remounts. When nothing is wired, the proxy IS its own
// editable buffer (so e.g. codemirror authors into it). `wired` tells a node whether a
// real source is connected; `apply` forwards to the backing (absent ⇒ read-only).
export function inletProxy() {
  const buffer = new Opstream(undefined); // editable default when unwired (also the read side in "back")
  let backing = buffer, off = null, error = null, dir = "both";
  const subs = new Set();
  const fire = (op) => { error = isError(op) ? op.error : null; for (const cb of [...subs]) cb(op); };
  // PER-WIRE FLOW DIRECTION (overridable from the wire UI):
  //   "both" (default) — read the source AND write back to it (full bidi)
  //   "fwd"            — read-only: the source drives the inlet; write-back suppressed
  //   "back"           — write-only: THIS node drives the source; the node reads its own
  //                      buffer (seeded from the source) so incoming source ops don't clobber it
  const readSrc = () => (dir === "back" && backing !== buffer ? buffer : backing);
  const wire = () => { if (off) off(); error = null; const s = readSrc(); off = s.connect ? s.connect((op) => fire(op)) : null; };
  wire();
  return {
    get value() { return readSrc().value; },
    get complement() { return backing.complement || {}; },
    get wired() { return backing !== buffer; },
    get error() { return (backing.error != null ? backing.error : error) || null; }, // an upstream failure
    get apply() {
      if (dir === "fwd") return undefined;                       // read-only: no write-back
      if (typeof backing.apply !== "function") return undefined; // source not writable
      return (op, a) => { if (dir === "back" && backing !== buffer) buffer.apply(op, a); backing.apply(op, a); };
    },
    connect(cb) { subs.add(cb); cb(snapshot(readSrc().value)); if (this.error) cb({ type: "error", error: this.error }); return () => subs.delete(cb); },
    setBacking(s) { const next = s || buffer; if (next === backing) return; backing = next; wire(); /* connect() above re-emits the new value */ },
    setDir(d) {
      const nd = d || "both"; if (nd === dir) return;
      if (nd === "back" && backing !== buffer) buffer.apply(snapshot(backing.value)); // seed so we don't blank the source
      dir = nd; wire(); // re-subscribe to the right read source; its connect re-emits the current value
    },
  };
}

export function EditorItem(props) {
  const it = props.it, ctx = props.ctx;
  let host;
  let cleanup = null;
  let token = 0;

  // resolve from the editor registry first, then the lens registry (reactive: JSX
  // renders outlet ports from it, mount() applies it)
  const descriptor = createMemo(() =>
    listEditors().find((e) => e.id === it().editorId) ||
    listLensDescriptors().find((e) => e.id === it().editorId) ||
    null
  );

  // resolve one inlet wiring → its live opstream
  async function resolveInlet(wire) {
    if (!wire) return null;
    const sync = resolveInletSync(wire);
    if (wire.context || wire.peer || wire.node) return sync;
    if (wire.url && ctx.api) {
      const frag = wire.path && wire.path.length ? "#" + wire.path.join("/") : "";
      try { return await ctx.api.find(wire.url + frag, { heads: wire.heads }); }
      catch (e) { console.warn("[sketchy] editor inlet failed:", e); return null; }
    }
    return null;
  }
  // the synchronous part (everything but a url, which needs api.find)
  function resolveInletSync(wire) {
    if (!wire) return null;
    if (wire.context) return (ctx.context && ctx.context[wire.context]) || null;
    if (wire.peer) return ctx.peerStream ? ctx.peerStream(wire.peer, wire.part) : null;
    if (wire.node) return ctx.nodeStream ? ctx.nodeStream(wire.node, wire.outlet) : null;
    return null;
  }

  // Mount the node ONCE. Inlets are stable proxies; a SEPARATE effect keeps each
  // proxy's backing synced with the live wiring (explicit wire > splat `*` > the
  // proxy's own buffer). Plugging/unplugging swaps a backing — it never remounts.
  async function mount() {
    const mine = ++token;
    if (cleanup) { try { cleanup(); } catch {} cleanup = null; }
    ctx.unregisterOutlets && ctx.unregisterOutlets(it().id);
    if (!host) return;
    host.replaceChildren();

    const d = descriptor();
    if (!d) { host.textContent = `${it().editorId} not found`; return; }

    const proxies = {};
    const ensure = (name) => (proxies[name] || (proxies[name] = inletProxy()));
    // UNTRACK the whole call: inletDefsFor → dynamicInlets(config) reads config.* — if
    // those reads land in this effect's scope, every keystroke (setConfig) remounts the
    // node. The reactive inlet SET is handled by the inner effect below, not here.
    for (const def of untrack(() => inletDefsFor(d, it()))) ensure(def.name);

    createEffect(() => {
      if (mine !== token) return;
      const wiring = it().inlets || {};
      const defs = inletDefsFor(d, it()); // tracks config ⇒ dynamic inlets (template) appear
      for (const def of defs) ensure(def.name);
      const splatW = wiring["*"];
      const splatSync = splatW && !splatW.url ? resolveInletSync(splatW) : null;
      if (splatW && splatW.url) resolveInlet(splatW).then((s) => { if (mine === token && s) for (const def of defs) if (!wiring[def.name]) proxies[def.name].setBacking(jsonPathStream(s, () => "." + def.name)); });
      for (const def of defs) {
        const w = wiring[def.name];
        if (w) { if (w.url) resolveInlet(w).then((s) => { if (mine === token) proxies[def.name].setBacking(s); }); else proxies[def.name].setBacking(resolveInletSync(w)); }
        else if (splatSync) proxies[def.name].setBacking(jsonPathStream(splatSync, () => "." + def.name));
        else proxies[def.name].setBacking(null); // ⇒ the proxy's own editable buffer
        proxies[def.name].setDir(w && w.dir); // per-wire flow override (undefined ⇒ "both")
      }
    });

    const outlets = {};
    const setOutlet = (name, stream) => { outlets[name] = stream; if (mine === token) ctx.registerOutlets && ctx.registerOutlets(it().id, { ...outlets }); };
    // untrack the SPREAD too — `{ ...proxy }` enumerates every config key, which would
    // otherwise track them all and remount on any config edit. Mount reads config once.
    const config = untrack(() => ({ ...(it().config || {}) }));
    const setConfig = (patch) => {
      const h = props.surface && props.surface.handle;
      if (!h) return;
      h.change((dd) => { const o = (dd.items || []).find((x) => x.id === it().id); if (o) { if (!o.config) o.config = {}; Object.assign(o.config, patch); } });
    };
    // EPHEMERAL broadcast keyed by THIS item's id — the basis for "everyone sees mine"
    // sharing of a user-local source: the placer broadcasts its value, every viewer's
    // SAME item (same id in the shared doc) receives it. Not persisted (presence only).
    // broadcast on the FOLDER handle — the doc both peers opened, the same channel
    // presence/cursors use (which is proven to relay ephemeral). The layout-doc handle
    // did NOT relay reliably. (frames: their own folderHandle, also shared.)
    const surfaceHandle = props.surface && (props.surface.folderHandle || props.surface.handle);
    const broadcast = (msg) => { try { if (surfaceHandle && surfaceHandle.broadcast) surfaceHandle.broadcast({ __ns: it().id, ...msg }); } catch (e) { console.warn("[sketchy] broadcast failed:", e); } };
    const onBroadcast = (cb) => {
      if (!surfaceHandle || !surfaceHandle.on) return () => {};
      const h = (p) => { const m = p && p.message; if (m && m.__ns === it().id) cb(m); };
      surfaceHandle.on("ephemeral-message", h);
      return () => { try { surfaceHandle.off("ephemeral-message", h); } catch {} };
    };
    // REACTIVE config: a mount stays mounted, but its config can change underneath it
    // (e.g. another viewer flips a source to "everyone sees mine"). onConfig lets a node
    // react — fires with the current config now and on every change.
    // DEEP-track config: `{...c}` only subscribes to the keys present at first run, so a
    // newly-ADDED key (e.g. an owner's first `sharedValue` write) wouldn't re-fire. Read
    // it deeply (JSON walk) so adding a key or changing a nested value always re-runs.
    const onConfig = (cb) => { createEffect(() => { const c = it().config || {}; let snap; try { snap = JSON.parse(JSON.stringify(c)); } catch { snap = { ...c }; } cb(snap); }); };
    // SHARE — the per-item view of the WebRTC mesh (ShareSession). Values over a data
    // channel, streams over tracks, keyed to THIS item id. The own/mine sharing uses it.
    const ss = ctx.shareSession;
    const share = ss ? {
      value: (v) => ss.shareValue(it().id, v),
      onValue: (cb) => ss.onValue(it().id, cb),
      stream: (s) => ss.shareStream(it().id, s),
      onStream: (cb) => ss.onStream(it().id, cb),
      unshare: () => ss.unshare(it().id),
    } : null;
    // RELIABLE value sharing over the DOC, as a TOP-LEVEL item field (`item.shared`) — top
    // -level fields sync like x/y/positions (no nested-config-reactivity surprises). The
    // owner writes it; receivers read it reactively.
    const shareDoc = (v) => { const h = props.surface && props.surface.handle; if (!h) return; h.change((dd) => { const o = (dd.items || []).find((x) => x.id === it().id); if (o) o.shared = (v === undefined ? null : v); }); };
    const onShared = (cb) => createEffect(() => { cb(it().shared); });

    // a LENS: transform its single inlet proxy → its outlet (reactive via the proxy)
    if (d.lens) {
      const inletDef = d.inlets[0], outletDef = d.outlets[0];
      const out = applyLens(d, ensure(inletDef.name));
      setOutlet(outletDef.name, out);
      const wrap = document.createElement("div"); wrap.className = "ns-lens-readout";
      const render = () => { wrap.textContent = `${preview(proxies[inletDef.name].value)} → ${preview(out.value)}`; };
      render();
      const off = out.connect ? out.connect(render) : null;
      host.append(wrap);
      cleanup = () => { if (off) off(); ctx.unregisterOutlets && ctx.unregisterOutlets(it().id); };
      return;
    }

    const c = await mountEditor(d, { element: host, inlets: proxies, outlets, setOutlet, api: ctx.api, config, setConfig, broadcast, onBroadcast, onConfig, share, shareDoc, onShared });
    if (mine !== token) { try { c(); } catch {} return; }
    ctx.registerOutlets && ctx.registerOutlets(it().id, { ...outlets });
    cleanup = () => { try { c(); } catch {} ctx.unregisterOutlets && ctx.unregisterOutlets(it().id); };
  }

  // mount ONCE per node TYPE; wiring changes flow through the reactive proxies above
  createEffect(() => { it().editorId; descriptor(); mount(); });
  onCleanup(() => { token++; if (cleanup) { try { cleanup(); } catch {} } });

  // ports — shown for a lens always, for an editor while wiring. Outlets (right)
  // are grabbable sources; inlets (left) are drop targets you wire INTO. Each has
  // its own pointer-events:auto, so the wire tool finds it even when the body is inert.
  const showPorts = () => { const d = descriptor(); return !!d && (d.lens || ctx.tool() === "wire"); };
  const inletDefs = () => inletDefsFor(descriptor(), it()); // dynamic-aware (template doc)
  const outletDefs = () => outletDefsFor(descriptor(), it()); // dynamic-aware (LLM @out)
  const hasInlets = () => inletDefs().length > 0;
  const hasOutlets = () => outletDefs().length > 0;

  // rough.js hand-drawn border, like docs/frames (deterministic per item id)
  const seed = createMemo(() => seedFromId(it().id));
  const isRound = () => !!descriptor()?.round;
  const outline = createMemo(() => (isRound() ? roughEllipsePath : roughRectPath)(it().w || 0, it().h || 0, seed()));

  // BIDI = can you write back through this port's stream (it has `apply`)? Shown as a
  // diamond nub (matching the wire's diamond), vs a round nub for read-only. An
  // outlet's stream may be writable on its own (a bidirectional lens); an inlet is
  // bidi when wired to a writable source. (reactive via the nodeStreams store.)
  const streamWritable = (s) => !!(s && typeof s.apply === "function");
  const outletBidi = (name) => streamWritable(ctx.nodeStream && ctx.nodeStream(it().id, name));
  const inletBidi = (name) => {
    const w = it().inlets?.[name];
    if (!w) return false;
    if (w.node) return streamWritable(ctx.nodeStream && ctx.nodeStream(w.node, w.outlet));
    if (w.url) return !w.heads; // an automerge field — editable unless pinned at heads
    return false; // context / peer sources are read-only
  };

  return (
    <div class="ns-doc ns-editor" classList={{ "ns-lens": !!descriptor()?.lens, "ns-round": isRound(), "ns-glass": !!descriptor()?.glass, sel: ctx.isSelected(it().id) }} data-item-id={it().id} style={props.baseStyle()} onPointerDown={props.down}>
      <div class="ns-doc-title"><span class="ns-doc-name">{descriptor()?.name || it().editorId}</span></div>
      <svg class="ns-doc-outline" style={{ overflow: "visible" }}>
        <For each={outline()}>{(p) => <path d={p.d} stroke="currentColor" fill="none" stroke-width={p.strokeWidth} stroke-linecap="round" />}</For>
      </svg>
      <div class="ns-editor-body ns-doc-body" ref={host} onPointerDown={(e) => e.stopPropagation()} />
      {/* the SPLAT corner inlet (top-left): wire one object to feed every inlet */}
      <Show when={showPorts() && hasInlets()}>
        <div class="ns-node-port ns-node-splat" classList={{ wired: !!it().inlets?.["*"] }} data-item-id={it().id} data-sketchy-inlet="*" title="all fields — wire one object/doc to fill every inlet" />
      </Show>
      {/* ports are little PD/Max nubs on the edge — name shows in the hover tooltip */}
      <Show when={showPorts() && hasInlets()}>
        <div class="ns-node-inlets">
          <For each={inletDefs()}>
            {(i) => <div class="ns-node-port ns-node-inlet" classList={{ wired: !!it().inlets?.[i.name], req: !!i.required, bidi: inletBidi(i.name) }} data-item-id={it().id} data-sketchy-inlet={i.name} data-tip={`${i.name}${i.required ? " *" : ""}${i.type ? " : " + i.type : ""}${inletBidi(i.name) ? " ⇄" : ""}`} />}
          </For>
        </div>
      </Show>
      <Show when={showPorts() && hasOutlets()}>
        <div class="ns-node-outlets">
          <For each={outletDefs()}>
            {(o) => <div class="ns-node-port ns-node-outlet" classList={{ bidi: outletBidi(o.name) }} data-sketchy-node={it().id} data-sketchy-outlet={o.name} data-tip={`${o.name}${o.type ? " : " + o.type : ""}${outletBidi(o.name) ? " ⇄" : ""}`} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

function preview(v) {
  if (v == null) return "∅";
  if (typeof v === "string") return JSON.stringify(v.length > 24 ? v.slice(0, 24) + "…" : v);
  const d = describeBinary(v); if (d) return d; // a frame/buffer → tag, never stringify
  if (typeof v === "object") { try { const s = JSON.stringify(v); return s.length > 24 ? s.slice(0, 24) + "…" : s; } catch { return "{…}"; } }
  return String(v);
}
