// What a machine plays, made audible with WebAudio: the routing of
// host.output() (output.js) into a scene.
//
// output.js has already decided what a listener hears under rollback: each
// tick once, in order; corrections { tick, events, was } for events a
// re-simulation changed; samples crossfaded where the timeline changed under
// them; gaps { gap: [from, to] } after which the stream fades in from
// silence. Nothing here second-guesses that. This module only plays it:
//
// - **PCM** (the Super NES; any engine with an audio stream; Doom's music)
//   goes through one Stream: the ticks' samples, resampled to the context's
//   rate, scheduled back to back as AudioBuffers a little ahead of the
//   audio clock (`lead`). It keeps its lead by playing up to 0.5% fast or
//   slow (the engine's clock and the audio device's drift apart), and every
//   end of what is scheduled is pre-faded: a short ramp to silence armed at
//   the queue's end and cancelled when the next tick arrives in time. So a
//   stream that runs dry (a stall, a gap, a background tab) fades out
//   instead of clicking, and fades back in when it resumes.
// - **Doom's sound effects** are events: one voice per origin (Doom's own
//   rule: a new sound from an origin replaces the one it was making; a stop
//   ends it), each the WAD's lump (doom.js sounds()), placed by a route:
//     world(toScene): at the origin, in the scene, through a PannerNode
//       whose falloff is Doom's own (full within 200 map units, silent past
//       1200, linear between) in scene units; the AudioListener is the
//       scene's camera (listen()).
//     screen({ port, listener }): Doom's own mix for one player's view
//       (S_AdjustSoundParams: its attenuation and stereo separation), out of
//       the screen's PannerNode, as that player would hear it.
//   A correction starts late what is new (offset by how late it is) and
//   stops what is gone.
// - **Doom's music**: doom-music.js's player follows the music record (the
//   first event of every delivered tick) and renders a tick's worth of PCM
//   into a Stream of its own, at the screen or unplaced.
//
// The audio graph only; no engine, network or host here. A sink takes
// output items through push(item), in the order host.output() gives them.
// speaker.js puts these together for a machine of each kind.

import { events as decodeEvents, HZ as DOOM_HZ } from "../doom.js";

const SPEED = 0.005; // the most a stream plays fast or slow to keep its lead
const GAIN = 0.25; // speed change per second of lead error (20 ms off: 0.5%)
const SMOOTH = 1 / 60; // the lead error's moving average weighs each chunk this much (about a second of ticks)
const QUANTUM = 256; // frames the audio thread may have rendered past currentTime (two render quanta)

/**
 * Linear resampling of a stream of PCM chunks, continuous across chunks:
 * the output is the input read at `step` input frames per output frame,
 * interpolated, as if the chunks were one buffer (frame -1, before the
 * first chunk, is silence). Pure.
 */
export class Resampler {
  #channels;
  #prev; // the last input frame of the previous chunk
  #t = 0; // where the next output frame reads, in input frames from the current chunk's start (>= -1)

  constructor(channels) {
    this.#channels = channels;
    this.#prev = new Float32Array(channels);
  }

  /** The next chunk (interleaved samples), read at `step`; returns planar output, one Float32Array per channel. */
  push(samples, step) {
    const c = this.#channels;
    const n = samples.length / c;
    const t0 = this.#t;
    // Every output frame reading before this chunk's last frame (one at it
    // waits for the next chunk). The epsilon absorbs the rounding that the
    // carried position picks up chunk to chunk, which would otherwise read
    // one frame early at an exact boundary.
    const count = Math.max(0, Math.ceil((n - 1 - t0) / step - 1e-9));
    const out = Array.from({ length: c }, () => new Float32Array(count));
    for (let i = 0; i < count; i++) {
      const t = t0 + i * step;
      const j = Math.max(-1, Math.min(Math.floor(t), n - 2)); // -1: the previous chunk's last frame (t may round just below it)
      const w = t - j;
      for (let k = 0; k < c; k++) {
        const a = j < 0 ? this.#prev[k] : samples[j * c + k];
        const b = samples[(j + 1) * c + k];
        out[k][i] = a + (b - a) * w;
      }
    }
    if (n) {
      this.#t = t0 + count * step - n;
      this.#prev = samples.slice((n - 1) * c, n * c);
    }
    return out;
  }

