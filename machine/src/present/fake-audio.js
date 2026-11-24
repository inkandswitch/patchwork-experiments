// A WebAudio context for tests in Node: the few nodes sound.js uses, a
// record of what was scheduled and connected when, and a renderer that
// computes what the destination would play, frame by frame, from that
// record (buffer sources started at whole frames, gains with their
// automation, panners as pass-through, connections cut where they were
// disconnected), so a test can look for clicks without a browser. It
// follows the WebAudio spec for what it models (setValueAtTime,
// linearRampToValueAtTime and cancelScheduledValues on a-rate params;
// AudioBufferSourceNode start/stop/offset at whole frames); it has not been
// cross-checked against a real OfflineAudioContext in a browser.

class Param {
  constructor(value) {
    this.value = value;
    this.events = []; // { type: "set" | "ramp", value, time }, by time
  }
  setValueAtTime(value, time) {
    this.#insert({ type: "set", value, time });
    return this;
  }
  linearRampToValueAtTime(value, time) {
    this.#insert({ type: "ramp", value, time });
    return this;
  }
  cancelScheduledValues(time) {
    this.events = this.events.filter((e) => e.time < time);
    return this;
  }
  #insert(e) {
    let i = this.events.length;
    while (i > 0 && this.events[i - 1].time > e.time) i--;
    this.events.splice(i, 0, e);
  }
  /** The value at time t, as the spec computes it for set and linear ramp events. */
  at(t) {
    let prev = null;
    for (const e of this.events) {
      if (e.time > t) {
        if (e.type === "ramp") {
          const t0 = prev ? prev.time : 0;
          const v0 = prev ? prev.value : this.value;
          return e.time === t0 ? e.value : v0 + ((e.value - v0) * (t - t0)) / (e.time - t0);
        }
        break;
      }
      prev = e;
    }
    return prev ? prev.value : this.value;
  }
}

class Node {
  constructor(ctx, kind) {
    this.context = ctx;
    this.kind = kind;
    this.inputs = new Set(); // connected now
    this.outputs = new Set();
    this.edges = []; // every connection into this node ever made: { from, since, until } in frames, for render()
  }
  connect(node) {
    this.outputs.add(node);
    node.inputs.add(this);
    node.edges.push({ from: this, since: this.context.frame(), until: Infinity });
    return node;
  }
  /** Cuts every connection out of this node from now on (what played before stays played). */
  disconnect() {
    const now = this.context.frame();
    for (const o of this.outputs) {
      o.inputs.delete(this);
      for (const e of o.edges) if (e.from === this && e.until === Infinity) e.until = now;
    }
    this.outputs.clear();
  }
}

class Buffer {
  constructor(channels, length, sampleRate) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.data = Array.from({ length: channels }, () => new Float32Array(length));
  }
  copyToChannel(src, k) {
    this.data[k].set(src.subarray(0, this.length));
  }
  getChannelData(k) {
    return this.data[k];
  }
}

export class FakeAudioContext {
  constructor({ sampleRate = 48000 } = {}) {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.destination = new Node(this, "destination");
    this.listener = Object.fromEntries(
      ["positionX", "positionY", "positionZ", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"].map((k) => [k, new Param(0)]),
    );
    this.sources = []; // every buffer source made, in order
  }
  /** The current time, in whole frames. */
  frame() {
    return Math.round(this.currentTime * this.sampleRate);
  }
  createGain() {
    const n = new Node(this, "gain");
    n.gain = new Param(1);
    return n;
  }
  createStereoPanner() {
    const n = new Node(this, "stereo");
    n.pan = new Param(0);
    return n;
  }
  createPanner() {
    const n = new Node(this, "panner");
    for (const k of ["positionX", "positionY", "positionZ", "orientationX", "orientationY", "orientationZ"]) n[k] = new Param(0);
    n.orientationX.value = 1;
    return n;
  }
  createBuffer(channels, length, sampleRate) {
    return new Buffer(channels, length, sampleRate);
  }
  createBufferSource() {
    const n = new Node(this, "source");
    n.buffer = null;
    n.started = null; // { when, offset }
    n.stopped = null;
    n.onended = null;
    n.start = (when = 0, offset = 0) => {
      if (n.started) throw new Error("start twice");
      n.started = { when, offset };
    };
    n.stop = (when = this.currentTime) => {
      if (!n.started) throw new Error("stop before start");
      n.stopped = when;
    };
    this.sources.push(n);
    return n;
  }
  /** Moves the clock to t, ending (onended) every source that finished by then. */
  advance(t) {
    this.currentTime = t;
    for (const s of this.sources) {
      if (!s.started || s.ended) continue;
      const end = s.stopped ?? s.started.when + s.buffer.duration - s.started.offset;
      if (end <= t) {
        s.ended = true;
        s.onended?.();
      }
    }
  }
  /**
   * What `node` (default the destination) outputs over frames [from, to),
   * per channel (2). A buffer source plays frame i of its buffer at its
   * start frame + i, at the context's rate (sources here are made at it).
   */
  render(from, to, node = this.destination) {
    const out = [new Float32Array(to - from), new Float32Array(to - from)];
    const add = (n, gain) => {
      if (n.kind === "source") {
        const b = n.buffer;
        if (!b || !n.started) return;
        if (b.sampleRate !== this.sampleRate) throw new Error("render plays sources at the context's rate only");
        const s0 = Math.round(n.started.when * this.sampleRate);
        const off = Math.round(n.started.offset * this.sampleRate);
        const stop = n.stopped === null ? Infinity : Math.round(n.stopped * this.sampleRate);
        for (let f = Math.max(from, s0); f < to && f < stop; f++) {
          const i = f - s0 + off;
          if (i >= b.length) break;
          for (let k = 0; k < 2; k++) out[k][f - from] += gain(f) * b.data[Math.min(k, b.numberOfChannels - 1)][i];
        }
        return;
      }
      const own = n.kind === "gain" ? (f) => gain(f) * n.gain.at(f / this.sampleRate) : gain;
      // Each connection carries what played while it stood, so a source that
      // ended and was disconnected (onended, in advance()) is still heard
      // for the frames before; render() may be called long after.
      for (const e of n.edges) {
        if (e.until <= from || e.since >= to) continue;
        add(e.from, e.since <= from && e.until >= to ? own : (f) => (f >= e.since && f < e.until ? own(f) : 0));
      }
    };
    add(node, () => 1);
    return out;
  }
}
