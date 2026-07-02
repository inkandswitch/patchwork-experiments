// Web-platform SOURCES — a Source is a node with NO inlets that produces a live
// stream. Each factory returns `{ stream, stop }` with the Source created
// SYNCHRONOUSLY (so a node can register it as an outlet immediately) and the
// device wired up to push into it. `stop()` tears the device down.
//
// These are deliberately thin: they snapshot the platform object into a plain,
// JSON-shaped value (lens-friendly) and push it. The heavy/opaque handle (a
// MediaStream, a MIDIAccess) rides in the complement when it can't be serialised.
//
// On collaboration: a source is local to the viewer who placed it (each reads
// their OWN gamepad/mic). Sharing one source's stream to peers — or letting two
// people drive the same logical controller — routes through presence, not here;
// that's the "should this be owned, or shared?" question left open in NODES.md.
import { Source } from "./opstreams.js";

// a wall clock — pushes the epoch ms every tick
export function clockSource({ intervalMs = 1000 } = {}) {
  const stream = new Source(Date.now());
  let id = typeof setInterval === "function" ? setInterval(() => stream.push(Date.now()), intervalMs) : null;
  return { stream, stop: () => { if (id) clearInterval(id); } };
}

// a per-animation-frame bang (~60fps) — a unique counter each frame so it always
// propagates. For smooth/visual loops, vs the setInterval-based timer.
export function rafSource() {
  const stream = new Source(0);
  let n = 0, raf = null, running = true;
  const have = typeof requestAnimationFrame === "function";
  const tick = () => { if (!running) return; stream.push(++n); if (have) raf = requestAnimationFrame(tick); };
  if (have) raf = requestAnimationFrame(tick);
  return { stream, stop: () => { running = false; if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf); } };
}