  /** Starts again from silence (after a gap). */
  reset() {
    this.#prev.fill(0);
    this.#t = 0;
  }
}

/**
 * A PCM stream on an audio context: push() each tick's audio
 * ({ rate, channels, samples }, interleaved), gap() at a gap. Plays into
 * `out`, `lead` seconds ahead of the audio clock. Time is kept in whole
 * frames of the context, so buffers abut exactly.
 */
export class Stream {
  /** Counts, for measuring: chunks, restarts (from silence: the first, after running dry, after a gap), dropped (chunks too far ahead), frames scheduled. */
  stats = { chunks: 0, restarts: 0, dropped: 0, frames: 0 };
  #ctx;
  #rate; // the context's
  #gain;
  #lead; // frames
  #fade; // frames
  #slack; // frames
  #resampler = null;
  #channels = 0;
  #next = 0; // the frame where what is scheduled ends
  #tail = 0; // the frame where the armed fade-out starts
  #restart = true; // the next chunk starts from silence, faded in
  #draining = false; // too far ahead: dropping until the queue is down to the lead
  #error = 0; // the lead's error in frames, averaged
  #measured = -1; // the clock's frame when the lead was last measured
  #sources = new Set();

  /**
   * @param ctx     an AudioContext (or OfflineAudioContext)
   * @param o.out   where it plays (default ctx.destination)
   * @param o.lead  seconds scheduled ahead of the clock (default 0.04)
   * @param o.fade  seconds of the ramps where it stops and starts (default 0.005)
   * @param o.slack seconds ahead past the lead at which chunks are dropped (default 0.1)
   */
  constructor(ctx, { out = ctx.destination, lead = 0.04, fade = 0.005, slack = 0.1 } = {}) {
    this.#ctx = ctx;
    this.#rate = ctx.sampleRate;
    this.#lead = Math.round(lead * this.#rate);
    this.#fade = Math.max(1, Math.round(fade * this.#rate));
    this.#slack = Math.round(slack * this.#rate);
    this.#gain = ctx.createGain();
    this.#gain.gain.value = 0;
    this.#gain.connect(out);
  }

  /** The node the stream leaves through (connected to `out`). */
  get node() {
    return this.#gain;
  }

