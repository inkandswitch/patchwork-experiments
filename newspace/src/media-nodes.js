// Media nodes: camera (video + image streams), a video display, and an audio scope
// that draws the live Float32 waveform. These hold opaque handles (a MediaStream, an
// AnalyserNode) on the stream/complement; the JSON-shaped bits travel as values.
import { Source } from "./opstreams.js";
import { myContactUrl } from "./share-session.js";
import { playSharedStream } from "./source-nodes.js";

const isMediaStream = (v) => typeof MediaStream !== "undefined" && v instanceof MediaStream;

// CAMERA — Enable (permission), shows a live preview, and provides:
//   video — the MediaStream (drive a Video display)
//   image — a frame as ImageData (raw RGBA + dims). Captured on a wired `bang`
//           (wire RAF for 60fps, a Timer for slower); with no bang wired,
//           auto-captures ~10fps. Works on RECEIVERS of a shared camera too
//           (frames are grabbed from the received stream at the same cadence).
// NB: wiring the bang re-runs the mount, so wire it BEFORE you Enable the camera.
export function mountCamera({ element, inlets = {}, setOutlet, config = {}, setConfig, onConfig, share: mesh }) {
  const myUrl = myContactUrl();
  let share = config.share === "mine" ? "mine" : "own", owner = config.owner || null;
  const shared = () => share === "mine";
  const amOwner = () => shared() && owner && myUrl && owner === myUrl;
  const receiving = () => shared() && !amOwner(); // someone ELSE shares their camera here

  let media = null, timer = null, off = null, shareStop = null, recvStop = null, disposed = false;
  const root = document.createElement("div"); root.className = "ns-source ns-camera";
  const bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;";
  const btn = document.createElement("button"); btn.className = "ns-source-enable"; btn.textContent = "Enable camera";
  const shareL = document.createElement("label"); shareL.style.cssText = "font:11px ui-monospace,monospace;display:inline-flex;gap:5px;align-items:center;cursor:pointer;";
  const shareCb = document.createElement("input"); shareCb.type = "checkbox"; const shareT = document.createElement("span"); shareL.append(shareCb, shareT);
  const ownerTag = document.createElement("div"); ownerTag.style.cssText = "font:700 12px ui-monospace,monospace;";
  bar.append(btn, shareL, ownerTag);
  const video = document.createElement("video"); video.autoplay = true; video.muted = true; video.playsInline = true; video.style.cssText = "width:100%;height:100%;object-fit:cover;display:none;border-radius:2px;";
  const status = document.createElement("div"); status.className = "ns-source-status";
  root.append(bar, video, status); element.append(root);

  const videoOut = new Source(null), imageOut = new Source(null);
  setOutlet && setOutlet("video", videoOut);
  setOutlet && setOutlet("image", imageOut);
  const canvas = document.createElement("canvas");
  const cctx = canvas.getContext("2d", { willReadFrequently: true }); // cached (per-frame getContext re-warns)

  let ownerName = null;
  const resolveOwnerName = async () => { if (!receiving() || !owner) { ownerName = null; return; } try { const h = window.repo && (await window.repo.find(owner)); ownerName = (h && h.doc().name) || "someone"; } catch { ownerName = "someone"; } };
  const renderShare = () => {
    if (receiving()) { shareL.style.display = "none"; ownerTag.style.display = ""; ownerTag.textContent = `📡 ${ownerName || "…"}’s camera`; btn.style.display = "none"; }
    else { shareL.style.display = ""; ownerTag.style.display = "none"; shareCb.checked = shared(); shareT.textContent = shared() ? "📡 everyone sees yours" : "share to everyone"; btn.style.display = media ? "none" : ""; }
  };

  // capture a frame as ImageData (raw RGBA + dims) — transferable, pixel-inspectable.
  const grabFrame = () => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return;
    canvas.width = w; canvas.height = h;
    cctx.drawImage(video, 0, 0);
    try { imageOut.push(cctx.getImageData(0, 0, w, h)); } catch {}
  };
  const showStream = (s) => { video.srcObject = s; video.style.display = ""; videoOut.push(s); };

  const startOwner = async () => {
    if (media || btn.disabled) return; // already live / a permission prompt is already pending
    btn.disabled = true; // a double-click must not open two streams
    status.textContent = "starting…";
    let ms;
    try { ms = await navigator.mediaDevices.getUserMedia({ video: true }); }
    catch (e) { btn.disabled = false; status.textContent = (e && e.message) || "denied"; return; }
    btn.disabled = false;
    // torn down (or switched to receiving, or raced by another start) while the prompt
    // was pending → stop the tracks NOW, never leave the camera light on
    if (disposed || media || receiving()) { ms.getTracks().forEach((t) => t.stop()); return; }
    media = ms;
    showStream(media); status.textContent = amOwner() ? "📡 live (sharing)" : "live";
    let first = true;
    if (inlets.bang && inlets.bang.connect) off = inlets.bang.connect(() => { if (first) { first = false; return; } if (media) grabFrame(); });
    const loop = () => { if (disposed || !media) { timer = null; return; } if (!(inlets.bang && inlets.bang.wired)) grabFrame(); timer = setTimeout(loop, 100); };
    loop();
    if (amOwner() && mesh && media) { mesh.stream(media); shareStop = () => mesh.unshare(); } // share over the WebRTC mesh
  };
  // receivers grab frames too — the `image` outlet must work on both ends. Mirrors
  // the owner's ~10fps cadence, reading from the same <video> (showStream set it).
  let recvTimer = null;
  const startRecvLoop = () => {
    if (recvTimer) return;
    const loop = () => { if (disposed || !video.srcObject) { recvTimer = null; return; } grabFrame(); recvTimer = setTimeout(loop, 100); };
    loop();
  };
  const startReceiver = () => {
    status.textContent = "receiving shared camera…";
    if (mesh) recvStop = mesh.onStream((s) => { showStream(s); status.textContent = "📡 live (shared)"; startRecvLoop(); });
  };
  const stopShare = () => { if (shareStop) { shareStop(); shareStop = null; } };
  const stopLocal = () => { if (timer) { clearTimeout(timer); timer = null; } if (off) { off(); off = null; } stopShare(); if (media) { media.getTracks().forEach((t) => t.stop()); media = null; } };
  const stopRecv = () => { if (recvStop) { recvStop(); recvStop = null; } if (recvTimer) { clearTimeout(recvTimer); recvTimer = null; } };
  // NON-DESTRUCTIVE: toggling share must NOT kill a running camera — only start/stop the
  // SHARING. We only tear down the camera when switching INTO receive mode.
  const reconcile = () => {
    if (receiving()) {
      stopLocal(); if (!recvStop) startReceiver(); btn.style.display = "none";
    } else {
      if (recvStop) { stopRecv(); video.srcObject = null; video.style.display = "none"; }
      if (media) {
        if (amOwner() && !shareStop && mesh) { mesh.stream(media); shareStop = () => mesh.unshare(); }
        else if (!amOwner()) stopShare();
        status.textContent = amOwner() ? "📡 live (sharing)" : "live";
      } else { btn.style.display = ""; status.textContent = "camera"; }
    }
    renderShare();
  };

  btn.onclick = () => { startOwner().then(renderShare); };
  shareCb.onchange = () => { share = shareCb.checked ? "mine" : "own"; owner = shareCb.checked ? myUrl : null; if (setConfig) setConfig({ share, owner: owner || null }); resolveOwnerName().then(renderShare); reconcile(); };
  if (onConfig) onConfig((c) => { const ns = c.share === "mine" ? "mine" : "own", no = c.owner || null; if (ns === share && no === owner) return; share = ns; owner = no; resolveOwnerName().then(renderShare); reconcile(); });
  resolveOwnerName().then(renderShare); renderShare(); reconcile();

  return () => { disposed = true; stopLocal(); stopRecv(); root.remove(); };
}

