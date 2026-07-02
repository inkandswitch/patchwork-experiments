// A canvas item that hosts a `sketchy:editor` (e.g. codemirror) OR a `sketchy:lens`
// (e.g. number→string), wired to live opstreams. The item stores
// `{ editorId, inlets: { name: {url,path,heads?} | {context} | {peer,part} | {node,outlet} } }`;
// here we resolve the descriptor (editor OR lens), rebuild each inlet opstream from
// its wiring, and either mount the editor or apply the lens. An editor/lens
// exposes OUTLET ports (right edge) you can wire FROM into another node's inlet.
import { createEffect, createMemo, createRoot, getOwner, runWithOwner, onCleanup, untrack, For, Show } from "solid-js";
import { listEditors, mountEditor, inletDefsFor, outletDefsFor, paramsAsInlets } from "../../editors.js";
import { listLensDescriptors, applyLens } from "../../lenses.js";
import { roughRectPath, roughEllipsePath, seedFromId } from "../../draw.js";
import { PortNub } from "../ui/chrome.jsx";
import { jsonPathStream } from "../../json-path.js";
import { snapshot, describeBinary, isError, fmtNum, previewReplacer, valuesEqual } from "../../ops.js";
import { Opstream } from "../../opstreams.js";
import { log } from "../../log.js";

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

// Which backing an inlet should take, given the item's persisted wiring. THE unwire
// invariant rides on this: a `null` wiring entry is the EXPLICIT-DISCONNECT tombstone
// (unwire writes it instead of deleting the key) — a cut inlet reverts to the proxy's
// own buffer and must NOT be re-fed by the splat or a bare tool's ambient canvas
// outlet; those fallbacks are only for inlets that were never wired (no entry at all).
export function inletBackingPlan(wiring, name, { splat = false, auto = false } = {}) {
  const w = wiring ? wiring[name] : undefined;
  if (w) return { kind: "wired", wire: w };
  if (w !== undefined) return { kind: "cut" }; // the null tombstone
  if (splat) return { kind: "splat" };
  if (auto) return { kind: "auto" };
  return { kind: "buffer" };
}

// The stale-async-resolution guard. A url wire resolves through `api.find` — a REAL
// await — so a resolution launched under an OLD wiring can land AFTER the user
// rewired, cut (the null tombstone) or unwired the inlet, and would clobber the newer
// backing with an outdated stream. The gate mints a per-inlet GENERATION:
// `ticket(name, entry)` is called synchronously every time a wiring pass processes
// the inlet, bumping the generation whenever the persisted entry CHANGED BY VALUE
// (null and undefined are DISTINCT states — explicitly cut vs never wired). A landing
// presents its ticket to `shouldApply(ticket, currentEntry)` and applies only if the
// generation is still current AND the entry persisted NOW still equals the one it
// launched with — losers drop silently, so `inletBackingPlan`'s precedence (wired >
// cut > splat > auto > buffer) is never bypassed by a straggler. Entries are
// snapshotted to strings at mint time: a live projection node reconciles IN PLACE, so
// holding the reference would make the stale entry compare equal to the new one.
// (Remount/unmount staleness is the mount token's job — the gate covers same-mount
// races.)
export function inletResolutionGate() {
  const gens = Object.create(null);
  const last = Object.create(null);
  const ser = (e) => {
    if (e === undefined) return "\x00never-wired";
    try { const s = JSON.stringify(e); return s === undefined ? "\x00unserializable" : s; } catch { return "\x00unserializable"; }
  };
  return {
    ticket(name, entry) {
      const key = ser(entry);
      if (gens[name] === undefined || last[name] !== key) { gens[name] = (gens[name] || 0) + 1; last[name] = key; }
      return { name, gen: gens[name], key };
    },
    shouldApply(t, currentEntry) { return gens[t.name] === t.gen && ser(currentEntry) === t.key; },
  };
}

// Which tools PRESS an editor item's chrome (grab/move/select/erase). Anything else —
// a drawing/placing/text brush — must fall through to the canvas's draw handler (the
// embed convention, cf. DocOrFrame.grab: return early WITHOUT stopping propagation).
export const chromePressTool = (t) => t === "select" || t === "wire" || t === "eraser";

