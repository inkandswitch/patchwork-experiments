// A stopped screen's poster (poster.js): what's blank, over every small
// picture; the search, over every pattern of blank and drawn pictures a few
// ticks long and every bound; the posters' life, over every order of asking
// that matters; and on the real engines, from a session's first state.
import { existsSync, readFileSync } from "node:fs";
import { blank, vacantStep, firstPicture, posters } from "./poster.js";
import { compile } from "../engine.js";
import { content as doomContent } from "../doom.js";

const pic = (w, h, pixels) => ({ width: w, height: h, rgba: new Uint8Array(pixels.flat()) });

test("blank: nothing, 0 by 0, or one colour all over (alpha aside); over every picture up to 2 by 2 in four colours and two alphas", () => {
  expect(blank(null)).toBe(true);
  expect(blank(undefined)).toBe(true);
  expect(blank(pic(0, 0, []))).toBe(true);
  expect(blank(pic(0, 4, []))).toBe(true);
  const COLOURS = [[0, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]];
  let cases = 0;
  for (const [w, h] of [[1, 1], [2, 1], [1, 2], [2, 2]]) {
    const n = w * h;
    // each pixel one of the colours (4^n) × an alpha of 255 or 0 on the last pixel
    for (let code = 0; code < 4 ** n; code++)
      for (const alpha of [255, 0]) {
        const cols = Array.from({ length: n }, (_, i) => Math.floor(code / 4 ** i) % 4);
        const pixels = cols.map((c, i) => [...COLOURS[c], i === n - 1 ? alpha : 255]);
        expect([w, h, cols, alpha, blank(pic(w, h, pixels))]).toEqual([w, h, cols, alpha, cols.every((c) => c === cols[0])]);
        cases++;
      }
  }
  expect(cases).toBe(2 * (4 + 16 + 16 + 256));
});

test("vacantStep: one port's vacant input once per player, for 1-5 players × 1-3 bytes; a vacant input of the wrong length is refused", () => {
  for (let players = 1; players <= 5; players++)
    for (let inputBytes = 1; inputBytes <= 3; inputBytes++) {
      const one = Uint8Array.from({ length: inputBytes }, (_, i) => 7 + i);
      const got = vacantStep({ players, inputBytes }, one);
      expect([...got]).toEqual(Array.from({ length: players }, () => [...one]).flat());
      expect(() => vacantStep({ players, inputBytes }, new Uint8Array(inputBytes + 1))).toThrow(/vacant input/);
      expect([...vacantStep({ players, inputBytes }, [...one])]).toEqual([...got]); // the doc's array, as automerge gives it
    }
});

/** A stand-in engine whose picture at tick t is drawn or blank as `drawn[t]` says (blank past the end); it records each step's input. */
function stub(drawn, { players = 2, inputBytes = 2 } = {}) {
  const e = {
    tick: 0,
    players,
    inputBytes,
    inputs: [],
    restored: null,
    frame: (view) => (drawn[e.tick] ? pic(1, 2, [[e.tick, view, 0, 255], [9, 9, 9, 255]]) : pic(1, 1, [[0, 0, 0, 255]])),
    step(input) {
      e.inputs.push([...input]);
      e.tick++;
    },
    snapshot: () => ({ tick: e.tick }),
    restore(snap) {
      e.restored = snap;
      e.tick = snap.tick;
    },
  };
  return e;
}

test("firstPicture: the first drawn picture within max steps, each step every port vacant, pausing every chunk; over every pattern of 5 ticks × every max 0-5 × chunk 1-3", async () => {
  let cases = 0;
  for (let mask = 0; mask < 1 << 5; mask++)
    for (let max = 0; max <= 5; max++)
      for (const chunk of [1, 2, 3]) {
        const drawn = Array.from({ length: 5 }, (_, t) => !!((mask >> t) & 1));
        const e = stub(drawn);
        let pauses = 0;
        const got = await firstPicture(e, { vacant: [1, 2], view: 3, max, chunk, pause: async () => void pauses++ });
        const first = drawn.findIndex(Boolean);
        const want = first >= 0 && first <= max ? first : null;
        expect([mask, max, chunk, got?.ticks ?? null]).toEqual([mask, max, chunk, want]);
        if (want !== null) expect(got.picture.rgba[0] === want && got.picture.rgba[1] === 3).toBe(true); // that tick's picture, from that view
        const steps = want ?? max;
        expect(e.inputs).toEqual(Array.from({ length: steps }, () => [1, 2, 1, 2]));
        expect(pauses).toBe(Math.floor(steps / chunk));
        cases++;
      }
  expect(cases).toBe(32 * 6 * 3);
  // stopped part way (the machine went): nothing
  let n = 0;
  expect(await firstPicture(stub([false, false, true]), { vacant: [0, 0], max: 5, alive: () => n++ < 1 })).toBe(null);
});