// VIDEO display — plays a wired MediaStream (or an image/video url).
export function mountVideo({ element, inlets = {} }) {
  const video = document.createElement("video"); video.autoplay = true; video.muted = true; video.playsInline = true; video.style.cssText = "width:100%;height:100%;object-fit:contain;background:#000;";
  element.append(video);
  const s = inlets.video || inlets.stream || inlets.in;
  const apply = () => {
    const v = s ? s.value : null;
    const ms = isMediaStream(v) ? v : s && s.complement && s.complement.mediaStream;
    if (ms) { if (video.srcObject !== ms) { video.srcObject = ms; video.play && video.play().catch(() => {}); } }
    else if (typeof v === "string" && v) { video.srcObject = null; video.src = v; }
  };
  const off = s && s.connect ? s.connect(apply) : null;
  apply();
  return () => { if (off) off(); video.remove(); };
}

// AUDIO FILE — pick a music file, play it (Web Audio), and emit {time,duration,
// playing,rms,peak} with an AnalyserNode in the complement (for a Scope). Audible.
// STREAM-SHAREABLE like the mic/camera: 👤 own (default — everyone plays their own
// file) ⟷ 📡 mine (the OWNER's playback is captured as a MediaStream and sent over
// the WebRTC mesh; receivers play it + get an analyser on the outlet complement,
// via the same playSharedStream receiver the mic uses).
export function mountAudioFile({ element, setOutlet, config = {}, setConfig, onConfig, share: mesh }) {
  const myUrl = myContactUrl();
  let share = config.share === "mine" ? "mine" : "own", owner = config.owner || null;
  const shared = () => share === "mine";
  const amOwner = () => shared() && owner && myUrl && owner === myUrl;
  const receiving = () => shared() && !amOwner(); // someone ELSE shares their audio here

  const out = new Source(null, { complement: {} });
  setOutlet && setOutlet("audio", out);
  const root = document.createElement("div"); root.className = "ns-source ns-audiofile";
  const file = document.createElement("input"); file.type = "file"; file.accept = "audio/*"; file.className = "ns-text";
  const audio = document.createElement("audio"); audio.controls = true; audio.style.cssText = "width:100%;";
  const bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;";
  const shareL = document.createElement("label"); shareL.style.cssText = "font:11px ui-monospace,monospace;display:inline-flex;gap:5px;align-items:center;cursor:pointer;";
  const shareCb = document.createElement("input"); shareCb.type = "checkbox"; const shareT = document.createElement("span"); shareL.append(shareCb, shareT);
  const ownerTag = document.createElement("div"); ownerTag.style.cssText = "font:700 12px ui-monospace,monospace;";
  bar.append(shareL, ownerTag);
  const status = document.createElement("div"); status.className = "ns-source-status";
  root.append(file, audio, bar, status); element.append(root);

  let ctx = null, analyser = null, raf = null, wired = false, shareStop = null, recvStop = null, playStop = null;
  let shareDest = null; // the CURRENT share tap (analyser → MediaStreamDestination) — disconnected on stopShare, or re-shares pile taps onto the analyser

  // OWNER capture: prefer a web-audio tap off the analyser once the graph exists
  // (createMediaElementSource reroutes the element's output, so captureStream()
  // can go silent after setup); before the graph, fall back to captureStream().
  const captureShareStream = () => {
    try {
      if (ctx && analyser) { shareDest = ctx.createMediaStreamDestination(); analyser.connect(shareDest); return shareDest.stream; }
      const cap = audio.captureStream || audio.mozCaptureStream;
      return cap ? cap.call(audio) : null;
    } catch { return null; }
  };
  const stopShare = () => {
    if (shareStop) { shareStop(); shareStop = null; }
    if (shareDest) { try { if (analyser) analyser.disconnect(shareDest); } catch {} shareDest = null; }
  };
  const startShare = () => { if (shareStop || !mesh) return; const ms = captureShareStream(); if (ms) { mesh.stream(ms); shareStop = () => mesh.unshare(); } };
  const stopRecv = () => { if (recvStop) { recvStop(); recvStop = null; } if (playStop) { playStop(); playStop = null; } };
  const startRecv = () => {
    status.textContent = "receiving shared audio…";
    if (mesh) recvStop = mesh.onStream((s) => {
      if (playStop) { playStop(); playStop = null; } // a re-shared stream replaces the previous receiver
      playStop = playSharedStream(s, { root, out });
      out.push({ shared: true }); status.textContent = "📡 (shared audio)";
    });
  };

  const setup = () => {
    if (wired) return; wired = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    const src = ctx.createMediaElementSource(audio);
    analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
    src.connect(analyser); analyser.connect(ctx.destination); // audible
    Object.assign(out.complement, { audioContext: ctx, analyser });
    if (amOwner()) { stopShare(); startShare(); } // re-tap through the fresh graph
    const buf = new Float32Array(analyser.fftSize);
    const tick = () => {
      analyser.getFloatTimeDomainData(buf);
      let s = 0, p = 0; for (const v of buf) { s += v * v; if (Math.abs(v) > p) p = Math.abs(v); }
      out.push({ time: audio.currentTime, duration: audio.duration || 0, playing: !audio.paused, rms: Math.sqrt(s / buf.length), peak: p });
      raf = requestAnimationFrame(tick);
    };
    tick();
  };

  let ownerName = null;
  const resolveOwnerName = async () => { if (!receiving() || !owner) { ownerName = null; return; } try { const h = window.repo && (await window.repo.find(owner)); ownerName = (h && h.doc().name) || "someone"; } catch { ownerName = "someone"; } };
  const renderShare = () => {
    if (receiving()) { shareL.style.display = "none"; ownerTag.style.display = ""; ownerTag.textContent = `📡 ${ownerName || "…"}’s audio`; file.style.display = "none"; audio.style.display = "none"; }
    else { shareL.style.display = ""; ownerTag.style.display = "none"; shareCb.checked = shared(); shareT.textContent = shared() ? "📡 everyone hears yours" : "share to everyone"; file.style.display = ""; audio.style.display = ""; }
  };
  // NON-DESTRUCTIVE like the camera: toggling share only starts/stops the SHARING;
  // local playback is only paused when switching INTO receive mode.
  const reconcile = () => {
    if (receiving()) { stopShare(); try { audio.pause(); } catch {} if (!recvStop) startRecv(); }
    else { if (recvStop) stopRecv(); if (amOwner()) startShare(); else stopShare(); }
    renderShare();
  };
  shareCb.onchange = () => { share = shareCb.checked ? "mine" : "own"; owner = shareCb.checked ? myUrl : null; if (setConfig) setConfig({ share, owner: owner || null }); resolveOwnerName().then(renderShare); reconcile(); };
  if (onConfig) onConfig((c) => { const ns = c.share === "mine" ? "mine" : "own", no = c.owner || null; if (ns === share && no === owner) return; share = ns; owner = no; resolveOwnerName().then(renderShare); reconcile(); });

  let objectUrl = null; // revoked on re-pick + disposal (blob URLs otherwise pin the file in memory)
  file.onchange = () => { const f = file.files && file.files[0]; if (!f) return; if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch {} } objectUrl = URL.createObjectURL(f); audio.src = objectUrl; status.textContent = f.name; };
  audio.onplay = () => { setup(); if (ctx && ctx.state === "suspended") ctx.resume(); };
  resolveOwnerName().then(renderShare); renderShare(); reconcile();
  return () => { if (raf) cancelAnimationFrame(raf); if (ctx) ctx.close().catch(() => {}); stopShare(); stopRecv(); if (objectUrl) { try { URL.revokeObjectURL(objectUrl); } catch {} } root.remove(); };
}

