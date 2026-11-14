// The speaker on a fake audio context (fake-audio.js) and a stand-in host:
// what host.output() delivers, through the sink its kind takes, out of the
// node it was given. Finite: every port against every event's player and
// origin, fixed signals.
import { FakeAudioContext } from "./fake-audio.js";
import { speaker } from "./speaker.js";
import { doomMix } from "./sound.js";
import { QUERY } from "../doom.js";

const RATE = 48000;

/** A stand-in host: output() hands over what was queued since; query() answers from `state`, counting asks. */
function fakeHost(state = {}) {
  const queued = [];
  const asked = { [QUERY.players]: 0, [QUERY.things]: 0 };
  return {
    queued,
    asked,
    output: () => queued.splice(0),
    query(kind) {
      asked[kind] = (asked[kind] ?? 0) + 1;
      return state[kind] ?? null;
    },
  };
}

// ---- the Super NES (any engine with a PCM stream)

const tone = (i) => {
  const samples = new Float32Array(533 * 2);
  for (let f = 0; f < 533; f++) samples[f * 2] = samples[f * 2 + 1] = 0.25 * Math.sin((2 * Math.PI * 440 * (i * 533 + f)) / 32000);
  return { rate: 32000, channels: 2, samples };
};

describe("a PCM speaker", () => {
  test("plays delivered audio out of `out`, restarts after a gap, and ignores corrections (they carry no samples)", async () => {
    const ctx = new FakeAudioContext({ sampleRate: RATE });
    const out = ctx.createGain();
    out.connect(ctx.destination);
    const s = await speaker(ctx, { kind: "snes", out });
    const host = fakeHost();
    host.queued.push({ tick: 0, audio: tone(0) }, { tick: 0, events: new Uint8Array(), was: new Uint8Array() }, { gap: [1, 9] }, { tick: 9, audio: tone(9) });
    s.feed(host);
    const started = ctx.sources.filter((x) => x.started);
    expect(started.length).toBe(2);
    // each source leaves through the stream's gain, into `out`
    for (const src of started) expect([...[...src.outputs][0].outputs]).toEqual([out]);
    expect(host.asked).toEqual({ [QUERY.players]: 0, [QUERY.things]: 0 });
    s.feed(host); // nothing new: nothing more
    expect(ctx.sources.filter((x) => x.started).length).toBe(2);
    s.close();
    expect(ctx.render(0, RATE)[0].every((x) => x === 0)).toBe(true);
  });
});

// ---- Doom

/** A WAD (PWAD) of the given lumps: Map(name → bytes). */
function wad(lumps) {
  const entries = [...lumps];
  const size = entries.reduce((n, [, b]) => n + b.length, 0);
  const out = new Uint8Array(12 + size + 16 * entries.length);
  const v = new DataView(out.buffer);
  out.set(new TextEncoder().encode("PWAD"), 0);
  v.setInt32(4, entries.length, true);
  v.setInt32(8, 12 + size, true);
  let at = 12;
  entries.forEach(([name, b], i) => {
    out.set(b, at);
    const e = 12 + size + 16 * i;
    v.setInt32(e, at, true);
    v.setInt32(e + 4, b.length, true);
    out.set(new TextEncoder().encode(name), e + 8);
    at += b.length;
  });
  return out;
}
/** A DMX sound lump: `n` samples at 11025 Hz, padded as DMX pads them. */
function dmx(n) {
  const b = new Uint8Array(8 + 16 + n + 16).fill(128 + 20);
  const v = new DataView(b.buffer);
  v.setUint16(0, 3, true);
  v.setUint16(2, 11025, true);
  v.setUint32(4, 32 + n, true);
  return b;
}
const WADS = [wad(new Map([["DSPISTOL", dmx(4000)], ["DSSHOTGN", dmx(6000)]]))];

const KIND = { music: 1, sound: 2, stop: 3 };
/** Event records as the engine writes them (engines/doom/README.md, Output). */
function encode(list) {
  const out = new Uint8Array(28 * list.length);
  const v = new DataView(out.buffer);
  for (const [i, e] of list.entries()) {
    const at = 28 * i;
    v.setUint8(at, KIND[e.kind]);
    v.setInt8(at + 1, e.kind === "music" ? 0 : (e.player ?? -1));
    v.setUint8(at + 2, e.kind === "music" ? 1 : 127);
    out.set(new TextEncoder().encode(e.name ?? ""), at + 4);
    if (e.origin) {
      v.setUint32(at + 12, e.origin.handle, true);
      v.setInt32(at + 16, e.origin.x * 65536, true);
      v.setInt32(at + 20, e.origin.y * 65536, true);
    }
  }
  return out;
}
const SONG = { kind: "music", name: "D_E1M1" };

/** Four players' eyes, as QUERY.players answers: player p at (300 p, 0), facing +y. */
const EYES = [0, 1, 2, 3].map((p) => ({ x: 300 * p, y: 0, angle: Math.PI / 2 }));
function playersBytes() {
  const b = new Uint8Array(32 * 4);
  const v = new DataView(b.buffer);
  EYES.forEach((e, p) => {
    v.setInt32(32 * p + 4, e.x * 65536, true);
    v.setInt32(32 * p + 8, e.y * 65536, true);
    v.setUint32(32 * p + 16, Math.round((e.angle / (2 * Math.PI)) * 2 ** 32), true);
    v.setUint8(32 * p + 28, 1);
  });
  return b;
}
/** Things, as QUERY.things answers: each { id, x, y }. */
function thingsBytes(list) {
  const b = new Uint8Array(48 * list.length);
  const v = new DataView(b.buffer);
  list.forEach((t, i) => {
    v.setUint32(48 * i, t.id, true);
    v.setInt32(48 * i + 4, t.x * 65536, true);
    v.setInt32(48 * i + 8, t.y * 65536, true);
    v.setInt8(48 * i + 46, -1);
  });
  return b;
}