// the microphone via Web Audio — emits live {rms, peak} levels each frame, and puts
// the AnalyserNode (+ MediaStream/AudioContext) in the complement so a visualizer can
// pull raw Float32 time/frequency data. (gated: prompts for mic permission)
export function micSource() {
  const stream = new Source(null, { complement: {} });
  let media = null, ctx = null, raf = null, cancelled = false;
  const md = typeof navigator !== "undefined" && navigator.mediaDevices;
  if (md && md.getUserMedia) {
    md.getUserMedia({ audio: true }).then((ms) => {
      if (cancelled) { ms.getTracks().forEach((t) => t.stop()); return; }
      media = ms;
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      ctx.createMediaStreamSource(ms).connect(an);
      Object.assign(stream.complement, { mediaStream: ms, analyser: an, audioContext: ctx });
      const buf = new Float32Array(an.fftSize);
      const tick = () => {
        if (cancelled) return;
        an.getFloatTimeDomainData(buf);
        let sum = 0, peak = 0;
        for (let i = 0; i < buf.length; i++) { const v = buf[i]; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
        stream.push({ rms: Math.sqrt(sum / buf.length), peak });
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }).catch((e) => stream.push({ error: e && e.message }));
  } else {
    stream.push({ error: "getUserMedia unavailable" });
  }
  return { stream, stop: () => { cancelled = true; if (raf) cancelAnimationFrame(raf); if (media) media.getTracks().forEach((t) => t.stop()); if (ctx) ctx.close().catch(() => {}); } };
}

// pure: snapshot a Gamepad into a plain value
export function snapshotPad(pad) {
  if (!pad) return null;
  return {
    id: pad.id,
    index: pad.index,
    connected: pad.connected,
    axes: Array.from(pad.axes || []),
    buttons: Array.from(pad.buttons || []).map((b) => ({ pressed: !!b.pressed, value: b.value || 0 })),
  };
}

// the first connected gamepad, polled each animation frame (gamepads only appear
// after the user presses a button — that's a browser security rule, not a bug)
export function gamepadSource() {
  const stream = new Source(null);
  let running = true, raf = null;
  const haveRaf = typeof requestAnimationFrame === "function";
  const read = () => (typeof navigator !== "undefined" && navigator.getGamepads ? Array.from(navigator.getGamepads()).find(Boolean) : null);
  const tick = () => {
    if (!running) return;
    stream.push(snapshotPad(read()));
    if (haveRaf) raf = requestAnimationFrame(tick);
  };
  if (haveRaf) raf = requestAnimationFrame(tick);
  return { stream, stop: () => { running = false; if (raf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(raf); } };
}

// pure: snapshot a GeolocationPosition into a plain value
export function snapshotPosition(p) {
  if (!p || !p.coords) return null;
  const c = p.coords;
  return { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, altitude: c.altitude, heading: c.heading, speed: c.speed, timestamp: p.timestamp };
}

// the device's geolocation, watched (prompts for permission)
export function geolocationSource() {
  const stream = new Source(null);
  let id = null;
  const geo = typeof navigator !== "undefined" && navigator.geolocation;
  if (geo) {
    id = geo.watchPosition(
      (p) => stream.push(snapshotPosition(p)),
      (err) => stream.push({ error: err && err.message }),
      { enableHighAccuracy: true },
    );
  } else {
    stream.push({ error: "geolocation unavailable" });
  }
  return { stream, stop: () => { if (id != null && geo) geo.clearWatch(id); } };
}

// pure: a MIDI message event → a plain value
export function snapshotMidi(e) {
  const [status = 0, data1 = 0, data2 = 0] = Array.from((e && e.data) || []);
  return { status, data1, data2, command: status >> 4, channel: status & 0x0f, port: e && e.target && e.target.name, time: e && e.timeStamp };
}

// the most recent MIDI message from any input (prompts for permission)
export function midiSource() {
  const stream = new Source(null);
  let inputs = [], onMsg = null, cancelled = false, access = null, onState = null;
  if (typeof navigator !== "undefined" && navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess().then((a) => {
      if (cancelled) return;
      access = a;
      onMsg = (e) => stream.push(snapshotMidi(e));
      const subscribe = () => access.inputs.forEach((inp) => { if (!inputs.includes(inp)) { inp.addEventListener("midimessage", onMsg); inputs.push(inp); } });
      subscribe();
      // hot-plugged devices only appear via statechange — subscribe them as they arrive
      onState = () => subscribe();
      if (access.addEventListener) access.addEventListener("statechange", onState);
    }).catch((e) => stream.push({ error: e && e.message }));
  } else {
    stream.push({ error: "Web MIDI unavailable" });
  }
  return { stream, stop: () => { cancelled = true; if (access && onState && access.removeEventListener) access.removeEventListener("statechange", onState); if (onMsg) inputs.forEach((inp) => inp.removeEventListener("midimessage", onMsg)); } };
}

// pure: snapshot a MediaStream's track metadata (the stream itself is opaque —
// it rides in the complement for a downstream <video>/<audio> sink to attach)
export function snapshotMediaStream(ms) {
  if (!ms) return null;
  return { id: ms.id, active: ms.active, tracks: ms.getTracks().map((t) => ({ kind: t.kind, label: t.label, enabled: t.enabled, muted: t.muted })) };
}

// the camera+mic as a MediaStream (prompts for permission). The live MediaStream
// is in `stream.complement.mediaStream`; the value is JSON-shaped track metadata.
export function cameraSource(constraints = { video: true, audio: false }) {
  const stream = new Source(null, { complement: {} });
  let media = null, cancelled = false;
  const md = typeof navigator !== "undefined" && navigator.mediaDevices;
  if (md && md.getUserMedia) {
    md.getUserMedia(constraints).then((ms) => {
      if (cancelled) { ms.getTracks().forEach((t) => t.stop()); return; }
      media = ms;
      stream.complement.mediaStream = ms;
      stream.push(snapshotMediaStream(ms));
    }).catch((e) => stream.push({ error: e && e.message }));
  } else {
    stream.push({ error: "getUserMedia unavailable" });
  }
  return { stream, stop: () => { cancelled = true; if (media) media.getTracks().forEach((t) => t.stop()); } };
}