// SPEAKER — plays a wired audio source through the speakers, via its OWN GainNode
// (analyser → gain → destination). For sources that don't self-play, e.g. the mic.
// The gain matters at teardown: the source may have its own analyser→destination
// connection (the audio-file node is audible by itself), and Web Audio dedupes a
// double-connect — so disconnecting analyser→destination directly would sever the
// source's audible path too, permanently muting it. Tearing down only OUR gain
// removes exactly what this node added.
export function mountSpeaker({ element, inlets = {} }) {
  const root = document.createElement("div"); root.className = "ns-source";
  const status = document.createElement("div"); status.className = "ns-source-status"; status.textContent = "wire an audio source";
  root.append(status); element.append(root);
  const s = inlets.audio || inlets.in;
  let connected = false, gain = null, tapped = null; // tapped = the analyser OUR gain hangs off
  const connect = () => {
    const c = s && s.complement;
    if (connected || !c || !c.analyser || !c.audioContext) return;
    try {
      gain = c.audioContext.createGain();
      c.analyser.connect(gain);
      gain.connect(c.audioContext.destination);
      tapped = c.analyser;
      connected = true; status.textContent = "▶ playing";
    } catch {}
  };
  const off = s && s.connect ? s.connect(connect) : null;
  connect();
  return () => {
    if (off) off();
    try { if (connected && gain) { if (tapped) tapped.disconnect(gain); gain.disconnect(); } } catch {}
    root.remove();
  };
}

