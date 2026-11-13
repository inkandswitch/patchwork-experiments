// Chocolate Doom as a machine engine (engines/doom), checked against native
// Chocolate Doom and against itself. Everything is fixed and finite: three
// demos the closed-loop bot of patch 0001 recorded on Freedoom's E1M1 at
// Ultra-Violence (1, 2 and 4 players, 4200 tics each), and the native
// engine's trace hash after every one of their tics (engines/doom/test).
//
// The IWAD is not committed; engines/doom/test/fetch-freedoom.sh fetches it
// (or set FREEDOOM1 to its path). Without it these tests are skipped.
import { existsSync, readFileSync } from "node:fs";
import { compile } from "./engine.js";
import { BT, INPUT_BYTES, PLAYERS, content, demo, events, sounds, ticcmd } from "./doom.js";

const dir = new URL("../engines/doom/test/", import.meta.url);
const iwadPath = process.env.FREEDOOM1 ?? new URL("freedoom1.wad", dir).pathname;
const haveIwad = existsSync(iwadPath);
const wasm = readFileSync(new URL("../engines/doom/dist/doom.wasm", import.meta.url));
const machine = await compile(wasm);
const iwad = haveIwad ? readFileSync(iwadPath) : null;

const demos = Object.fromEntries(
  [1, 2, 4].map((n) => [n, demo(readFileSync(new URL(`bot${n}p.lmp`, dir)))]),
);
const native = (n) => readFileSync(new URL(`bot${n}p.strict`, dir), "utf8").trim().split("\n");
const boot = (n, extra = []) => machine.boot(content({ wads: [iwad], args: [...demos[n].args, ...extra] }));

// The trace hashes of patch 0001, taken on a copy of the state.
function trace(e) {
  const { result, memory } = e.inspect("doom_trace");
  return Array.from(new BigUint64Array(memory.buffer, result, 12), (h) => h.toString(16).padStart(16, "0"));
}

const bytes = (x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);
const equal = (x, y) => Buffer.compare(bytes(x), bytes(y)) === 0;

// Byte equality of whole states, through reusable snapshot buffers.
function comparer() {
  let a, b;
  return (x, y) => {
    a = x.snapshot(a);
    b = y.snapshot(b);
    return Buffer.compare(a, b) === 0;
  };
}

const LONG = 180_000;

