// Mount functions for SOURCE nodes (no inlets, one outlet). A source's Source is
// created synchronously by its factory, exposed on the outlet immediately, then
// fed by the device. The node UI is a tiny live readout (and, for the file source,
// a picker button). See src/sources.js for the device factories.
import { pickFile, fileHandleOpstream, watchFileStream, fileSnapshot } from "./fs-opstream.js";
import { Source, automergeOpstream, apply } from "./opstreams.js";
import { snapshot, isSnapshot, valuesEqual, fmtNum, previewReplacer } from "./ops.js";

// Resolve an automerge:url[#path] → an editable opstream. Prefer window.repo (always
// present per the host globals) so a source works even before ctx.api is ready;
// fall back to the sketchy api's protocol find.
async function resolveDoc(url, api) {
  url = (url || "").trim();
  if (!url) return null;
  const repo = typeof window !== "undefined" && window.repo;
  if (repo && repo.find) {
    const [base, frag] = url.split("#");
    const path = frag ? frag.split("/").filter(Boolean) : [];
    const h = await repo.find(base);
    return automergeOpstream(h, { path });
  }
  if (api && api.find) return api.find(url);
  return null;
}

function preview(v) {
  if (v == null) return "…";
  if (typeof v === "string") return v.length > 28 ? v.slice(0, 28) + "…" : v;
  if (typeof v === "number") return String(fmtNum(v)); // round floats for the readout
  try { const s = JSON.stringify(v, previewReplacer); return s.length > 40 ? s.slice(0, 40) + "…" : s; } catch { return "{…}"; }
}

// the automerge source: type an automerge: url, get the doc as an opstream on `doc`
// (resolved via the sketchy api's protocol `find`). The whole doc flows out — wire it
// into json-path / inspector / a patchwork-tool. The url rides in the complement.
export function mountAutomergeSource({ element, setOutlet, api, config = {}, setConfig, onConfig }) {
  let off = null, curUrl = null;
  const root = document.createElement("div");
  root.className = "ns-source";
  const input = document.createElement("input");
  input.className = "ns-text";
  input.placeholder = "automerge:… ↵";
  const newBtn = document.createElement("button");
  newBtn.className = "ns-source-enable";
  newBtn.textContent = "+ new";
  newBtn.title = "create a fresh empty automerge doc and use it";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:6px;align-items:center;";
  bar.append(input, newBtn);
  const status = document.createElement("div");
  status.className = "ns-source-status";
  root.append(bar, status);
  element.append(root);

  // wire an opstream up to the outlet + persist its url + show a readout
  const useStream = (stream, url) => {
    if (!stream) { status.textContent = "not found"; return; }
    if (off) { off(); off = null; }
    curUrl = url;
    if (setOutlet) setOutlet("doc", stream);
    if (setConfig) setConfig({ url });
    const render = () => { const d = stream.value; status.textContent = url.replace(/^automerge:/, "").slice(0, 10) + (d && d.title ? ` · ${d.title}` : ""); };
    render();
    off = stream.connect ? stream.connect(render) : null;
  };

  newBtn.onclick = async () => {
    const repo = typeof window !== "undefined" && window.repo;
    if (!repo) { status.textContent = "no repo"; return; }
    status.textContent = "creating…";
    // use the freshly-created HANDLE directly — re-finding it by url races and reports
    // "unavailable" for a doc that obviously exists.
    try { const h = await repo.create2({}); input.value = h.url; useStream(automergeOpstream(h), h.url); } catch (e) { status.textContent = (e && e.message) || "failed"; }
  };

  const open = async (url) => {
    url = (url || "").trim();
    if (!url) return;
    status.textContent = "loading…";
    let stream;
    try { stream = await resolveDoc(url, api); } catch (e) { status.textContent = (e && e.message) || "not found"; return; }
    useStream(stream, url);
  };
  input.onkeydown = (e) => { if (e.key === "Enter") open(input.value); };
  if (config.url) { input.value = config.url; open(config.url); } // restore persisted url
  // REACT to config.url set from OUTSIDE (e.g. a doc dropped onto this node) — adopt it live
  if (onConfig) onConfig((c) => { if (c.url && c.url !== curUrl) { input.value = c.url; open(c.url); } });

  return () => { if (off) off(); root.remove(); };
}

