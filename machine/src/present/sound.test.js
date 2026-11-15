// The sound adapter, on a fake audio context (fake-audio.js) whose renderer
// computes what the destination would play. All finite: fixed signals,
// fixed arrival patterns enumerated, fixed events.
import { readFileSync, existsSync } from "node:fs";
import { fade } from "../host/output.js";
import { FakeAudioContext } from "./fake-audio.js";
import { doom, doomMix, listen, place, Resampler, screen, screenPanner, Stream, world } from "./sound.js";
import { lumps as wadLumps } from "../doom.js";
import { music } from "../doom-music.js";
import { FULL } from "../test-tier.js";

const IWAD = process.env.FREEDOOM1 ?? new URL("../../engines/doom/test/freedoom1.wad", import.meta.url).pathname;

// ---------------------------------------------------------------------
// The resampler.

/** The reference: the whole signal (frame -1 silent) read at i * step, interpolated. */
function reference(signal, channels, step, count) {
  const n = signal.length / channels;
  const at = (j, k) => (j < 0 ? 0 : signal[j * channels + k]);
  return Array.from({ length: channels }, (_, k) =>
    Float32Array.from({ length: count }, (_, i) => {
      const t = i * step;
      const j = Math.min(Math.floor(t), n - 2);
      return at(j, k) + (at(j + 1, k) - at(j, k)) * (t - j);
    }),
  );
}

describe("Resampler", () => {
  test("reads chunks as one signal, for every way of cutting 9 frames, at every step", () => {
    const channels = 2;
    const signal = Float32Array.from({ length: 9 * channels }, (_, i) => Math.sin(i * 0.7) * (i % 2 ? 0.5 : 1));
    let cases = 0;
    for (const step of [0.5, 2 / 3, 32000 / 48000, 32000 / 44100, 1, 1.005, 1.5, 3]) {
      const count = Math.ceil(8 / step); // every output frame reading inside the signal
      const want = reference(signal, channels, step, count);
      for (let cuts = 0; cuts < 256; cuts++) {
        // bit i set: a chunk ends after frame i (8 possible cut points among 9 frames)
        const r = new Resampler(channels);
        const got = [[], []];
        let from = 0;
        for (let i = 0; i < 9; i++) {
          if (i < 8 && !((cuts >> i) & 1)) continue;
          const out = r.push(signal.subarray(from * channels, (i + 1) * channels), step);
          for (let k = 0; k < channels; k++) got[k].push(...out[k]);
          from = i + 1;
        }
        for (let k = 0; k < channels; k++) {
          expect(got[k].length).toBe(count);
          for (let i = 0; i < count; i++) expect(Math.abs(got[k][i] - want[k][i])).toBeLessThan(1e-6);
        }
        cases++;
      }
    }
    expect(cases).toBe(8 * 256);
  });

  test("starts again from silence after reset", () => {
    const r = new Resampler(1);
    r.push(new Float32Array([1, 1, 1]), 0.5);
    r.reset();
    const [out] = r.push(new Float32Array([0.5, 0.5]), 0.5);
    expect([...out]).toEqual([0.5, 0.5]);
  });
});

// ---------------------------------------------------------------------
// The stream.

const RATE = 48000;
const SRC = 32000; // the Super NES's
const HZ = 60;
const TONE = 440;
const AMP = 0.5;

/** Tick i's audio: a continuous stereo tone, SRC / HZ frames a tick. */
function tick(i, { amp = AMP } = {}) {
  const n = SRC / HZ; // 533.33: alternate 533 and 534 frames, as the console does
  const from = Math.floor(i * n);
  const to = Math.floor((i + 1) * n);
  const samples = new Float32Array((to - from) * 2);
  for (let f = from; f < to; f++) {
    const v = amp * Math.sin((2 * Math.PI * TONE * f) / SRC);
    samples[(f - from) * 2] = v;
    samples[(f - from) * 2 + 1] = -v;
  }
  return { rate: SRC, channels: 2, samples };
}

// The most a sample may move from the one before: the tone's own slope at
// the output rate (sped up at most 0.5%), plus a ramp's (full scale over
// the 5 ms fade). A click is a jump of up to 2 * AMP.
const SLOPE = (2 * Math.PI * TONE * AMP * 1.005) / RATE;
const BOUND = SLOPE + AMP / (0.005 * RATE) + 1e-6;