/** Where a started source's level gain leads: "bus" (unplaced) or its voice { gain, pan }. */
function routeOf(src) {
  const level = [...src.outputs][0];
  const next = [...level.outputs][0];
  const after = [...next.outputs][0];
  return after?.kind === "stereo" ? { gain: next.gain.value, pan: after.pan.value } : "bus";
}

describe("a Doom speaker", () => {
  // Every port shown × every event's player (none, 0-3) × an origin or none.
  // The origin is 150 map units ahead of player 1 and 30 to its right, so
  // each port hears it at its own distance and side; player 3 (900 away
  // from player 1's spot, at the octagonal metric) hears it faint.
  const ORIGIN = { handle: 7, x: 330, y: 150 };
  const cases = [];
  for (const port of [0, 1, 2, 3]) for (const player of [-1, 0, 1, 2, 3]) for (const origin of [null, ORIGIN]) cases.push({ port, player, origin });

  test.each(cases)("port $port, a sound by player $player, origin $origin.handle: Doom's mix for the player shown", async ({ port, player, origin }) => {
    const ctx = new FakeAudioContext({ sampleRate: RATE });
    const s = await speaker(ctx, { kind: "doom", wads: WADS, port });
    const host = fakeHost({ [QUERY.players]: playersBytes(), [QUERY.things]: thingsBytes([{ id: 7, x: ORIGIN.x, y: ORIGIN.y }]) });
    host.queued.push({ tick: 0, events: encode([SONG, { kind: "sound", name: "DSPISTOL", player, origin }]) });
    s.feed(host);
    const [src] = ctx.sources.filter((x) => x.started);
    const own = origin === null || player === port;
    if (own) expect(routeOf(src)).toBe("bus");
    else {
      const want = doomMix(EYES[port], origin);
      expect(routeOf(src)).toEqual(want ? { gain: want.gain, pan: want.pan } : { gain: 0, pan: 0 });
    }
    // the eyes are read once, and only for a placed sound; the things once, while a sound plays
    expect(host.asked[QUERY.players]).toBe(own ? 0 : 1);
    expect(host.asked[QUERY.things]).toBe(1);
    s.close();
  });

  test("the voices follow their things, the eyes read again each frame; nothing is asked while nothing plays", async () => {
    const ctx = new FakeAudioContext({ sampleRate: RATE });
    const s = await speaker(ctx, { kind: "doom", wads: WADS, port: 0 });
    const state = { [QUERY.players]: playersBytes(), [QUERY.things]: thingsBytes([{ id: 7, x: 0, y: 100 }]) };
    const host = fakeHost(state);
    s.feed(host);
    expect(host.asked).toEqual({ [QUERY.players]: 0, [QUERY.things]: 0 });
    host.queued.push({ tick: 0, events: encode([SONG, { kind: "sound", name: "DSPISTOL", player: 1, origin: { handle: 7, x: 0, y: 100 } }]) });
    s.feed(host);
    const [src] = ctx.sources.filter((x) => x.started);
    expect(routeOf(src)).toEqual({ gain: 1, pan: doomMix(EYES[0], { x: 0, y: 100 }).pan });
    // the thing walks off to 700 units to the right: quieter, and to the right
    state[QUERY.things] = thingsBytes([{ id: 7, x: 700, y: 100 }]);
    s.feed(host);
    const far = doomMix(EYES[0], { x: 700, y: 100 });
    expect(routeOf(src).gain).toBeCloseTo(far.gain, 12);
    expect(routeOf(src).pan).toBeCloseTo(far.pan, 12);
    expect(host.asked[QUERY.players]).toBe(2); // once a frame it was needed
    ctx.advance(10); // the sound ends
    const before = { ...host.asked };
    s.feed(host);
    expect(host.asked).toEqual(before);
    s.close();
  });

  test("hearing another player: the old mix stops, the new one is that player's", async () => {
    const ctx = new FakeAudioContext({ sampleRate: RATE });
    const s = await speaker(ctx, { kind: "doom", wads: WADS, port: 0 });
    const host = fakeHost({ [QUERY.players]: playersBytes(), [QUERY.things]: thingsBytes([]) });
    host.queued.push({ tick: 0, events: encode([SONG, { kind: "sound", name: "DSSHOTGN", player: 1, origin: { handle: 7, x: 300, y: 0 } }]) });
    s.feed(host);
    const [first] = ctx.sources.filter((x) => x.started);
    expect(routeOf(first)).not.toBe("bus");
    s.port = 1;
    expect(s.port).toBe(1);
    expect(first.stopped).not.toBe(null);
    host.queued.push({ tick: 1, events: encode([SONG, { kind: "sound", name: "DSSHOTGN", player: 1, origin: { handle: 7, x: 300, y: 0 } }]) });
    s.feed(host);
    const second = ctx.sources.filter((x) => x.started)[1];
    expect(routeOf(second)).toBe("bus"); // player 1's own sound, heard as player 1
    s.close();
  });
});
