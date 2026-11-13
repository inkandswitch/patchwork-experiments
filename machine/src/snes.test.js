// The SNES engine (engines/snes) on a real game: Unarmed, driven by a fixed
// script from power-on into a two-player and a four-player round. Every
// input is fixed, so every run below is one finite case.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, test } from "vitest";
import { compile, identify } from "./engine.js";
import { FOUR_PLAYERS, TWO_PLAYERS, pads } from "../engines/snes/test/unarmed.js";

const wasm = readFileSync(new URL("../engines/snes/dist/snes.wasm", import.meta.url));
const rom = new Uint8Array(readFileSync(new URL("../engines/snes/test/unarmed.sfc", import.meta.url)));
const machine = await compile(wasm);

const FRAMES = 1530; // the four-player script, plus room to re-step after the last checkpoint
const CHECKPOINTS = Array.from({ length: 11 }, (_, i) => i * 150); // 0, 150, ... 1500
const SLOW = 120_000;

// The reference: the four-player script on an engine that is only ever
// stepped and hashed (hash() reads memory from JS; it calls nothing in the
// engine). hashes[f] is the hash after f steps.
let hashes;
let snapshots; // frame -> snapshot, at CHECKPOINTS
beforeAll(() => {
  const e = machine.boot(rom);
  hashes = [e.hash()];
  for (let f = 0; f < FRAMES; f++) {
    e.step(pads(FOUR_PLAYERS, f));
    hashes.push(e.hash());
  }
  snapshots = new Map();
  const again = machine.boot(rom);
  for (let f = 0; f <= CHECKPOINTS.at(-1); f++) {
    if (CHECKPOINTS.includes(f)) snapshots.set(f, again.snapshot());
    again.step(pads(FOUR_PLAYERS, f));
  }
}, SLOW);

const same = (a, b) => Buffer.from(a.buffer, a.byteOffset, a.length).equals(b);

/** Steps e from frame `from` to `to` along script, calling each(f) after step f. */
function run(e, script, from, to, each = () => {}) {
  for (let f = from; f < to; f++) {
    e.step(pads(script, f));
    each(f + 1);
  }
}