export function EditorItem(props) {
  const it = props.it, ctx = props.ctx;
  // draw brushes pass THROUGH the node chrome to the canvas; pointer-ish tools grab it
  const chromePress = (e) => { if (chromePressTool(ctx.tool())) props.down(e); };
  let host;
  let cleanup = null;
  let token = 0;
  // per-mount owner for effects created AFTER an await boundary (onConfig/onShared):
  // mountEditor resolves in a microtask, so a bare createEffect there has no owner and
  // would never be disposed — run them under this root, disposed with the mount/item.
  let fxDispose = null;
  const disposeFx = () => { if (fxDispose) { try { fxDispose(); } catch {} fxDispose = null; } };

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
      catch (e) { log.warn("editor inlet failed:", e); return null; }
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
    disposeFx();
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
    // PARAM-INLETS (paramsAsInlets): every param is also a wireable inlet. Static per
    // descriptor, so resolved once per mount; wired ones get a backing below and their
    // values MIRROR INTO CONFIG (the wire wins — the node reacts via onConfig, and the
    // properties panel shows the wired value + disables its control).
    const pdefs = untrack(() => paramsAsInlets(d));

    // per-inlet generations for url resolutions (see inletResolutionGate): `mine`/`token`
    // covers remount/unmount, the gate covers same-mount rewire/cut/unwire while a
    // `api.find` is in flight. `entryNow` reads the wiring persisted at LANDING time.
    const gate = inletResolutionGate();
    const entryNow = (name) => untrack(() => (it().inlets || {})[name]);

    createEffect(() => {
      if (mine !== token) return;
      const wiring = it().inlets || {};
      const defs = inletDefsFor(d, it()); // tracks config ⇒ dynamic inlets (template) appear
      for (const def of defs) ensure(def.name);
      const splatW = wiring["*"];
      const splatT = gate.ticket("*", splatW);
      const splatSync = splatW && !splatW.url ? resolveInletSync(splatW) : null;
      // the splat fills only NEVER-wired inlets — not ones explicitly cut (null tombstone).
      // Both checks happen at LANDING time against the wiring persisted THEN: the splat
      // itself may have been rewired (the ticket) and any target inlet may have gained a
      // wire or a tombstone while the find was in flight (entryNow).
      if (splatW && splatW.url) resolveInlet(splatW).then((s) => { if (mine === token && s && gate.shouldApply(splatT, entryNow("*"))) for (const def of defs) if (entryNow(def.name) === undefined) proxies[def.name].setBacking(jsonPathStream(s, () => "." + def.name)); });
      // a BARE layer tool (minimap, map) is fed the canvas's own reactive state: any inlet
      // whose name matches a canvas outlet (items/bounds/peers/camera/view/…) auto-wires to
      // it unless you've wired it explicitly. The widget always sees live canvas data —
      // EXCEPT an inlet whose wire the user REMOVED (the null tombstone): removing a wire
      // must actually stop delivery, not silently rewire to the same ambient stream.
      const autoOutlets = d.bare && ctx.canvasOutlets ? ctx.canvasOutlets() : null;
      for (const def of defs) {
        const plan = inletBackingPlan(wiring, def.name, { splat: !!splatSync, auto: !!(autoOutlets && autoOutlets[def.name]) });
        const w = plan.kind === "wired" ? plan.wire : null;
        const t = gate.ticket(def.name, wiring[def.name]);
        if (w) { if (w.url) resolveInlet(w).then((s) => { if (mine === token && gate.shouldApply(t, entryNow(def.name))) proxies[def.name].setBacking(s); }); else proxies[def.name].setBacking(resolveInletSync(w)); }
        else if (plan.kind === "splat") proxies[def.name].setBacking(jsonPathStream(splatSync, () => "." + def.name));
        else if (plan.kind === "auto") proxies[def.name].setBacking(autoOutlets[def.name].stream);
        else proxies[def.name].setBacking(null); // cut or never wired ⇒ the proxy's own editable buffer
        proxies[def.name].setDir(w && w.dir); // per-wire flow override (undefined ⇒ "both")
      }
      // param-inlets: same backing plan, but NO splat/auto fallback ever feeds a param
      // (a param's fallback is its config/default, not an ambient stream).
      const declared = new Set(defs.map((x) => x.name));
      for (const def of pdefs) {
        if (declared.has(def.name)) continue; // a real inlet of the same name owns it
        const plan = inletBackingPlan(wiring, def.name, {});
        const w = plan.kind === "wired" ? plan.wire : null;
        const t = gate.ticket(def.name, wiring[def.name]);
        const px = ensure(def.name);
        if (w) { if (w.url) resolveInlet(w).then((s) => { if (mine === token && gate.shouldApply(t, entryNow(def.name))) px.setBacking(s); }); else px.setBacking(resolveInletSync(w)); }
        else px.setBacking(null);
        px.setDir(w && w.dir);
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
    const broadcast = (msg) => { try { if (surfaceHandle && surfaceHandle.broadcast) surfaceHandle.broadcast({ __ns: it().id, ...msg }); } catch (e) { log.warn("broadcast failed:", e); } };
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
    // these run after `await mountEditor` — no reactive owner — so hang each effect off
    // the per-mount root (fxOwner), disposed when the mount is replaced / the item unmounts.
    const fxOwner = createRoot((dispose) => { fxDispose = dispose; return getOwner(); });
    const onConfig = (cb) => { runWithOwner(fxOwner, () => createEffect(() => { const c = it().config || {}; let snap; try { snap = JSON.parse(JSON.stringify(c)); } catch { snap = { ...c }; } cb(snap); })); };
    // WIRED PARAM values mirror into config — the runtime half of param-inlet-wins:
    // the stream drives the persisted knob; the node reacts through its normal
    // onConfig path. Raw callbacks on the stable proxies (unwired ⇒ own buffer ⇒
    // `wired` is false ⇒ no-op), disconnected with the mount.
    const paramOffs = pdefs.map((def) => { const px = ensure(def.name); return px.connect(() => {
      if (!px.wired) return;
      const v = px.value;
      if (v === undefined) return;
      const cur = untrack(() => (it().config || {})[def.name]);
      if (!valuesEqual(cur, v)) setConfig({ [def.name]: v });
    }); });
    const offParams = () => { for (const o of paramOffs) { try { o(); } catch {} } };
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
    const onShared = (cb) => runWithOwner(fxOwner, () => createEffect(() => { cb(it().shared); }));

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
      cleanup = () => { if (off) off(); offParams(); ctx.unregisterOutlets && ctx.unregisterOutlets(it().id); };
      return;
    }

    const c = await mountEditor(d, { element: host, itemId: it().id, inlets: proxies, outlets, setOutlet, api: ctx.api, config, setConfig, broadcast, onBroadcast, onConfig, share, shareDoc, onShared, canvas: ctx.canvasOutlets ? ctx.canvasOutlets() : null, context: ctx.context });
    if (mine !== token) { try { c(); } catch {} offParams(); return; }
    ctx.registerOutlets && ctx.registerOutlets(it().id, { ...outlets });
    cleanup = () => { try { c(); } catch {} offParams(); ctx.unregisterOutlets && ctx.unregisterOutlets(it().id); };
  }

  // mount ONCE per node TYPE; wiring changes flow through the reactive proxies above
  createEffect(() => { it().editorId; descriptor(); mount(); });
  onCleanup(() => { token++; if (cleanup) { try { cleanup(); } catch {} } disposeFx(); });

  // ports — shown for a lens always, for an editor while wiring. Outlets (right)
  // are grabbable sources; inlets (left) are drop targets you wire INTO. Each has
  // its own pointer-events:auto, so the wire tool finds it even when the body is inert.
  const bare = () => !!descriptor()?.bare; // a layer widget: no node frame, but full ports
  // ports only show while WIRING (or always for a lens), and only for items on the ACTIVE
  // layer. Bare widgets no longer show their ports just because their layer is active — that
  // buried the overlay in port nubs + wire tangle; the plumbing is invisible until you wire.
  const showPorts = () => {
    const d = descriptor(); if (!d) return false;
    if (ctx.layerIsActive && !ctx.layerIsActive(it())) return false;
    return d.lens || ctx.tool() === "wire";
  };
  // a bare tool's inlet that matches a canvas outlet is fed by the (hidden) canvas provider —
  // show its nub as CONNECTED even though there's no drawn wire. NOT when explicitly wired,
  // and NOT when the wire was removed (null tombstone — the auto-feed is suppressed then too).
  const autoWired = (name) => bare() && ctx.canvasOutlets && !!ctx.canvasOutlets()[name] && it().inlets?.[name] === undefined;
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
  // bidi when wired to a writable source. (reactive via the nodeStreams bump
  // signal — nodeStream() tracks it, so a late-registered outlet updates these.)
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
    <div class={bare() ? "ns-bare ns-editor" : "ns-doc ns-editor"} classList={{ "ns-lens": !!descriptor()?.lens, "ns-round": isRound(), "ns-glass": !!descriptor()?.glass, sel: ctx.isSelected(it().id) }} data-item-id={it().id} style={props.baseStyle()} onPointerDown={chromePress}>
      <Show when={!bare()}>
        <div class="ns-doc-title"><span class="ns-doc-name">{descriptor()?.name || it().editorId}</span></div>
        <svg class="ns-doc-outline" style={{ overflow: "visible" }}>
          <For each={outline()}>{(p) => <path d={p.d} stroke="currentColor" fill="none" stroke-width={p.strokeWidth} stroke-linecap="round" />}</For>
        </svg>
      </Show>
      {/* a GLASS body (the magnifier) is a lens, not a text editor + it hides the title bar,
          so its body must pass pointerdown through to grab/move the item (its own controls
          stopPropagation themselves). Normal editor bodies keep grabbing out of the way. */}
      <div class="ns-editor-body ns-doc-body" ref={host} onPointerDown={(e) => { if (!descriptor()?.glass) e.stopPropagation(); }} />
      {/* a bare widget's BODY is the interactive widget (clicking the minimap jumps), so it
          can't also be the move-grip. While its layer is active, a little chrome bar gives a
          grab handle + name + remove — that's how you edit/move/delete a bare window. */}
      <Show when={bare() && ctx.layerIsActive && ctx.layerIsActive(it())}>
        <div class="ns-bare-chrome" onPointerDown={chromePress}>
          <span class="ns-bare-name">{descriptor()?.name || it().editorId}</span>
          <button class="ns-bare-x" title="remove" onPointerDown={(e) => e.stopPropagation()} onClick={() => ctx.removeItem(it().id)}>×</button>
        </div>
      </Show>
      {/* the SPLAT corner inlet (top-left): wire one object to feed every inlet */}
      <Show when={showPorts() && hasInlets()}>
        <div class="ns-node-port ns-node-splat" classList={{ wired: !!it().inlets?.["*"] }} data-item-id={it().id} data-sketchy-inlet="*" title="all fields — wire one object/doc to fill every inlet" />
      </Show>
      {/* ports are little PD/Max nubs on the edge — name shows in the hover tooltip.
          The div is the (unchanged, 12px) HIT AREA; the visible nub is a rough.js
          circle/diamond (PortNub), deterministic per item id + port name. */}
      <Show when={showPorts() && hasInlets()}>
        <div class="ns-node-inlets">
          <For each={inletDefs()}>
            {(i) => <div class="ns-node-port ns-node-inlet" classList={{ wired: !!it().inlets?.[i.name] || autoWired(i.name), req: !!i.required, bidi: inletBidi(i.name) }} data-item-id={it().id} data-sketchy-inlet={i.name} data-tip={`${i.name}${i.required ? " *" : ""}${i.type ? " : " + i.type : ""}${autoWired(i.name) ? " ← canvas" : ""}${inletBidi(i.name) ? " ⇄" : ""}`}><PortNub id={it().id} name={i.name} bidi={inletBidi(i.name)} /></div>}
          </For>
        </div>
      </Show>
      <Show when={showPorts() && hasOutlets()}>
        <div class="ns-node-outlets">
          <For each={outletDefs()}>
            {(o) => <div class="ns-node-port ns-node-outlet" classList={{ bidi: outletBidi(o.name) }} data-sketchy-node={it().id} data-sketchy-outlet={o.name} data-tip={`${o.name}${o.type ? " : " + o.type : ""}${outletBidi(o.name) ? " ⇄" : ""}`}><PortNub id={it().id} name={o.name} bidi={outletBidi(o.name)} /></div>}
          </For>
        </div>
      </Show>
    </div>
  );
}

function preview(v) {
  if (v == null) return "∅";
  if (typeof v === "number") return String(fmtNum(v)); // round floats for the readout
  if (typeof v === "string") return JSON.stringify(v.length > 24 ? v.slice(0, 24) + "…" : v);
  const d = describeBinary(v); if (d) return d; // a frame/buffer → tag, never stringify
  if (typeof v === "object") { try { const s = JSON.stringify(v, previewReplacer); return s.length > 24 ? s.slice(0, 24) + "…" : s; } catch { return "{…}"; } }
  return String(v);
}