// BANG — a momentary trigger (PD/Max/Orca). Each fire pushes a UNIQUE value (a
// counter) so it always propagates downstream even though "nothing changed" — that's
// the point of an event. Click the button; wire its `bang` to something triggerable.
export function mountBang({ element, setOutlet }) {
  let n = 0;
  const out = new Source(0);
  if (setOutlet) setOutlet("bang", out);
  const root = document.createElement("div"); root.className = "ns-source ns-bang";
  const btn = document.createElement("button"); btn.className = "ns-bang-btn"; btn.textContent = "BANG";
  btn.onclick = () => { out.push(++n); btn.classList.add("hit"); setTimeout(() => btn.classList.remove("hit"), 90); };
  root.append(btn); element.append(root);
  return () => root.remove();
}

// TIMER — fires a bang on an interval (a metronome). Interval persisted; run/pause.
export function mountTimer({ element, setOutlet, config = {}, setConfig }) {
  let n = 0, id = null;
  let ms = Number(config.ms) > 0 ? Number(config.ms) : 1000;
  const out = new Source(0);
  if (setOutlet) setOutlet("bang", out);
  const root = document.createElement("div"); root.className = "ns-source ns-timer";
  const input = document.createElement("input"); input.className = "ns-text"; input.type = "number"; input.min = "16"; input.value = String(ms); input.style.width = "5em";
  const run = document.createElement("button"); run.className = "ns-source-enable";
  const status = document.createElement("div"); status.className = "ns-source-status";
  const bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:6px;align-items:center;"; bar.append(input, document.createTextNode("ms"), run);
  root.append(bar, status); element.append(root);
  const stop = () => { if (id) clearInterval(id); id = null; run.textContent = "▶ run"; };
  const start = () => { stop(); id = setInterval(() => { out.push(++n); status.textContent = `bang ${n}`; }, ms); run.textContent = "⏸ stop"; };
  input.onchange = () => { ms = Math.max(16, Number(input.value) || 1000); if (setConfig) setConfig({ ms }); if (id) start(); };
  run.onclick = () => (id ? stop() : start());
  if (config.running !== false) start();
  return () => { stop(); root.remove(); };
}

// a NEW-DOC source/store: create a fresh empty automerge doc and emit it as an
// EDITABLE (read/write) opstream on `doc` — a shared sync point you can wire both
// into and out of. The created doc's url is persisted (config) so it's stable.
export function mountNewDoc({ element, setOutlet, api, config = {}, setConfig }) {
  let off = null;
  const root = document.createElement("div");
  root.className = "ns-source ns-newdoc";
  const status = document.createElement("div");
  status.className = "ns-source-status";
  root.append(status);
  element.append(root);

  (async () => {
    try {
      let url = config.url;
      if (!url) {
        const repo = typeof window !== "undefined" && window.repo;
        if (!repo) { status.textContent = "no repo"; return; }
        const h = await repo.create2({});
        url = h.url;
        if (setConfig) setConfig({ url });
      }
      const stream = await resolveDoc(url, api);
      if (!stream) { status.textContent = "no repo"; return; }
      if (setOutlet) setOutlet("doc", stream);
      const render = () => { status.textContent = "◎ " + url.replace(/^automerge:/, "").slice(0, 8); };
      render();
      off = stream.connect ? stream.connect(render) : null;
    } catch (e) { status.textContent = (e && e.message) || "failed"; }
  })();

  return () => { if (off) off(); root.remove(); };
}