describe("snes engine on Unarmed", () => {
  test("is five pads of two bytes at NTSC rate, and the content is the ROM", async () => {
    const e = machine.boot(rom);
    expect([e.players, e.inputBytes]).toEqual([5, 2]);
    expect(e.hz).toBeCloseTo(60.0988, 4);
    expect(() => e.step(new Uint8Array(8))).toThrow(/10 input bytes/);
    const id = await identify(wasm, rom);
    expect(id.content).toMatch(/^[0-9a-f]{64}$/);
    expect(machine.boot(rom).hash()).toBe(hashes[0]); // genesis
  });

  test("refuses content that is not a cartridge", () => {
    expect(() => machine.boot(new Uint8Array(0))).toThrow(/refused/);
  });

  test("a second engine fed the same pads agrees on every frame", () => {
    const e = machine.boot(rom);
    run(e, FOUR_PLAYERS, 0, FRAMES, (f) => expect(e.hash()).toBe(hashes[f]));
  }, SLOW);

  test("snapshots every 7 frames, output() every frame and frame() every 5 change nothing", () => {
    const e = machine.boot(rom);
    let samples = 0;
    run(e, FOUR_PLAYERS, 0, FRAMES, (f) => {
      if (f % 7 === 0) e.snapshot();
      const { audio } = e.output();
      expect([audio.rate, audio.channels]).toEqual([32000, 2]);
      samples += audio.samples.length / 2;
      if (f % 5 === 0) expect(e.frame().width).toBe(256);
      expect(e.hash()).toBe(hashes[f]);
    });
    // 32000 Hz at 60.0988 frames per second is 532.46 samples a frame.
    expect(Math.abs(samples - (FRAMES * 32000) / 60.0988)).toBeLessThan(600);
  }, SLOW);

  test("every checkpoint restored into every prior state is exact, and goes on as before", () => {
    // Prior states are reached by stepping, on the four-player script (where
    // the checkpoints came from) and on the two-player one (a different game
    // from frame 780). At each, every checkpoint is restored and re-stepped
    // 30 frames; then the engine's own state is restored and the run goes
    // on, so that restore is checked against the reference as well.
    const priors = [
      [FOUR_PLAYERS, [300, 900, 1500]],
      [TWO_PLAYERS, [900, 1300]],
    ];
    let cases = 0;
    for (const [script, at] of priors) {
      const e = machine.boot(rom);
      const own = script === FOUR_PLAYERS ? hashes : null;
      let frame = 0;
      for (const p of at) {
        run(e, script, frame, p);
        frame = p;
        if (own) expect(e.hash()).toBe(own[p]);
        const mine = e.snapshot();
        const myHash = e.hash();
        for (const c of CHECKPOINTS) {
          e.restore(snapshots.get(c));
          expect(e.hash()).toBe(hashes[c]);
          expect(same(e.snapshot(), snapshots.get(c))).toBe(true);
          run(e, FOUR_PLAYERS, c, c + 30);
          expect(e.hash()).toBe(hashes[c + 30]);
          cases++;
        }
        e.restore(mine);
        expect(e.hash()).toBe(myHash);
      }
      if (own) {
        run(e, script, frame, FRAMES);
        expect(e.hash()).toBe(own[FRAMES]);
      }
    }
    expect(cases).toBe(5 * CHECKPOINTS.length);
  }, SLOW);

  // The HUD's top row has a head per gladiator (yellow, green, pink, blue).
  const HEADS = [
    [30, 0xdea508],
    [54, 0x73f710],
    [78, 0xf710b5],
    [102, 0x10adf7],
  ];
  const heads = ({ width, rgba }) =>
    HEADS.filter(([x, rgb]) => {
      const i = (10 * width + x) * 4;
      return ((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]) === rgb;
    }).length;

  test("the scripts reach a two-player and a four-player round, and every pad plays", () => {
    const two = machine.boot(rom);
    run(two, TWO_PLAYERS, 0, 1200);
    expect(heads(two.frame())).toBe(2);

    const four = machine.boot(rom);
    four.restore(snapshots.get(1200));
    expect(heads(four.frame())).toBe(4);

    // From the same frame, leave out one pad's presses at a time: each
    // changes the game.
    for (const pad of [0, 1, 2, 3]) {
      const without = FOUR_PLAYERS.filter(([start, p]) => !(p === pad && start >= 1200));
      four.restore(snapshots.get(1200));
      run(four, without, 1200, 1400);
      expect(four.hash()).not.toBe(hashes[1400]);
    }
  }, SLOW);

  // Queries are the console's memories, raw: WRAM, VRAM, OAM, CGRAM, ARAM,
  // the cartridge's SRAM (Unarmed has none), and nothing past them.
  const MEMORIES = [0x20000, 0x10000, 544, 512, 0x10000, 0];

  test("queries read the console's memories every frame and change nothing", () => {
    const e = machine.boot(rom);
    run(e, FOUR_PLAYERS, 0, FRAMES, (f) => {
      const got = MEMORIES.map((_, k) => e.query(k).length);
      expect(got).toEqual(MEMORIES);
      expect(e.query(MEMORIES.length)).toBe(null);
      expect(e.hash()).toBe(hashes[f]);
    });
  }, SLOW);

  test("the memories are the game's: the HUD's head colours are in CGRAM", () => {
    const e = machine.boot(rom);
    e.restore(snapshots.get(1200));
    const cgram = e.query(3);
    const colours = new Set();
    for (let i = 0; i < 256; i++) {
      const c = cgram[2 * i] | (cgram[2 * i + 1] << 8);
      const [r, g, b] = [c & 31, (c >> 5) & 31, (c >> 10) & 31].map((x) => (x << 3) | (x >> 2));
      colours.add((r << 16) | (g << 8) | b);
    }
    for (const [, rgb] of HEADS) expect(colours.has(rgb)).toBe(true);
    // and the work RAM moves with the game
    const before = e.query(0);
    run(e, FOUR_PLAYERS, 1200, 1201);
    expect(same(e.query(0), before)).toBe(false);
  });

  test("ends where it always has: the same bytes on any host", () => {
    expect(hashes[FRAMES]).toBe(GOLDEN);
  });
});

// The hash after the four-player script, for this build of the engine. A
// change here with an unchanged snes.wasm means the engine is not
// deterministic across hosts; a rebuilt engine changes it on purpose.
const GOLDEN = "ff7d5702b622b02c";