  /** How far ahead of the clock the scheduled audio reaches, in seconds. */
  get ahead() {
    return Math.max(0, this.#next / this.#rate - this.#ctx.currentTime);
  }

  push(audio) {
    const { rate, channels, samples } = audio;
    if (!samples?.length) return;
    this.stats.chunks++;
    const ctx = this.#ctx;
    const now = Math.round(ctx.currentTime * this.#rate);
    const ahead = this.#next - now;
    if (channels !== this.#channels) {
      this.#resampler = new Resampler(channels);
      this.#channels = channels;
      this.#restart = true;
    }
    // Ran dry, or nearly (the armed fade-out may have begun, or the audio
    // thread may have rendered past it): start again, after it.
    if (!this.#restart && ahead < this.#fade + QUANTUM) this.#restart = true;
    if (!this.#restart && ahead > this.#lead + this.#slack) this.#draining = true;
    if (this.#draining) {
      if (ahead > this.#lead) {
        this.stats.dropped++;
        return;
      }
      this.#draining = false;
      this.#restart = true;
    }
    const g = this.#gain.gain;
    const at = (frame) => frame / this.#rate;
    let start = this.#next;
    if (this.#restart) {
      // From silence: after what is scheduled has faded out (its armed
      // ramp reaches 0 at #next, and stays), or the lead from now.
      start = Math.max(this.#next, now + this.#lead);
      this.#resampler.reset();
      this.#error = 0;
      this.#measured = now;
      g.setValueAtTime(0, at(start));
      g.linearRampToValueAtTime(1, at(start + this.#fade));
      this.stats.restarts++;
    } else {
      g.cancelScheduledValues(at(this.#tail));
      // Keep the lead: a little fast when ahead, a little slow when behind,
      // by the error averaged over about a second, so that ticks arriving a
      // frame early or late do not wobble the pitch. Measured once per
      // movement of the clock, before what arrives with it: chunks that
      // arrive together would otherwise count their own pile-up as lead,
      // and the stream would play fast and run dry between piles.
      if (now !== this.#measured) {
        this.#error += SMOOTH * (ahead - this.#lead - this.#error);
        this.#measured = now;
      }
    }
    const speed = 1 + Math.max(-SPEED, Math.min(SPEED, (GAIN * this.#error) / this.#rate));
    const planes = this.#resampler.push(samples, (rate / this.#rate) * speed);
    const n = planes[0].length;
    if (n) {
      const buffer = ctx.createBuffer(channels, n, this.#rate);
      for (let k = 0; k < channels; k++) buffer.copyToChannel(planes[k], k);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(this.#gain);
      src.onended = () => {
        this.#sources.delete(src);
        src.disconnect();
      };
      src.start(at(start));
      this.#sources.add(src);
      this.stats.frames += n;
    }
    this.#next = start + n;
    // Arm the fade-out at the new end; the next chunk in time cancels it.
    this.#tail = Math.min(this.#next, Math.max(start + (this.#restart ? this.#fade : 0), this.#next - this.#fade));
    g.setValueAtTime(1, at(this.#tail));
    g.linearRampToValueAtTime(0, at(this.#next));
    this.#restart = false;
  }

  /** A gap: what is scheduled plays out and fades (it is armed to), and the stream starts again from silence. */
  gap() {
    this.#restart = true;
    this.#draining = false;
  }

  close() {
    for (const s of this.#sources) {
      try {
        s.stop();
      } catch {}
      s.disconnect();
    }
    this.#sources.clear();
    this.#gain.disconnect();
  }
}

/**
 * A PannerNode for a screen: the scene places it with place(). Defaults:
 * equal-power panning, inverse distance from 1 scene unit.
 */
export function screenPanner(ctx, options = {}) {
  return panner(ctx, { panningModel: "equalpower", distanceModel: "inverse", refDistance: 1, rolloffFactor: 1, ...options });
}

function panner(ctx, options) {
  const node = ctx.createPanner();
  for (const [k, v] of Object.entries(options)) node[k] = v;
  return node;
}

/** Places a panner (or the context's listener, with up) at position, facing forward: each [x, y, z]. */
export function place(node, { position, forward, up }) {
  const set = (param, v) => (param.value = v);
  if (position) {
    if (node.positionX) [node.positionX, node.positionY, node.positionZ].forEach((p, i) => set(p, position[i]));
    else node.setPosition(...position);
  }
  if (forward) {
    if (node.orientationX) [node.orientationX, node.orientationY, node.orientationZ].forEach((p, i) => set(p, forward[i]));
    else if (node.forwardX) {
      [node.forwardX, node.forwardY, node.forwardZ].forEach((p, i) => set(p, forward[i]));
      if (up) [node.upX, node.upY, node.upZ].forEach((p, i) => set(p, up[i]));
    } else if (node.setOrientation) node.setOrientation(...forward, ...(up ?? []));
  }
}

/** The scene's camera as the context's listener (for the world route): position, forward, up. */
export function listen(ctx, pose) {
  place(ctx.listener, { up: [0, 1, 0], ...pose });
}

// ---------------------------------------------------------------------
// Doom.

const CLOSE = 200; // map units: full volume within (S_CLOSE_DIST)
const CLIP = 1200; // silent beyond (S_CLIPPING_DIST)
const SWING = 96; // stereo separation's swing, out of 255 (S_STEREO_SWING)

/**
 * Doom's mix of one sound for one listener (S_AdjustSoundParams): gain
 * 0..1 (of the event's volume) and pan -1..1 (left to right), or null if it
 * is out of earshot. Distance is Doom's octagonal approximation in the
 * map's plane; `unclipped` (map 8 of an episode) never goes silent, as in
 * Doom (and floors at 15 of 127).
 */
export function doomMix(listener, origin, { unclipped = false } = {}) {
  const dx = Math.abs(listener.x - origin.x);
  const dy = Math.abs(listener.y - origin.y);
  let d = dx + dy - Math.min(dx, dy) / 2;
  if (!unclipped && d > CLIP) return null;
  const toward = Math.atan2(origin.y - listener.y, origin.x - listener.x);
  const sep = 128 - SWING * Math.sin(toward - listener.angle);
  const pan = (sep - 128) / 127;
  let gain;
  if (d < CLOSE) gain = 1;
  else if (unclipped) gain = (15 + (112 * (CLIP - Math.min(d, CLIP))) / (CLIP - CLOSE)) / 127;
  else gain = (CLIP - d) / (CLIP - CLOSE);
  return gain > 0 ? { gain, pan } : null;
}

/**
 * Where Doom's sounds go in the scene: at their origins. toScene(x, y, z)
 * maps map units to the scene's [x, y, z] (for the doom package's parts:
 * x / 36, z / 36, -y / 36, plus where the map stands). The falloff is
 * Doom's, measured in scene units through toScene's scale.
 */
export function world(toScene, { panningModel = "HRTF" } = {}) {
  const o = toScene(0, 0, 0);
  const e = toScene(1, 0, 0);
  const scale = Math.hypot(e[0] - o[0], e[1] - o[1], e[2] - o[2]);
  return {
    voice(ctx, out) {
      const node = panner(ctx, {
        panningModel,
        distanceModel: "linear",
        refDistance: CLOSE * scale,
        maxDistance: CLIP * scale,
        rolloffFactor: 1,
      });
      node.connect(out);
      return {
        input: node,
        at(origin) {
          place(node, { position: toScene(origin.x, origin.y, origin.z) });
          return true;
        },
      };
    },
  };
}

/**
 * Where Doom's sounds go for a screen: Doom's own mix for the player whose
 * view it shows. listener() is that player's eyes ({ x, y, z, angle },
 * doom.js listener()), read when a sound starts and at each update();
 * unclipped() says when nothing goes silent (map 8). The player's own
 * sounds play unplaced, as Doom does.
 */
export function screen({ port, listener, unclipped = () => false }) {
  return {
    port,
    voice(ctx, out) {
      const gain = ctx.createGain();
      const pan = ctx.createStereoPanner();
      gain.connect(pan).connect(out);
      return {
        input: gain,
        at(origin) {
          const l = listener();
          const mix = l && doomMix(l, origin, { unclipped: unclipped() });
          gain.gain.value = mix ? mix.gain : 0;
          pan.pan.value = mix ? mix.pan : 0;
          return !!mix;
        },
      };
    },
  };
}

/**
 * The Doom sink. push(item) takes host.output()'s items: sounds start,
 * stop and replace per origin; corrections start late and stop; the music
 * record drives `music` (doom-music.js's player, made at ctx.sampleRate).
 *
 * @param o.sounds  doom.js sounds(...wads)
 * @param o.route   world(toScene) or screen({ port, listener })
 * @param o.out     where the effects go (default ctx.destination; for a screen, its panner)
 * @param o.music   doom-music.js's player, or none
 * @param o.musicOut where the music goes (default out)
 * @param o.volume  the effects' level (default 1); o.musicVolume the music's (default 0.5)
 * @param o.voices  most effects at once; the oldest stops first (default 32)
 */
export function doom(ctx, { sounds, route, out = ctx.destination, music = null, musicOut = out, volume = 1, musicVolume = 0.5, voices: most = 32, stream = {} }) {
  const bus = ctx.createGain();
  bus.gain.value = volume;
  bus.connect(out);
  const buffers = new Map(); // lump -> AudioBuffer
  const voices = new Map(); // origin handle (0: none) -> { name, tick, src, at }
  let heard = null; // the newest tick delivered
  let tune = null;
  let sung = 0; // ticks of music rendered: frames are owed by whole ticks, so none is lost to rounding
  if (music) {
    tune = { gain: ctx.createGain(), stream: null };
    tune.gain.gain.value = musicVolume;
    tune.gain.connect(musicOut);
    tune.stream = new Stream(ctx, { ...stream, out: tune.gain });
  }
  const stats = { started: 0, stopped: 0, replaced: 0, evicted: 0, late: 0, unheard: 0, missing: 0 };

  const bufferOf = (name) => {
    if (!buffers.has(name)) {
      const pcm = sounds.get(name);
      let b = null;
      if (pcm) {
        b = ctx.createBuffer(1, pcm.samples.length, pcm.rate);
        b.copyToChannel(pcm.samples, 0);
      }
      buffers.set(name, b);
    }
    return buffers.get(name);
  };

  const stop = (handle) => {
    const v = voices.get(handle);
    if (!v) return false;
    voices.delete(handle);
    try {
      v.src.stop();
    } catch {}
    v.src.disconnect();
    return true;
  };

  const start = (e, tick, offset = 0) => {
    const buffer = bufferOf(e.name);
    if (!buffer) {
      stats.missing++;
      return false;
    }
    if (offset >= buffer.duration) return false;
    const handle = e.origin?.handle ?? 0;
    if (stop(handle)) stats.replaced++;
    if (voices.size >= most) {
      stop(voices.keys().next().value);
      stats.evicted++;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const level = ctx.createGain();
    level.gain.value = e.volume / 127;
    src.connect(level);
    // Unplaced: no origin, or (for a screen) the player's own body.
    let at = null;
    if (e.origin && !(route.port !== undefined && e.player === route.port)) {
      const v = route.voice(ctx, bus);
      level.connect(v.input);
      at = v.at;
      if (!at(e.origin)) stats.unheard++;
    } else level.connect(bus);
    const voice = { name: e.name, tick, src, at };
    src.onended = () => {
      if (voices.get(handle) === voice) voices.delete(handle);
      src.disconnect();
      level.disconnect();
    };
    src.start(ctx.currentTime, offset);
    voices.set(handle, voice);
    stats.started++;
    return true;
  };

  const tick = (t, list) => {
    const [record, ...rest] = list;
    if (tune && record?.kind === "music") tune.record = record;
    for (const e of rest) {
      if (e.kind === "sound") start(e, t);
      else if (e.kind === "stop" && stop(e.origin?.handle ?? 0)) stats.stopped++;
    }
  };

  // What a tick leaves each origin making: its last sound or stop event
  // (one voice per origin, so earlier ones in the tick were cut at once).
  const last = (list) => {
    const out = new Map();
    for (const e of list) if (e.kind === "sound" || e.kind === "stop") out.set(e.origin?.handle ?? 0, e);
    return out;
  };

  // A correction, per origin, by what the tick leaves it making. If the
  // origin has made a sound since t, that one stands: the correction is
  // moot there. Otherwise what plays there now is the sound t started, or
  // one from before t, or nothing; it stops if t now leaves something else
  // there, or if it was t's own; and a sound t now leaves starts late (if it
  // would still be playing). A sound from before t that t had replaced
  // cannot come back; Doom would have it playing on, a rare loss.
  const correct = (t, now, was) => {
    const before = last(was.slice(1));
    const after = last(now.slice(1));
    const offset = heard === null ? 0 : Math.max(0, (heard - t) / DOOM_HZ);
    for (const handle of new Set([...before.keys(), ...after.keys()])) {
      const b = before.get(handle);
      const a = after.get(handle);
      if (a?.kind === b?.kind && a?.name === b?.name) continue;
      const v = voices.get(handle);
      if (v && v.tick > t) continue;
      if (v && (a || v.tick === t) && stop(handle)) stats.stopped++;
      if (a?.kind === "sound" && start(a, t, offset)) stats.late++;
    }
    if (tune && now[0]?.kind === "music" && t === heard) tune.record = now[0];
  };

  const sing = () => {
    if (!tune?.record) return;
    music.follow(tune.record);
    const n = Math.floor(((sung + 1) * music.rate) / DOOM_HZ) - Math.floor((sung * music.rate) / DOOM_HZ);
    sung++;
    if (n) tune.stream.push(music.render(n));
  };

  return {
    stats,
    get playing() {
      return voices.size;
    },
    push(item) {
      if (item.gap) {
        tune?.stream.gap();
        return;
      }
      if (item.was) {
        correct(item.tick, decodeEvents(item.events), decodeEvents(item.was));
        return;
      }
      heard = item.tick;
      if (item.events) tick(item.tick, decodeEvents(item.events));
      sing();
    },
    /**
     * Follows the things making sounds as they move (doom.js things() of
     * the newest state), re-placing each voice at its thing; for a screen,
     * also follows its listener.
     */
    update(things) {
      const byId = new Map(things.map((t) => [t.id, t]));
      for (const [handle, v] of voices) {
        const t = byId.get(handle);
        if (v.at && t) v.at(t);
      }
    },
    close() {
      for (const h of [...voices.keys()]) stop(h);
      tune?.stream.close();
      tune?.gain.disconnect();
      bus.disconnect();
    },
  };
}