// IMAGE display — paints a wired frame to a canvas. Accepts ImageData (raw pixels),
// an ImageBitmap, or a url / data-url string.
export function mountImage({ element, inlets = {} }) {
  const canvas = document.createElement("canvas"); canvas.style.cssText = "width:100%;height:100%;object-fit:contain;display:block;background:#111;";
  element.append(canvas);
  const s = inlets.image || inlets.in;
  let gen = 0; // generation token: an async url load only paints if still the LATEST draw
  const draw = () => {
    const v = s ? s.value : null;
    const g = ++gen;
    const ctx = canvas.getContext("2d");
    if (typeof ImageData !== "undefined" && v instanceof ImageData) { canvas.width = v.width; canvas.height = v.height; ctx.putImageData(v, 0, 0); }
    else if (typeof ImageBitmap !== "undefined" && v instanceof ImageBitmap) { canvas.width = v.width; canvas.height = v.height; ctx.drawImage(v, 0, 0); }
    else if (typeof v === "string" && v) { const img = new Image(); img.onload = () => { if (g !== gen) return; canvas.width = img.naturalWidth; canvas.height = img.naturalHeight; canvas.getContext("2d").drawImage(img, 0, 0); }; img.src = v; }
  };
  const off = s && s.connect ? s.connect(draw) : null;
  draw();
  return () => { if (off) off(); canvas.remove(); };
}