function maxJump(planes) {
  let worst = 0;
  for (const p of planes) for (let i = 1; i < p.length; i++) worst = Math.max(worst, Math.abs(p[i] - p[i - 1]));
  return worst;
}

/**
 * Plays a schedule: arrivals[i] is how many ticks arrive at display frame i
 * (one frame every 1/60 s of the audio clock), `drift` the engine's clock's
 * rate over the audio device's. Returns the stream, the context, and the
 * rendered output over the whole run plus its tail.
 */
function play(arrivals, { drift = 1, each = () => {}, ...o } = {}) {
  const ctx = new FakeAudioContext({ sampleRate: RATE });
  const s = new Stream(ctx, o);
  let t = 0;
  const leads = [];
  for (const [frame, count] of arrivals.entries()) {
    ctx.advance(Math.round(((frame / HZ) * RATE) / drift) / RATE);
    for (let k = 0; k < count; k++) s.push(tick(t++));
    each(frame, s, ctx);
    leads.push(s.ahead);
  }
  const end = Math.ceil((ctx.currentTime + 0.5) * RATE);
  return { s, ctx, leads, out: ctx.render(0, end) };
}

/**
 * How many ticks late (behind one a frame) the stream can be and play on:
 * the lead less that lateness must stay past the armed fade-out and the
 * audio thread's render-ahead (sound.js: fade + two render quanta).
 */
const LEAD = 0.04;
const absorbs = (late) => LEAD - late / HZ > 0.005 + 256 / RATE;

/** The most ticks behind one a frame (from frame 0) that arrivals ever fall, before a frame's arrivals. */
function deficit(arrivals) {
  let got = 0;
  let worst = 0;
  for (const [f, c] of arrivals.entries()) {
    worst = Math.max(worst, f - got);
    got += c;
  }
  return worst;
}

/** Buffer sources abut: each starts exactly where the previous one ended (the same restart). */
function contiguous(ctx) {
  const spans = ctx.sources.map((x) => [Math.round(x.started.when * RATE), x.buffer.length]);
  let breaks = 0;
  for (let i = 1; i < spans.length; i++) if (spans[i][0] !== spans[i - 1][0] + spans[i - 1][1]) breaks++;
  return breaks;
}