test("posters: found once per state (tick, revision, view), from a snapshot of the host's state, never stepping the host; one at a time; none for a host loading or without an engine; a failure is that state's none", async () => {
  const settle = async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  };
  const host = { engine: stub([false, false, true]), tick: 0, revision: 0, loading: false };
  host.engine.step = () => {
    throw new Error("a poster stepped the host's engine");
  };
  let made = 0;
  let fail = false;
  const p = posters({
    make: async () => {
      made++;
      if (fail) throw new Error("no engine");
      return stub([false, false, true, false, false, false, false, true]);
    },
    vacant: [0, 0],
    max: 10,
    pause: async () => {},
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    // asked: none yet, being found; asked again meanwhile, none and no second search
    expect([p.get(host, 0), p.busy()]).toEqual([null, true]);
    expect(p.get(host, 0)).toBe(null);
    expect(p.get({ ...host, tick: 5 }, 0)).toBe(null);
    await settle();
    expect([made, p.busy()]).toEqual([1, false]);
    // found: the first drawn picture from the host's state (tick 0: two steps on)
    const first = p.get(host, 0);
    expect(first?.rgba[0]).toBe(2);
    expect(p.get(host, 0)).toBe(first); // the same state: the same poster, nothing made
    expect(made).toBe(1);
    // another state (a tick, a revision: a re-step to the same tick reached another state; a view): another search, from that state
    // (each differs from the one before it in that alone)
    for (const [k, h, view, at, want] of [["revision", { ...host, revision: 1 }, 0, 5, 7], ["view", { ...host, revision: 1 }, 1, 0, 2], ["tick", { ...host, revision: 1, tick: 3 }, 1, 3, 7]]) {
      h.engine = Object.assign(stub([false, false, true]), { tick: at, step: host.engine.step });
      expect(p.get(h, view)).toBe(null);
      await settle();
      const got = p.get(h, view);
      expect([k, got?.rgba[0], got?.rgba[1]]).toEqual([k, want, view]);
    }
    expect(made).toBe(4);
    // a host loading, or with no engine (a RemoteHost's): none, and nothing made
    expect([p.get({ ...host, loading: true }, 0), p.get({ ...host, engine: null }, 0), made]).toEqual([null, null, 4]);
    // a failure: none for that state, and it isn't tried again
    fail = true;
    const h = { ...host, revision: 9 };
    expect(p.get(h, 0)).toBe(null);
    await settle();
    expect([p.get(h, 0), p.get(h, 0), made]).toEqual([null, null, 5]);
    // gone: nothing more
    p.dispose();
    fail = false;
    expect([p.get({ ...host, revision: 10 }, 0), made]).toEqual([null, 5]);
  } finally {
    console.warn = warn;
  }
});

// The real engines from their first state (a session made and never played:
// tick 0, as the arcade's published cabinets are): the poster is the
// engine's own first picture, and what a host stepping with nobody playing
// shows at that tick.
const ENGINES = [
  ["snes", () => new Uint8Array(readFileSync(new URL("../../engines/snes/test/unarmed.sfc", import.meta.url))), 7, [256, 224]],
  ["doom", () => doomContent({ wads: [readFileSync(new URL("../../engines/doom/test/freedoom1.wad", import.meta.url))], args: ["-skill", "3", "-warp", "1", "1", "-players", "4"] }), 1, [320, 200]],
];
const haveIwad = existsSync(new URL("../../engines/doom/test/freedoom1.wad", import.meta.url));
for (const [kind, content, at, size] of ENGINES)
  test.skipIf(kind === "doom" && !haveIwad)(`${kind} from its first state: blank there, and its poster is its own picture at tick ${at}, the state it came from untouched`, async () => {
    const machine = await compile(readFileSync(new URL(`../../engines/${kind}/dist/${kind}.wasm`, import.meta.url)));
    const c = content();
    const live = machine.boot(c); // as a host's engine: never stepped here
    expect(blank(live.frame(0))).toBe(true);
    const before = live.hash();
    const vacant = new Uint8Array(live.inputBytes);
    const p = posters({ make: async () => machine.boot(c), vacant, max: 120, pause: async () => {} });
    const host = { engine: live, tick: 0, revision: 0, loading: false };
    expect(p.get(host, 0)).toBe(null);
    for (let i = 0; i < 100 && p.busy(); i++) await Promise.resolve();
    const poster = p.get(host, 0);
    expect([poster?.width, poster?.height, blank(poster)]).toEqual([...size, false]);
    expect(live.hash()).toBe(before);
    // the same picture an engine stepped with nobody playing draws at that tick
    const ref = machine.boot(c);
    for (let t = 0; t < at; t++) ref.step(vacantStep(ref, vacant));
    expect(Buffer.from(ref.frame(0).rgba).equals(Buffer.from(poster.rgba))).toBe(true);
    for (let t = 0; t < at - 1; t++) {
      const e = machine.boot(c);
      for (let s = 0; s < t; s++) e.step(vacantStep(e, vacant));
      expect([t, blank(e.frame(0))]).toEqual([t, true]); // and nothing before it
    }
  });