// PIXELS — paint a raw typed-array / Float32 pixel buffer to a canvas. Accepts:
//   • an ImageData                                        → drawn as-is
//   • { data, width, height, channels? }                  → built from its dims
//   • a bare TypedArray / ArrayBuffer (+ config w/h/chan) → built from config
// Channels 1=gray, 2=gray+alpha, 3=rgb, 4=rgba (inferred from length if absent).
// FLOAT buffers are scaled to 0..255: unit (×255) when values are in 0..1, else an
// auto min–max stretch (or forced via config.normalize "unit"|"byte"|"auto").
// Pure + dependency-free → testable; returns { data: Uint8ClampedArray(RGBA), width, height }.
export function pixelsToRGBA(value, config = {}) {
  if (value == null) return null;
  if (typeof ImageData !== "undefined" && value instanceof ImageData) return { data: value.data, width: value.width, height: value.height };
  let data = value, width = config.width | 0, height = config.height | 0, channels = config.channels | 0;
  if (value instanceof ArrayBuffer) data = new Uint8Array(value);
  else if (!ArrayBuffer.isView(value) && typeof value === "object") {
    data = value.data instanceof ArrayBuffer ? new Uint8Array(value.data) : value.data;
    width = (value.width | 0) || width; height = (value.height | 0) || height; channels = (value.channels | 0) || channels;
  }
  if (!ArrayBuffer.isView(data)) return null;
  const N = data.length;
  if (!width || !height) { // infer a square if we can
    const px = Math.floor(N / (channels || 4));
    const side = Math.round(Math.sqrt(px));
    if (side > 0 && side * side === px) { width = width || side; height = height || side; }
    else return null;
  }
  channels = channels || Math.max(1, Math.round(N / (width * height)));
  const isFloat = data instanceof Float32Array || data instanceof Float64Array;
  let scale = 1, offset = 0;
  if (isFloat) {
    const mode = config.normalize || "auto";
    if (mode === "unit") scale = 255;
    else if (mode !== "byte") { // auto
      let min = Infinity, max = -Infinity;
      for (let i = 0; i < N; i++) { const v = data[i]; if (v < min) min = v; if (v > max) max = v; }
      if (max <= 1 && min >= 0) scale = 255;
      else { offset = -min; scale = 255 / ((max - min) || 1); }
    }
  }
  const conv = isFloat ? (v) => (v + offset) * scale : (v) => v;
  const out = new Uint8ClampedArray(width * height * 4);
  const wh = width * height;
  for (let p = 0; p < wh; p++) {
    const base = p * channels, o = p * 4;
    let r, g, b, a = 255;
    if (channels === 1) r = g = b = conv(data[base]);
    else if (channels === 2) { r = g = b = conv(data[base]); a = conv(data[base + 1]); }
    else { r = conv(data[base]); g = conv(data[base + 1]); b = conv(data[base + 2]); if (channels >= 4) a = conv(data[base + 3]); }
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = a;
  }
  return { data: out, width, height };
}