describe("Stream", () => {
  test("a steady stream plays continuously, the lead held, the tone exact", () => {
    const { s, ctx, out, leads } = play(Array(600).fill(1));
    expect(s.stats).toMatchObject({ chunks: 600, restarts: 1, dropped: 0 });
    expect(contiguous(ctx)).toBe(0);
    expect(maxJump(out)).toBeLessThanOrEqual(BOUND);
    for (const l of leads.slice(1)) expect(l).toBeGreaterThan(0.04 - 1e-9);
    for (const l of leads) expect(l).toBeLessThan(0.04 + 2 / HZ);
    // The tone, as played, is the tone: past the fade-in, sample for sample (at the speed it played).
    const start = Math.round(ctx.sources[0].started.when * RATE);
    let worst = 0;
    for (let i = 300; i < 20000; i++) {
      const want = AMP * Math.sin((2 * Math.PI * TONE * i * (SRC / RATE)) / SRC);
      worst = Math.max(worst, Math.abs(out[0][start + i] - want));
    }
    expect(worst).toBeLessThan(2e-3); // linear interpolation of a 440 Hz tone at 32 kHz
  });

  test("arrivals bunched by the display: every pattern of 6 frames bringing 6 ticks plays on while the lead covers it, else restarts once; never a click", () => {
    // Every sequence over {0, 1, 2, 3} ticks a frame, summing to 6 (frames late, early, doubled up), repeated for 3 s.
    // At the default lead (2.4 frames) a tick late is absorbed and two are not:
    // the stream restarts once, from silence, and the restarted stream then
    // absorbs the pattern, since its lateness is now counted from there.
    expect([0, 1, 2].map(absorbs)).toEqual([true, true, false]);
    const seen = new Map();
    const patterns = [];
    const walk = (prefix, left) => {
      if (prefix.length === 6) return left === 0 && patterns.push(prefix);
      for (let c = 0; c <= Math.min(3, left); c++) walk([...prefix, c], left - c);
    };
    walk([], 6);
    expect(patterns.length).toBe(336);
    // Fast tier: every 16th pattern (21: 6 never late, 8 a tick late, 6 two, 1 four); full: all 336.
    for (const p of FULL ? patterns : patterns.filter((_, i) => i % 16 === 0)) {
      const arrivals = [1, 1, 1, ...Array.from({ length: 180 }, (_, i) => p[i % 6])];
      const { s, ctx, out } = play(arrivals);
      const late = deficit(arrivals);
      seen.set(late, (seen.get(late) ?? 0) + 1);
      expect([p, s.stats.restarts]).toEqual([p, absorbs(late) ? 1 : 2]);
      expect(s.stats.dropped).toBe(0);
      if (absorbs(late)) expect(contiguous(ctx)).toBe(0);
      expect(maxJump(out)).toBeLessThanOrEqual(BOUND);
    }
    if (FULL) expect(Object.fromEntries(seen)).toEqual({ 0: 104, 1: 135, 2: 81, 3: 15, 4: 1 });
  });

  test("running dry fades out and back in, never clicks, for every length of stall", () => {
    // Steady for 1 s, nothing for k frames, then the ticks that piled up and steady again.
    for (let k = 0; k <= 12; k++) {
      const arrivals = [...Array(60).fill(1), ...Array(k).fill(0), k + 1, ...Array(60).fill(1)]; // the piled-up ticks come with the next frame's
      const { s, out } = play(arrivals);
      // A stall of k frames is k ticks late: one is absorbed; from two, it
      // restarts once; and from seven, the k + 1 ticks then arriving at once
      // reach past the lead by more than the slack (0.1 s, 6 ticks), so the
      // excess is dropped and it restarts again, at the lead.
      expect(deficit(arrivals)).toBe(k);
      expect([k, s.stats.restarts]).toEqual([k, absorbs(k) ? 1 : k < 7 ? 2 : 3]);
      expect([k, s.stats.dropped > 0]).toEqual([k, k >= 7]);
      expect(maxJump(out)).toBeLessThanOrEqual(BOUND);
    }
  });

  test("a gap fades out what was playing and the stream comes back from silence, as output.js hands it over", () => {
    for (const ahead of [0, 1, 2]) {
      let t = 0;
      const ctx = new FakeAudioContext({ sampleRate: RATE });
      const s = new Stream(ctx);
      for (let f = 0; f < 120; f++) {
        ctx.advance(Math.round((f / HZ) * RATE) / RATE);
        if (f === 60) {
          s.gap(); // ticks skipped: output.js fades the next one in from silence
          t += 30;
          const next = tick(t++);
          s.push({ ...next, samples: fade(null, next) });
          for (let k = 0; k < ahead; k++) s.push(tick(t++));
        } else s.push(tick(t++));
      }
      const out = ctx.render(0, Math.ceil((ctx.currentTime + 0.5) * RATE));
      expect(s.stats.restarts).toBe(2);
      expect(maxJump(out)).toBeLessThanOrEqual(BOUND);
    }
  });

  test("a burst far ahead (a tab coming back) is dropped down to the lead, then restarts without a click", () => {
    const arrivals = [...Array(60).fill(1), 15, ...Array(60).fill(1)];
    const { s, out, leads } = play(arrivals);
    expect(s.stats.dropped).toBeGreaterThan(0);
    expect(s.stats.restarts).toBe(2);
    expect(maxJump(out)).toBeLessThanOrEqual(BOUND);
    expect(Math.max(...leads.slice(-30))).toBeLessThan(0.04 + 2 / HZ);
  });

  test("clock drift between the engine and the audio device is absorbed by speed, within 0.5%", () => {
    // The engine's clock runs fast or slow by up to 0.3% against the audio clock, for 20 s.
    for (const drift of [0.997, 0.999, 1, 1.001, 1.003]) {
      const { s, ctx, out, leads } = play(Array(1200).fill(1), { drift });
      expect(s.stats.restarts).toBe(1);
      expect(s.stats.dropped).toBe(0);
      expect(contiguous(ctx)).toBe(0);
      expect(maxJump(out)).toBeLessThanOrEqual(BOUND);
      // The lead settles near its target: measured after each push, so a
      // tick past the lead, off by the offset a proportional controller
      // keeps to run at another speed (drift / GAIN: 0.3% / 0.25 = 12 ms).
      const late = leads.slice(-120);
      const mean = late.reduce((a, b) => a + b, 0) / late.length;
      expect(Math.abs(mean - (LEAD + 1 / HZ))).toBeLessThan(Math.abs(1 - drift) / 0.25 + 0.002);
      // What was scheduled is the input's length at a speed within 0.5%.
      const input = (1200 * SRC) / HZ;
      const ratio = s.stats.frames / ((input * RATE) / SRC);
      expect(Math.abs(ratio - 1)).toBeLessThan(0.0051);
    }
  });

  test("a change of channels starts again", () => {
    const ctx = new FakeAudioContext({ sampleRate: RATE });
    const s = new Stream(ctx);
    s.push(tick(0));
    s.push({ rate: SRC, channels: 1, samples: new Float32Array(533) });
    expect(s.stats.restarts).toBe(2);
  });
});