// a RAW VALUE source: type a literal (text/number/boolean/json) → emit it on
// `value`. Persisted in config so it survives reload. The universal "constant" you
// can feed into any inlet.
function coerce(raw, type) {
  if (type === "number") { const n = Number(raw); return Number.isFinite(n) ? n : 0; }
  if (type === "boolean") return raw === "true" || raw === true;
  if (type === "json") { try { return JSON.parse(raw); } catch { return null; } }
  return raw == null ? "" : String(raw);
}
// inverse of coerce: a typed value → the raw text shown in the input (for write-back).
function uncoerce(v, type) {
  if (type === "json") { try { return JSON.stringify(v); } catch { return ""; } }
  return v == null ? "" : String(v);
}
export function mountRawValue({ element, setOutlet, config = {}, setConfig }) {
  let raw = config.raw != null ? config.raw : "";
  let type = config.kind || "text";
  const out = new Source(coerce(raw, type));
  if (setOutlet) setOutlet("value", out);

  const root = document.createElement("div");
  root.className = "ns-source ns-rawvalue";
  const sel = document.createElement("select");
  sel.className = "ns-text";
  for (const t of ["text", "number", "boolean", "json"]) { const o = document.createElement("option"); o.value = t; o.textContent = t; if (t === type) o.selected = true; sel.append(o); }
  const input = document.createElement("input");
  input.className = "ns-text";
  input.placeholder = "value";
  input.value = raw;
  const status = document.createElement("div");
  status.className = "ns-source-status";
  root.append(sel, input, status);
  element.append(root);

  const update = () => {
    raw = input.value; type = sel.value;
    const v = coerce(raw, type);
    out.push(v);
    status.textContent = `${type}: ${JSON.stringify(v)}`;
    if (setConfig) setConfig({ raw, kind: type });
  };
  input.oninput = update;
  sel.onchange = update;
  update();

  // BIDI: a raw value is now WRITABLE — when something downstream writes back through the
  // wire (the wire's `apply` chains here), reflect it into the value + the input + config.
  // Having `apply` is also what makes the wire render bidi (a diamond, not a chevron).
  out.apply = (op) => {
    const v = isSnapshot(op) ? op.value : apply(out.value, op);
    if (valuesEqual(v, out.value)) return; // idempotent — write-backs can't loop
    raw = uncoerce(v, type);
    input.value = raw;
    out.push(v);
    status.textContent = `${type}: ${JSON.stringify(v)}`;
    if (setConfig) setConfig({ raw, kind: type });
  };

  return () => { root.remove(); };
}

// generic device-source mount: `start()` returns `{stream, stop}` synchronously
// (the stream already exists), which we register on `outlet` and read for a readout.
// the canvas CONTEXT as a source: camera/pointer/tool/brush/selection are Sources on
// `api.context` (set up by the canvas). A context source node forwards one of them —
// and, like any source, can be switched 👤 own ⟷ 📡 mine (share your pointer/tool/etc).
export const contextStart = (name) => ({ api }) => {
  const ctx = api && api.context;
  // the ACTIVE BRUSH bundles the brush config + the current TOOL (the tool is part of
  // "what you're drawing with", so they're one source).
  if (name === "brush" && ctx) {
    const out = new Source(null);
    const update = () => out.push({ tool: ctx.tool && ctx.tool.value, ...(ctx.brush && ctx.brush.value) });
    update();
    const offs = [];
    if (ctx.brush && ctx.brush.connect) offs.push(ctx.brush.connect(update));
    if (ctx.tool && ctx.tool.connect) offs.push(ctx.tool.connect(update));
    return { stream: out, stop: () => offs.forEach((o) => o && o()) };
  }
  const src = ctx && ctx[name];
  return { stream: src || new Source(null), stop() {} };
};

