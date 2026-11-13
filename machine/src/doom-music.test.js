// Doom's music player (engines/doom/music, dist/music.wasm): Chocolate
// Doom's OPL music driver and OPL emulator, following the engine's music
// record. Every case is fixed: Freedoom's own songs, rendered for fixed
// lengths. Without the IWAD these are skipped, as the engine's tests are.
import { existsSync, readFileSync } from "node:fs";
import { compile } from "./engine.js";
import { content, demo, events, lumps } from "./doom.js";
import { music } from "./doom-music.js";

const dir = new URL("../engines/doom/test/", import.meta.url);
const iwadPath = process.env.FREEDOOM1 ?? new URL("freedoom1.wad", dir).pathname;
const haveIwad = existsSync(iwadPath);
const wasm = readFileSync(new URL("../engines/doom/dist/music.wasm", import.meta.url));
const iwad = haveIwad ? readFileSync(iwadPath) : null;
const wads = haveIwad ? lumps(iwad) : null;

const RATE = 44100;
const rms = (s, from = 0, to = s.length) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += s[i] * s[i];
  return Math.sqrt(sum / (to - from));
};
const same = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));

test("the player is a module of its own, importing only the growth notice", () => {
  const imports = WebAssembly.Module.imports(new WebAssembly.Module(wasm)).map((i) => `${i.module}.${i.name}`);
  expect(imports).toEqual(["env.emscripten_notify_memory_growth"]);
});

describe.skipIf(!haveIwad)("doom music (needs engines/doom/test/freedoom1.wad)", () => {
  test("follows the engine's music record: E1M1 plays, the same on every player", async () => {
    const machine = await compile(readFileSync(new URL("../engines/doom/dist/doom.wasm", import.meta.url)));
    const e = machine.boot(content({ wads: [iwad], args: demo(readFileSync(new URL("bot1p.lmp", dir))).args }));
    const [record] = events(e.output().events);
    const a = await music(wasm, wads, RATE);
    const b = await music(wasm, wads, RATE);
    a.follow(record);
    b.follow(record);
    expect(a.song).toEqual({ name: "D_E1M1", loops: true, paused: false });
    const one = a.render(RATE * 10);
    expect([one.rate, one.channels, one.samples.length]).toEqual([RATE, 2, RATE * 20]);
    expect(same(one.samples, b.render(RATE * 10).samples)).toBe(true);
    // Music from the first second on, every second, never clipped.
    for (let s = 1; s < 10; s++) expect(rms(one.samples, s * RATE * 2, (s + 1) * RATE * 2)).toBeGreaterThan(0.02);
    expect(one.samples.every((x) => x > -1 && x < 1)).toBe(true);
    // Following the same record again changes nothing; a new one switches.
    a.follow(record);
    expect(a.song.name).toBe("D_E1M1");
    a.follow({ name: null, loops: false, paused: false });
    expect(a.song).toBe(null);
  });

  // Each of Freedoom's 41 songs, for 8 seconds, on one player in turn.
  const songs = haveIwad ? [...wads.keys()].filter((n) => n.startsWith("D_")) : [];
  let shared;
  test.each(songs)("%s plays", async (name) => {
    expect(songs.length).toBe(41);
    shared ??= await music(wasm, wads, RATE);
    shared.play(name);
    expect(rms(shared.render(RATE * 8).samples)).toBeGreaterThan(1e-3);
  });

  // Pausing keys off the instruments and stops the song's clock (DMX); the
  // chip's release tails die within a second. A song started afterwards
  // must sound as it does on a fresh player: the case that patch 0003
  // fixes in Chocolate Doom's OPL library, where a pause shifted every
  // event after the next tempo change.
  test("pause and stop fall silent, and a song after either sounds as on a fresh player", async () => {
    const fresh = await music(wasm, wads, RATE);
    fresh.play("D_E1M2");
    const want = rms(fresh.render(RATE * 4).samples);

    for (const [what, act] of [
      ["pause", (m) => m.pause(true)],
      ["pause and resume", (m) => (m.pause(true), m.render(RATE), m.pause(false))],
      ["stop", (m) => m.stop()],
    ]) {
      const m = await music(wasm, wads, RATE);
      m.play("D_E1M1");
      m.render(RATE * 3);
      act(m);
      const after = m.render(RATE * 3).samples;
      if (what !== "pause and resume") expect(rms(after, RATE * 2, RATE * 6)).toBeLessThan(1e-4);
      m.play("D_E1M2");
      const got = rms(m.render(RATE * 4).samples);
      if (Math.abs(got / want - 1) > 0.1) throw new Error(`after ${what}: D_E1M2 at ${got}, fresh ${want}`);
    }
  });

  test("refuses what is not a song, and WADs without instruments", async () => {
    const m = await music(wasm, wads, RATE);
    expect(() => m.play("DSPISTOL")).toThrow(/not a song/);
    expect(() => m.play("D_NOSUCH")).toThrow(/no lump/);
    await expect(music(wasm, new Map(), RATE)).rejects.toThrow(/GENMIDI/);
  });
});