// ---------------------------------------------------------------------
// The PCM sink.

describe("placing", () => {
  test("a screen's panner is placed where the scene says, facing its way", () => {
    const ctx = new FakeAudioContext({ sampleRate: RATE });
    const panner = screenPanner(ctx);
    place(panner, { position: [1, 2, 3], forward: [0, 0, 1] });
    expect([panner.positionX.value, panner.positionY.value, panner.positionZ.value]).toEqual([1, 2, 3]);
    expect(panner.orientationZ.value).toBe(1);
    expect(panner.panningModel).toBe("equalpower");
  });

  test("listen() puts the context's listener at the scene's camera", () => {
    const ctx = new FakeAudioContext();
    listen(ctx, { position: [4, 5, 6], forward: [0, 0, -1] });
    const l = ctx.listener;
    expect([l.positionX.value, l.positionY.value, l.positionZ.value, l.forwardZ.value, l.upY.value]).toEqual([4, 5, 6, -1, 1]);
  });
});

// ---------------------------------------------------------------------
// Doom.

const KIND = { music: 1, sound: 2, stop: 3 };
/** Event records as the engine writes them (engines/doom/README.md, Output). */
function encode(list) {
  const out = new Uint8Array(28 * list.length);
  const v = new DataView(out.buffer);
  for (const [i, e] of list.entries()) {
    const at = 28 * i;
    v.setUint8(at, KIND[e.kind]);
    v.setInt8(at + 1, e.kind === "music" ? (e.paused ? 1 : 0) : (e.player ?? -1));
    v.setUint8(at + 2, e.kind === "music" ? (e.loops ? 1 : 0) : (e.volume ?? 127));
    out.set(new TextEncoder().encode(e.name ?? ""), at + 4);
    if (e.origin) {
      v.setUint32(at + 12, e.origin.handle, true);
      v.setInt32(at + 16, e.origin.x * 65536, true);
      v.setInt32(at + 20, e.origin.y * 65536, true);
      v.setInt32(at + 24, e.origin.z * 65536, true);
    }
  }
  return out;
}
const SONG = { kind: "music", name: "D_E1M1", loops: true, paused: false };
const at = (t, ...sounds) => ({ tick: t, events: encode([SONG, ...sounds]) });
const sound = (name, handle, x = 0, y = 0, o = {}) => ({ kind: "sound", name, origin: handle ? { handle, x, y, z: 0 } : null, ...o });

const LUMPS = new Map(["DSPISTOL", "DSSHOTGN", "DSDOROPN", "DSITEMUP"].map((n, i) => [n, { rate: 11025, samples: new Float32Array(11025 * (i + 1) * 0.25).fill(0.1) }]));
const toScene = (x, y, z) => [x / 36, z / 36, -y / 36];

function sources(ctx) {
  return ctx.sources.filter((s) => s.buffer?.sampleRate === 11025);
}
function pannerOf(src) {
  // source -> level gain -> panner
  const level = [...src.outputs][0];
  return [...level.outputs][0];
}