export function makeSourceMount({ start, outlet, label, gated, stream: isStream, shareable }) {
  return function mount({ element, outlets, setOutlet, config = {}, setConfig, onConfig, api, share: mesh, shareDoc, onShared }) {
    const root = document.createElement("div");
    root.className = "ns-source";
    const status = document.createElement("div");
    status.className = "ns-source-status";
    status.textContent = label;

    // ONE published outlet (wireable before the device starts). The device — or, when
    // shared, the OWNER's broadcast — forwards into it.
    const out = new Source(null);
    if (setOutlet) setOutlet(outlet, out); else if (outlets) outlets[outlet] = out;

    // SHARING: a user-local source can be "own" (each viewer sees their own device,
    // default) or "mine" (the owner broadcasts THEIR device so everyone sees it). The
    // owner runs the device + broadcasts; everyone else just receives. (presence-only.)
    const myUrl = (() => { try { return window.accountDocHandle.doc().contactUrl || null; } catch { return null; } })();
    let share = config.share === "mine" ? "mine" : "own";
    let owner = config.owner || null;
    const shared = () => share === "mine";
    const amOwner = () => shared() && owner && myUrl && owner === myUrl;

    let active = null, off = null, offRecv = null, enabled = !gated, shareStop = null, streamRecvStop = null, sharedAudio = null, lastW = 0, wT = null;
    // throttle the owner's value→doc writes so a 60fps source doesn't churn the CRDT
    let wrote = 0;
    const shareValueDoc = (v) => { if (!shareDoc) return; const now = Date.now(); clearTimeout(wT); const gap = now - lastW; const write = (val) => { lastW = Date.now(); shareDoc(val); if (!wrote++) console.log(`[share:${label}] writing item.shared → doc (owner)`); }; if (gap >= 150) write(v); else wT = setTimeout(() => write(active && active.stream.value), 150 - gap); };
    // RECEIVE the shared value from the top-level doc field (reliable, reactive like x/y)
    if (onShared) onShared((v) => { if (shared() && !amOwner() && v != null) { out.push(v); status.textContent = `${label} (shared) ▸ ${preview(v)}`; } });
    const stopDevice = () => { if (off) { off(); off = null; } clearTimeout(wT); if (shareStop) { shareStop(); shareStop = null; } if (active && active.stop) { try { active.stop(); } catch {} } active = null; };
    const stopRecv = () => { if (offRecv) { offRecv(); offRecv = null; } if (streamRecvStop) { streamRecvStop(); streamRecvStop = null; } if (sharedAudio) { try { sharedAudio.remove(); } catch {} sharedAudio = null; } };

    const runDevice = () => {
      try { active = start({ element, api }); } catch (e) { status.textContent = `${label}: ${(e && e.message) || e}`; return; }
      if (!active) { status.textContent = `${label}: unavailable`; return; }
      // OWNER → write each value into the DOC (config.sharedValue), throttled. The doc
      // syncs reliably (it's how the share TOGGLE itself propagates), so receivers always
      // get it — no dependence on a WebRTC connection. (Streams still need WebRTC below.)
      const fwd = () => {
        const v = active.stream.value;
        out.push(v);
        status.textContent = `${label}${amOwner() ? " 📡" : ""} ▸ ${preview(v)}`;
        if (amOwner()) shareValueDoc(v);
      };
      fwd();
      off = active.stream.connect ? active.stream.connect(fwd) : null;
      // a STREAM source (mic) shared as OWNER also sends its MediaStream (tracks) so
      // receivers HEAR it (not just see levels).
      if (isStream && amOwner() && mesh) {
        const ms = active.stream.complement && active.stream.complement.mediaStream;
        if (ms) { mesh.stream(ms); shareStop = () => mesh.unshare(); }
      }
    };
    const recvShared = () => {
      // VALUES arrive via the doc (config.sharedValue, handled in onConfig). Only STREAMS
      // use the WebRTC mesh below.
      status.textContent = `${label} — receiving shared…`;
      // a STREAM source: also receive the owner's MediaStream, PLAY it + expose an analyser
      // on the outlet complement (so a wired scope works on the shared audio).
      if (isStream && mesh) {
        streamRecvStop = mesh.onStream((s) => {
          try { sharedAudio = document.createElement("audio"); sharedAudio.autoplay = true; sharedAudio.srcObject = s; root.append(sharedAudio); } catch {}
          try { const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC(); const an = ac.createAnalyser(); an.fftSize = 1024; ac.createMediaStreamSource(s).connect(an); out.complement = { ...(out.complement || {}), mediaStream: s, analyser: an, audioContext: ac }; } catch {}
          out.push({ shared: true }); status.textContent = `${label} 📡 (shared audio)`;
        });
      }
    };
    // pick the right mode: a shared non-owner RECEIVES; otherwise run the device (once enabled)
    const reconcile = () => {
      stopDevice(); stopRecv();
      if (shared() && !amOwner()) { recvShared(); return; }
      if (enabled) runDevice(); else status.textContent = label;
    };

    // resolve the owner's display name (a contactUrl → their contact doc's name)
    let ownerName = null;
    const resolveOwnerName = async () => {
      if (!shared() || !owner) { ownerName = null; return; }
      if (owner === myUrl) { ownerName = "you"; return; }
      try { const repo = window.repo; const h = repo && (await repo.find(owner)); ownerName = (h && h.doc().name) || "someone"; } catch { ownerName = "someone"; }
    };

    // SHARE control. A receiver (shared + not the owner) gets a READ-ONLY "📡 chee's"
    // label — they must not be able to flip the shared config. Otherwise a checkbox
    // toggles whether YOU broadcast (taking "mine" makes you the owner).
    const shareLabel = document.createElement("label"); shareLabel.style.cssText = "font:11px ui-monospace,monospace;display:inline-flex;gap:5px;align-items:center;cursor:pointer;";
    const shareCb = document.createElement("input"); shareCb.type = "checkbox";
    const shareText = document.createElement("span");
    shareLabel.append(shareCb, shareText);
    const ownerTag = document.createElement("div"); ownerTag.className = "ns-source-owner"; ownerTag.style.cssText = "font:700 12px ui-monospace,monospace;";
    let enableBtn = null; // a gated source's Enable button (only relevant when YOU run the device)
    const renderShare = () => {
      const receiving = shared() && !amOwner();
      if (receiving) { shareLabel.style.display = "none"; ownerTag.style.display = ""; ownerTag.textContent = `📡 ${ownerName || "…"}’s`; }
      else { shareLabel.style.display = ""; ownerTag.style.display = "none"; shareCb.checked = shared(); shareText.textContent = shared() ? "📡 everyone sees yours" : "share to everyone"; }
      if (enableBtn) enableBtn.style.display = receiving || enabled ? "none" : ""; // receivers never enable a device
    };
    shareCb.onchange = () => { share = shareCb.checked ? "mine" : "own"; owner = shareCb.checked ? myUrl : null; console.log(`[share:${label}] TOGGLE → ${share}, owner=${(owner || "").slice(-6)} (myUrl=${(myUrl || "null").slice(-6)})`); if (setConfig) setConfig({ share, owner: owner || null }); resolveOwnerName().then(renderShare); reconcile(); };
    resolveOwnerName().then(renderShare);
    renderShare();

    const bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;";
    if (gated) {
      enableBtn = document.createElement("button");
      enableBtn.className = "ns-source-enable";
      enableBtn.textContent = `Enable ${label}`;
      enableBtn.onclick = () => { enabled = true; renderShare(); reconcile(); };
      bar.append(enableBtn);
    }
    bar.append(shareLabel, ownerTag);
    root.append(bar, status);
    element.append(root);
    renderShare();
    reconcile();

    // react when the share mode / owner changes in the DOC (another viewer flips it to
    // "everyone sees mine") — switch this node between running its own device and
    // receiving the owner's broadcast, live, without a remount.
    if (onConfig) onConfig((c) => {
      // the MODE (share/owner) lives in config; the VALUE rides item.shared (see onShared).
      const ns = c.share === "mine" ? "mine" : "own";
      const no = c.owner || null;
      if (ns === share && no === owner) return;
      console.log(`[share:${label}] mode → ${ns}${no ? " owner=" + no.slice(-6) : ""}${ns === "mine" ? (no === myUrl ? " (me)" : " (receiving)") : ""}`);
      share = ns; owner = no;
      resolveOwnerName().then(renderShare);
      renderShare(); reconcile();
    });

    return () => { stopDevice(); stopRecv(); root.remove(); };
  };
}

