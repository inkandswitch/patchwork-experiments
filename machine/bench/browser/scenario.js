// What the browser check runs, in Node and in a browser page alike: boot
// each engine, step it on fixed inputs (Doom on the 4-player bot demo, the
// Super NES on the 4-player Unarmed script), hash at fixed ticks, take a
// snapshot and come back to it, and draw. The two hosts must agree on every
// hash and every frame's pixels: a check that the engines are deterministic
// across hosts, not only across runs.
import { compile } from "../../src/engine.js";
import { content as doomContent, demo } from "../../src/doom.js";
import { FOUR_PLAYERS, pads } from "../../engines/snes/test/unarmed.js";

export const DOOM_AT = [0, 35, 700, 1500];
export const SNES_AT = [0, 300, 1200, 1500];

// FNV-1a over a frame's pixels: enough to say two hosts drew the same.
function fnv(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * @param load (path) => Promise<Uint8Array>, relative to the package root;
 *             "iwad" is the Freedoom IWAD
 * @param now  () => ms
 * @param draw (name, frame) => void, for the pictures
 */
export async function scenario({ load, now, draw = () => {} }) {
  const out = {};
  for (const engine of ["doom", "snes"]) {
    const t0 = now();
    const wasm = await load(`engines/${engine}/dist/${engine}.wasm`);
    const machine = await compile(wasm);
    const compileMs = now() - t0;
    let content, input, at, views, frames;
    if (engine === "doom") {
      const bot = demo(await load("engines/doom/test/bot4p.lmp"));
      content = doomContent({ wads: [await load("iwad")], args: bot.args });
      input = (t) => bot.tics[t];
      at = DOOM_AT;
      views = [0, 1, 2, 3];
      frames = [700, 1500];
    } else {
      content = await load("engines/snes/test/unarmed.sfc");
      input = (t) => pads(FOUR_PLAYERS, t);
      at = SNES_AT;
      views = [0];
      frames = [300, 1200, 1500];
    }
    const t1 = now();
    const e = machine.boot(content);
    const bootMs = now() - t1;
    const hashes = {};
    const pictures = {};
    let stepMs = 0;
    let snap = null;
    const last = at[at.length - 1];
    for (let t = 0; t <= last; t++) {
      if (at.includes(t)) hashes[t] = e.hash();
      if (t === at[2]) snap = e.snapshot();
      if (frames.includes(t))
        for (const v of views) {
          const f = e.frame(v);
          const name = `${engine}-${t}${views.length > 1 ? `-p${v}` : ""}`;
          pictures[name] = { width: f.width, height: f.height, fnv: fnv(f.rgba) };
          draw(name, f);
        }
      if (t < last) {
        const s = now();
        e.step(input(t));
        stepMs += now() - s;
      }
    }
    // Back to at[2] and forward again: the same state at the end.
    const t2 = now();
    e.restore(snap);
    const restoreMs = now() - t2;
    for (let t = at[2]; t < last; t++) e.step(input(t));
    const t3 = now();
    const again = e.hash();
    const hashMs = now() - t3;
    const t4 = now();
    const f = e.frame(0);
    const frameMs = now() - t4;
    out[engine] = {
      hashes,
      restored: again === hashes[last],
      pictures,
      snapshot_bytes: snap.length,
      ms: {
        compile: round(compileMs),
        boot: round(bootMs),
        step_mean: round(stepMs / last, 4),
        restore: round(restoreMs),
        hash: round(hashMs),
        frame: round(frameMs),
      },
      size: [f.width, f.height],
    };
  }
  return out;
}

const round = (x, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