describe("doom", () => {
  test("one voice per origin: a new sound replaces, a stop ends, origin-less sounds play unplaced", () => {
    const ctx = new FakeAudioContext();
    const d = doom(ctx, { sounds: LUMPS, route: world(toScene) });
    d.push(at(0, sound("DSPISTOL", 7, 360, 720), sound("DSITEMUP", 0)));
    expect(d.playing).toBe(2);
    const [pistol, item] = sources(ctx);
    const p = pannerOf(pistol);
    expect(p.kind).toBe("panner");
    expect([p.positionX.value, p.positionY.value, p.positionZ.value]).toEqual([10, 0, -20]);
    // Doom's falloff in scene units: full within 200 map units, silent past 1200.
    expect(p.distanceModel).toBe("linear");
    expect(p.refDistance).toBeCloseTo(200 / 36, 12);
    expect(p.maxDistance).toBeCloseTo(1200 / 36, 12);
    expect(pannerOf(item).kind).toBe("gain"); // the bus: unplaced
    d.push(at(1, sound("DSSHOTGN", 7, 360, 720)));
    expect(pistol.stopped).not.toBe(null);
    expect(d.playing).toBe(2);
    d.push(at(2, { kind: "stop", name: "DSSHOTGN", origin: { handle: 7, x: 0, y: 0, z: 0 } }));
    expect(sources(ctx)[2].stopped).not.toBe(null);
    expect(d.playing).toBe(1);
    expect(d.stats).toMatchObject({ started: 3, replaced: 1, stopped: 1 });
    // A sound that ends on its own leaves.
    ctx.advance(10);
    expect(d.playing).toBe(0);
  });

  test("keeps at most `voices`, stopping the oldest; a lump the WADs lack is counted, not played", () => {
    const ctx = new FakeAudioContext();
    const d = doom(ctx, { sounds: LUMPS, route: world(toScene), voices: 3 });
    d.push(at(0, ...[1, 2, 3, 4, 5].map((h) => sound("DSPISTOL", h, h, 0)), sound("DSNOPE", 9)));
    expect(d.playing).toBe(3);
    const started = sources(ctx);
    expect(started.map((s) => s.stopped !== null)).toEqual([true, true, false, false, false]);
    expect(d.stats).toMatchObject({ started: 5, evicted: 2, missing: 1 });
  });

  test("follows things as they move", () => {
    const ctx = new FakeAudioContext();
    const d = doom(ctx, { sounds: LUMPS, route: world(toScene) });
    d.push(at(0, sound("DSPISTOL", 7, 0, 0)));
    d.update([{ id: 7, x: 72, y: 36, z: 36 }, { id: 8, x: 1, y: 1, z: 1 }]);
    const p = pannerOf(sources(ctx)[0]);
    expect([p.positionX.value, p.positionY.value, p.positionZ.value]).toEqual([2, 1, -1]);
  });

  test("a correction starts late what is new and stops what is gone, if it is still the sound that started then", () => {
    const ctx = new FakeAudioContext();
    const d = doom(ctx, { sounds: LUMPS, route: world(toScene) });
    d.push(at(10, sound("DSPISTOL", 7)));
    d.push(at(11, sound("DSDOROPN", 8)));
    d.push(at(12));
    d.push(at(13));
    // Tick 10 again: the pistol never fired, a shotgun did (from 9).
    d.push({ tick: 10, events: encode([SONG, sound("DSSHOTGN", 9)]), was: encode([SONG, sound("DSPISTOL", 7)]) });
    const [pistol, door, shotgun] = sources(ctx);
    expect(pistol.stopped).not.toBe(null);
    expect(shotgun.started.offset).toBeCloseTo(3 / 35, 12); // heard at 13: three tics late
    // Tick 11 again without the door; but the door's origin has made another sound since: that one stays.
    d.push(at(14, sound("DSITEMUP", 8)));
    d.push({ tick: 11, events: encode([SONG]), was: encode([SONG, sound("DSDOROPN", 8)]) });
    expect(door.stopped).not.toBe(null); // replaced at 14, not by the correction
    const item = sources(ctx)[3];
    expect(item.stopped).toBe(null);
    // A correction whose sound would already be over is not started.
    d.push({ tick: 0, events: encode([SONG, sound("DSPISTOL", 3)]), was: encode([SONG]) });
    expect(sources(ctx).length).toBe(4);
    expect(d.stats).toMatchObject({ late: 1, stopped: 1, replaced: 1 });
  });

  test("a correction leaves each origin making what the corrected tick leaves it making", () => {
    // Every pairing of a delivered tick's sounds and its correction, each over
    // {pistol, shotgun} x {0, 1, 2} copies at one origin, in both orders (pistol
    // first or shotgun first): 18 x 18. One voice per origin, so what a tick
    // leaves playing there is its last sound; nothing played before tick 5.
    const list = (c) => {
      const p = Array((c % 9) % 3).fill(sound("DSPISTOL", 4));
      const g = Array(Math.floor((c % 9) / 3)).fill(sound("DSSHOTGN", 4));
      return c < 9 ? [...p, ...g] : [...g, ...p];
    };
    let cases = 0;
    for (let w = 0; w < 18; w++)
      for (let n = 0; n < 18; n++) {
        const ctx = new FakeAudioContext();
        const d = doom(ctx, { sounds: LUMPS, route: world(toScene), voices: 99 });
        d.push(at(5, ...list(w)));
        d.push({ tick: 5, events: encode([SONG, ...list(n)]), was: encode([SONG, ...list(w)]) });
        const live = sources(ctx).filter((s) => s.stopped === null);
        const want = list(n).at(-1)?.name ?? null;
        const had = list(w).at(-1)?.name ?? null;
        expect(live.length).toBe(d.playing);
        expect(live.map((s) => s.buffer.length)).toEqual(want ? [LUMPS.get(want).samples.length] : []);
        // Started late only when the tick now leaves another sound; stopped only when it leaves none.
        expect(d.stats.late).toBe(want && want !== had ? 1 : 0);
        expect(d.stats.stopped).toBe(had && want !== had ? 1 : 0);
        cases++;
      }
    expect(cases).toBe(324);
  });

  test("for a screen: Doom's own mix for the viewing player, its own sounds unplaced", () => {
    const ctx = new FakeAudioContext();
    const out = ctx.createGain();
    out.connect(ctx.destination);
    let eyes = { x: 0, y: 0, z: 41, angle: 0 };
    const d = doom(ctx, { sounds: LUMPS, route: screen({ port: 1, listener: () => eyes }), out });
    d.push(at(0,
      sound("DSPISTOL", 5, 100, 0, { player: 1 }), // its own body: unplaced
      sound("DSSHOTGN", 6, 0, 700), // 700 units to the left
      sound("DSDOROPN", 7, 5000, 0), // out of earshot
    ));
    const [own, left, far] = sources(ctx);
    expect(pannerOf(own).kind).toBe("gain");
    const pan = pannerOf(left);
    const mix = doomMix(eyes, { x: 0, y: 700 });
    expect(pan.gain.value).toBeCloseTo(0.5, 12); // (1200 - 700) / 1000
    expect([...pan.outputs][0].pan.value).toBeCloseTo(-96 / 127, 12); // hard left, as far as Doom pans
    expect(mix).toEqual({ gain: pan.gain.value, pan: [...pan.outputs][0].pan.value });
    expect(pannerOf(far).gain.value).toBe(0);
    expect(d.stats.unheard).toBe(1);
    // The listener turns to face the shotgun: dead ahead, centred.
    eyes = { ...eyes, angle: Math.PI / 2 };
    d.update([{ id: 6, x: 0, y: 700, z: 0 }]);
    expect([...pan.outputs][0].pan.value).toBeCloseTo(0, 12);
  });

  test("the music record drives the player: a tick's worth of PCM a tick, through a stream of its own", () => {
    const ctx = new FakeAudioContext({ sampleRate: RATE });
    const calls = [];
    let rendered = 0;
    const player = {
      rate: RATE,
      follow: (r) => calls.push(`${r.name}${r.paused ? " paused" : ""}`),
      render: (n) => ((rendered += n), { rate: RATE, channels: 2, samples: new Float32Array(2 * n) }),
    };
    const d = doom(ctx, { sounds: LUMPS, route: world(toScene), music: player });
    for (let t = 0; t < 35; t++) d.push(at(t));
    expect(rendered).toBe(RATE); // 35 tics are a second, to the frame
    expect(calls.length).toBe(35);
    const paused = { ...SONG, paused: true };
    d.push({ tick: 34, events: encode([paused]), was: encode([SONG]) }); // the newest heard: follows at once
    d.push({ tick: 35, events: encode([paused]) });
    expect(calls.at(-1)).toBe("D_E1M1 paused");
    d.push({ gap: [36, 50] });
    d.close();
  });
});