// the file source: a picker button, then a read-only watching File Source on the
// `file` outlet (kept fresh as the file changes on disk). The Source is created on
// pick; until then the outlet is absent (nothing to provide yet).
// Three outlets, kept fresh by watching the disk:
//   text  — the file's text, EDITABLE + carries save() (saveable downstream)
//   bytes — the raw Uint8Array
//   file  — a {name,type,size,…,text} snapshot that tracks the editable text
export function mountFileSource({ element, outlets, setOutlet }) {
  const offs = [], stops = [];
  const expose = (name, s) => { if (setOutlet) setOutlet(name, s); else if (outlets) outlets[name] = s; };
  const root = document.createElement("div");
  root.className = "ns-source";
  const btn = document.createElement("button");
  btn.className = "ns-source-enable";
  btn.textContent = "Open file…";
  const status = document.createElement("div");
  status.className = "ns-source-status";
  root.append(btn, status);
  element.append(root);

  btn.onclick = async () => {
    status.textContent = "opening…";
    let handle;
    try { handle = await pickFile(); } catch (e) { status.textContent = e && e.message; return; }
    if (!handle) { status.textContent = "cancelled"; return; }

    // text: an editable opstream (save() in its complement), reloaded unless dirty
    const text = await fileHandleOpstream(handle);
    stops.push(watchFileStream(text, {}));
    expose("text", text);

    const file = await handle.getFile();
    try { expose("bytes", new Source(new Uint8Array(await file.arrayBuffer()), { complement: { fileHandle: handle, name: file.name } })); } catch {}
    // file: a metadata snapshot that's EDITABLE AT `.text` — writing the text field
    // forwards to the editable text stream (so File→JSONPath ".text"→Code is editable),
    // and it carries save() (so Cmd+S persists). Metadata fields stay read-only.
    const read = () => fileSnapshot(file, text.value);
    const snap = {
      get value() { return read(); },
      get complement() { return { fileHandle: handle, file, save: text.complement.save }; },
      connect(cb) { cb(snapshot(read())); return text.connect ? text.connect(() => cb(snapshot(read()))) : () => {}; },
      apply(op) {
        if (!op) return;
        if (op.type === "snapshot") { const v = op.value; if (v && typeof v.text === "string") text.apply(snapshot(v.text)); return; }
        if ((op.path || []).length === 0 && op.range === "text") text.apply(snapshot(op.value)); // write .text through
      },
    };
    expose("file", snap);

    // dirty tracking + a Save affordance (the file's been edited downstream)
    const saveBtn = document.createElement("button");
    saveBtn.className = "ns-source-enable";
    saveBtn.textContent = "Save";
    saveBtn.style.display = "none";
    saveBtn.onclick = async () => { try { await text.complement.save(); } catch {} refresh(); };
    root.append(saveBtn);
    const refresh = () => {
      const dirty = text.value !== text.complement.diskText;
      saveBtn.style.display = dirty ? "" : "none";
      status.textContent = `${file.name} · ${file.size}b${dirty ? " · edited" : ""}`;
    };
    offs.push(text.connect(refresh));
    refresh();
    btn.textContent = "Change file…";
  };

  return () => { offs.forEach((o) => o && o()); stops.forEach((s) => s && s()); root.remove(); };
}