export function mountPixels({ element, inlets = {}, config = {}, setConfig }) {
  const root = document.createElement("div"); root.className = "ns-source ns-pixels";
  const canvas = document.createElement("canvas"); canvas.style.cssText = "width:100%;flex:1;min-height:0;object-fit:contain;display:block;background:#111;image-rendering:pixelated;";
  const bar = document.createElement("div"); bar.style.cssText = "display:flex;gap:4px;align-items:center;flex-wrap:wrap;";
  const cfg = { width: config.width | 0, height: config.height | 0, channels: config.channels | 0, normalize: config.normalize || "auto" };
  const numField = (key, ph) => { const i = document.createElement("input"); i.type = "number"; i.min = "0"; i.placeholder = ph; i.className = "ns-text"; i.style.cssText = "width:54px;"; if (cfg[key]) i.value = cfg[key]; i.oninput = () => { cfg[key] = i.value | 0; if (setConfig) setConfig({ [key]: cfg[key] }); draw(); }; return i; };
  const norm = document.createElement("select"); norm.className = "ns-text"; for (const o of ["auto", "unit", "byte"]) { const op = document.createElement("option"); op.value = op.textContent = o; norm.append(op); } norm.value = cfg.normalize;
  norm.onchange = () => { cfg.normalize = norm.value; if (setConfig) setConfig({ normalize: norm.value }); draw(); };
  bar.append(numField("width", "w"), numField("height", "h"), numField("channels", "ch"), norm);
  const status = document.createElement("div"); status.className = "ns-source-status";
  root.append(canvas, bar, status); element.append(root);

  const s = inlets.pixels || inlets.in;
  const draw = () => {
    const rgba = pixelsToRGBA(s ? s.value : null, cfg);
    if (!rgba) { status.textContent = "wire a pixel buffer (set w/h for a bare array)"; return; }
    canvas.width = rgba.width; canvas.height = rgba.height;
    const ctx = canvas.getContext("2d");
    if (typeof ImageData !== "undefined") ctx.putImageData(new ImageData(rgba.data, rgba.width, rgba.height), 0, 0);
    status.textContent = `${rgba.width}×${rgba.height}`;
  };
  const off = s && s.connect ? s.connect(draw) : null;
  draw();
  return () => { if (off) off(); root.remove(); };
}

// SCOPE — draws the live Float32 time-domain waveform from a wired audio source
// (reads `complement.analyser`, e.g. from the mic).
export function mountScope({ element, inlets = {} }) {
  const canvas = document.createElement("canvas"); canvas.className = "ns-scope"; canvas.style.cssText = "width:100%;height:100%;display:block;";
  element.append(canvas);
  const s = inlets.audio || inlets.in;
  let raf = null, buf = null;
  const draw = () => {
    const a = s && s.complement && s.complement.analyser;
    const W = canvas.width = canvas.clientWidth || 240, H = canvas.height = canvas.clientHeight || 100;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    if (a) {
      if (!buf || buf.length !== a.fftSize) buf = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(buf);
      ctx.beginPath(); ctx.strokeStyle = "#ff2284"; ctx.lineWidth = 2;
      for (let i = 0; i < buf.length; i++) { const x = (i / buf.length) * W, y = (0.5 - buf[i] * 0.5) * H; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
      ctx.stroke();
    }
    raf = requestAnimationFrame(draw);
  };
  raf = requestAnimationFrame(draw);
  return () => { if (raf) cancelAnimationFrame(raf); canvas.remove(); };
}