describe.skipIf(!existsSync(IWAD))("doom's music, the real player (needs engines/doom/test/freedoom1.wad)", () => {
  test("E1M1 from the music record plays through the stream as the player renders it, at the music's level", async () => {
    const wads = wadLumps(readFileSync(IWAD));
    const wasm = readFileSync(new URL("../../engines/doom/dist/music.wasm", import.meta.url));
    const ctx = new FakeAudioContext({ sampleRate: RATE });
    const d = doom(ctx, { sounds: LUMPS, route: world(toScene), music: await music(wasm, wads, RATE), musicVolume: 0.5 });
    // Two seconds of tics, each delivered on its own display frame.
    for (let t = 0; t < 70; t++) {
      ctx.advance(Math.round((t / 35) * RATE) / RATE);
      d.push(at(t));
    }
    const streamed = ctx.sources.filter((x) => x.buffer.sampleRate === RATE);
    expect(contiguous({ sources: streamed })).toBe(0);
    const start = Math.round(streamed[0].started.when * RATE);
    const n = streamed.reduce((a, x) => a + x.buffer.length, 0);
    const out = ctx.render(start, start + n)[0];
    // The same song from another player, rendered a tic at a time as the
    // sink renders it (the OPL timer advances by render calls, so how the
    // frames are cut is part of what plays).
    const ref = await music(wasm, wads, RATE);
    ref.follow(SONG);
    const want = new Float32Array(2 * RATE);
    for (let t = 0, at = 0; t < 70; t++) {
      const k = Math.floor(((t + 1) * RATE) / 35) - Math.floor((t * RATE) / 35);
      want.set(ref.render(k).samples.filter((_, i) => i % 2 === 0), at);
      at += k;
    }
    let err = 0;
    let energy = 0;
    for (let i = 300; i < n - 300; i++) {
      err = Math.max(err, Math.abs(out[i] - 0.5 * want[i]));
      energy += out[i] * out[i];
    }
    expect(Math.sqrt(energy / (n - 600))).toBeGreaterThan(0.01); // it plays
    // And it is the song at half its level: as long as it was, and sample
    // for sample to within the phase the lead's control carries (the tics'
    // times round to whole frames, a frame either way, which moves the
    // speed by millionths).
    expect(Math.abs(n - 2 * RATE)).toBeLessThanOrEqual(1);
    expect(err).toBeLessThan(0.01);
  });
});