describe.skipIf(!haveIwad)("doom (needs engines/doom/test/freedoom1.wad)", () => {
  test.each([1, 2, 4])(
    "%ip: every tic's state hashes as native Chocolate Doom's does",
    (n) => {
      const want = native(n);
      const { tics } = demos[n];
      expect(want.length).toBe(tics.length + 1);
      const e = boot(n);
      const pages = e.snapshot().length;
      expect(trace(e)[1]).toBe(want[0]);
      for (let t = 0; t < tics.length; t++) {
        e.step(tics[t]);
        const strict = trace(e)[1];
        if (strict !== want[t + 1]) throw new Error(`${n}p tic ${t + 1}: ${strict}, native ${want[t + 1]}`);
      }
      // Doom's memory is its fixed zone: it never grows in play.
      expect(e.snapshot().length).toBe(pages);
    },
    LONG,
  );

  // Rollback and late join. A reference engine plays the demo. At every
  // K-th tic t its snapshot is restored into two others: a peer that has
  // just stepped K tics on predicted inputs (each port repeating its input
  // of tic t - 1), so it restores backwards from a wrong future; and a
  // freshly booted engine, which restores forwards from tick 0. Both then
  // step the true inputs, and after every tic both states must equal the
  // reference's byte for byte.
  test.each([
    [1, 35],
    [2, 35],
    [4, 35],
    [4, 1],
  ])(
    "%ip: restoring every %i-th tic's snapshot, from a mispredicted future or from boot, re-steps exactly",
    (n, K) => {
      const tics = K === 1 ? demos[n].tics.slice(0, 140) : demos[n].tics;
      const same = comparer();
      const ref = boot(n);
      const peer = boot(n);
      let diverged = 0;
      for (let t = 0; t < tics.length; t += K) {
        const s = ref.snapshot();
        const predicted = t === 0 ? new Uint8Array(PLAYERS * INPUT_BYTES) : tics[t - 1];
        for (let j = 0; j < K && t + j < tics.length; j++) peer.step(predicted);
        const late = boot(n);
        peer.restore(s);
        late.restore(s);
        for (let j = 0; j < K && t + j < tics.length; j++) {
          ref.step(tics[t + j]);
          // the misprediction mattered if the true input differs
          if (j === 0 && Buffer.compare(tics[t], predicted) !== 0) diverged++;
          peer.step(tics[t + j]);
          late.step(tics[t + j]);
          if (!same(peer, ref)) throw new Error(`${n}p: peer differs at tic ${t + j + 1} after restoring ${t}`);
          if (!same(late, ref)) throw new Error(`${n}p: late joiner differs at tic ${t + j + 1} after restoring ${t}`);
        }
      }
      expect(diverged).toBeGreaterThan(tics.length / K / 4);
    },
    LONG,
  );

  test(
    "4p: drawing every player's view, reading output and tracing every tic never change the state",
    () => {
      const same = comparer();
      const { tics } = demos[4];
      const plain = boot(4);
      const busy = boot(4);
      for (let t = 0; t < tics.length; t++) {
        plain.step(tics[t]);
        busy.step(tics[t]);
        busy.output();
        for (let v = -1; v < PLAYERS; v++) busy.frame(v);
        trace(busy);
        if (!same(plain, busy)) throw new Error(`drawing changed the state at tic ${t + 1}`);
      }
      expect(plain.hash()).toBe(busy.hash());
    },
    LONG,
  );

  test("drawing writes memory, which is why it happens on a copy", { timeout: 60_000 }, () => {
    const e = boot(4);
    for (const tic of demos[4].tics.slice(0, 700)) e.step(tic);
    const live = e.snapshot();
    const size = new DataView(live.buffer).getUint32(0, true) * 65536; // the snapshot's pages
    const { memory } = e.inspect("machine_frame", 0);
    const drawn = new Uint8Array(memory.buffer, 0, size);
    expect(equal(drawn, live.subarray(live.length - size))).toBe(false);
    expect(equal(e.snapshot(), live)).toBe(true);
  });

  test("each player's frame is that player's view, and equal states draw equal frames", () => {
    const a = boot(4);
    const b = boot(4);
    for (const tic of demos[4].tics.slice(0, 1500)) {
      a.step(tic);
      b.step(tic);
    }
    const frames = [0, 1, 2, 3].map((v) => a.frame(v));
    for (const f of frames) {
      expect([f.width, f.height]).toEqual([320, 200]);
      expect(f.rgba.length).toBe(320 * 200 * 4);
    }
    expect(new Set(frames.map((f) => bytes(f.rgba).toString("base64"))).size).toBe(4);
    for (let v = 0; v < 4; v++) expect(equal(b.frame(v).rgba, frames[v].rgba)).toBe(true);
    // a view that is not a player in the game shows player 0's
    expect(equal(a.frame(-1).rgba, frames[0].rgba)).toBe(true);
    const two = boot(2);
    for (const tic of demos[2].tics.slice(0, 100)) two.step(tic);
    expect(equal(two.frame(3).rgba, two.frame(0).rgba)).toBe(true);
  });

  test("2p: every sound is a lump the host can play, and pickups say whose they are", () => {
    const pcm = sounds(iwad);
    const e = boot(2);
    const pickups = new Set();
    let records = 0;
    for (const tic of demos[2].tics) {
      e.step(tic);
      const [music, ...rest] = events(e.output().events);
      expect(music).toEqual({ kind: "music", name: "D_E1M1", loops: true, paused: false });
      for (const ev of rest) {
        records++;
        expect(ev.kind === "sound" || ev.kind === "stop").toBe(true);
        if (ev.kind === "stop") continue;
        expect(pcm.has(ev.name)).toBe(true);
        expect(ev.volume).toBeGreaterThan(0);
        if (ev.name === "DSITEMUP" || ev.name === "DSWPNUP") pickups.add(ev.player);
      }
    }
    expect(records).toBeGreaterThan(100);
    // vanilla plays a pickup only for the console player; here both are heard
    expect([...pickups].sort()).toEqual([0, 1]);
    const pistol = pcm.get("DSPISTOL");
    expect([11025, 22050]).toContain(pistol.rate);
    expect(pistol.samples.every((s) => s >= -1 && s < 1)).toBe(true);
  });

  test("the save button is dropped and the pause button pauses", () => {
    const same = comparer();
    const idle = new Uint8Array(PLAYERS * INPUT_BYTES);
    const press = (buttons) => ticcmd({ buttons }, new Uint8Array(PLAYERS * INPUT_BYTES));
    const a = boot(1);
    const b = boot(1);
    a.step(press(BT.SPECIAL | 2 /* BTS_SAVEGAME */ | (3 << 2)));
    b.step(idle);
    expect(same(a, b)).toBe(true);

    a.step(press(BT.PAUSE));
    expect(events(a.output().events)[0].paused).toBe(true);
    const paused = trace(a);
    for (let i = 0; i < 10; i++) a.step(ticcmd({ forward: 50 }, new Uint8Array(PLAYERS * INPUT_BYTES)));
    const [, , mobjs, player] = trace(a);
    expect(mobjs).toBe(paused[2]); // nothing moves while paused,
    expect(player).not.toBe(paused[3]); // though each player's ticcmd is still read
    a.step(press(BT.PAUSE));
    expect(events(a.output().events)[0].paused).toBe(false);
  });

  test("content: the IWAD stays out of memory, and bad content is refused with Doom's reason", () => {
    const e = boot(1);
    expect(e.snapshot().length).toBeLessThan(8 << 20);
    expect(iwad.length).toBeGreaterThan(8 << 20);
    expect(e.hash()).toBe(boot(1).hash());
    expect(() => machine.boot(iwad)).toThrow(/bare WAD/);
    const only = (...args) => machine.boot(content({ wads: [iwad], args }));
    expect(() => only("-players", "5")).toThrow(/-players: 5/);
    expect(() => only("-mb", "1")).toThrow(/Z_Malloc: failed/);
    const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm)).map((i) => `${i.module}.${i.name}`);
    expect(imports.sort()).toEqual(["env.emscripten_notify_memory_growth", "machine.content_read", "machine.content_size"]);
  });
});