describe("doomMix", () => {
  // Doom's S_AdjustSoundParams, from the source: octagonal distance, 200 / 1200 / 1000, swing 96.
  test("agrees with Doom's rule at every listener heading and every offset on a grid", () => {
    let n = 0;
    for (let a = 0; a < 16; a++) {
      const angle = (a / 16) * 2 * Math.PI;
      for (let dx = -1500; dx <= 1500; dx += 100)
        for (let dy = -1500; dy <= 1500; dy += 100) {
          const l = { x: 100, y: -50, angle };
          const m = doomMix(l, { x: 100 + dx, y: -50 + dy });
          const ax = Math.abs(dx), ay = Math.abs(dy);
          const d = ax + ay - Math.min(ax, ay) / 2;
          n++;
          if (d > 1200) {
            expect(m).toBe(null);
            continue;
          }
          const gain = d < 200 ? 1 : (1200 - d) / 1000;
          if (gain <= 0) {
            expect(m).toBe(null);
            continue;
          }
          expect(m.gain).toBeCloseTo(gain, 12);
          // Left of where the listener faces pans left (negative), right pans right.
          const side = Math.sin(Math.atan2(dy, dx) - angle);
          if (dx || dy) expect(m.pan).toBeCloseTo((-96 * side) / 127, 12);
        }
    }
    expect(n).toBe(16 * 31 * 31);
  });

  test("on map 8 nothing goes silent, and far off is 15 of 127", () => {
    const l = { x: 0, y: 0, angle: 0 };
    expect(doomMix(l, { x: 5000, y: 0 }, { unclipped: true }).gain).toBeCloseTo(15 / 127, 12);
    expect(doomMix(l, { x: 100, y: 0 }, { unclipped: true }).gain).toBe(1);
    expect(doomMix(l, { x: 700, y: 0 }, { unclipped: true }).gain).toBeCloseTo((15 + 112 * 0.5) / 127, 12);
  });
});
