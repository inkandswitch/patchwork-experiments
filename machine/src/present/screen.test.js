// The screen adapter: one texture for the screen's life, pictures shown
// without a copy, an upload only for a new picture, the GPU texture freed
// only for a new size, and each machine's shape. All finite.
import { readFileSync } from "node:fs";
import { NearestFilter, SRGBColorSpace, Vector2 } from "three";
import { compile } from "../engine.js";
import { ASPECT, Screen, viewOf } from "./screen.js";
import { FOUR_PLAYERS, pads } from "../../engines/snes/test/unarmed.js";

const picture = (width, height, fill = 0) => ({ width, height, rgba: new Uint8ClampedArray(width * height * 4).fill(fill) });

function watch(screen) {
  const seen = { disposed: 0 };
  screen.texture.addEventListener("dispose", () => seen.disposed++);
  return seen;
}

describe("Screen", () => {
  test("is one pixel-art sRGB texture whose top row is the picture's", () => {
    const t = new Screen().texture;
    expect([t.magFilter, t.minFilter]).toEqual([NearestFilter, NearestFilter]);
    expect(t.generateMipmaps).toBe(false);
    expect(t.colorSpace).toBe(SRGBColorSpace);
    expect(t.flipY).toBe(false);
    // A quad's uv v = 1 (its top) samples texture row 0, the picture's top; v = 0 its last row.
    t.updateMatrix();
    for (const u of [0, 0.25, 1]) {
      expect(new Vector2(u, 1).applyMatrix3(t.matrix).toArray()).toEqual([u, 0]);
      expect(new Vector2(u, 0).applyMatrix3(t.matrix).toArray()).toEqual([u, 1]);
    }
  });

  test("shows each new picture without copying it, once, in the same texture", () => {
    const s = new Screen();
    const seen = watch(s);
    const t = s.texture;
    const v0 = t.version;
    const pics = [picture(320, 200, 1), picture(320, 200, 2), picture(320, 200, 3)];
    for (const [i, p] of pics.entries()) {
      expect(s.show(p)).toBe(true);
      expect(s.texture).toBe(t);
      expect(t.image.data.buffer).toBe(p.rgba.buffer); // the picture's own bytes, viewed
      expect(t.image.data).toBeInstanceOf(Uint8Array);
      expect([t.image.width, t.image.height]).toEqual([320, 200]);
      expect(t.version).toBe(v0 + i + 1); // one upload each
    }
    // The same picture again (a RemoteHost's, until a new one comes), or none: nothing.
    expect(s.show(pics[2])).toBe(false);
    expect(s.show(null)).toBe(false);
    expect(t.version).toBe(v0 + 3);
    expect(s.stats).toEqual({ uploads: 3, resizes: 1, skipped: 1 }); // the one resize: from the 1x1 start
    expect(seen.disposed).toBe(1);
  });

  test("frees the GPU texture exactly when the size changes, keeping the Texture", () => {
    // Every sequence of 4 pictures over three sizes (81): a dispose per change of size, never otherwise.
    const sizes = [[320, 200], [256, 224], [256, 239]];
    for (let code = 0; code < 81; code++) {
      const seq = [0, 1, 2, 3].map((i) => Math.floor(code / 3 ** i) % 3);
      const s = new Screen();
      const seen = watch(s);
      const t = s.texture;
      let changes = 0;
      let last = [1, 1];
      for (const k of seq) {
        const [w, h] = sizes[k];
        if (w !== last[0] || h !== last[1]) changes++;
        last = [w, h];
        s.show(picture(w, h));
        expect(s.texture).toBe(t);
        expect([t.image.width, t.image.height]).toEqual([w, h]);
      }
      expect(seen.disposed).toBe(changes);
      expect(s.stats.resizes).toBe(changes);
    }
  });

  test("an empty picture is black; a picture of the wrong length is refused", () => {
    const s = new Screen({ aspect: ASPECT.doom });
    s.show(picture(320, 200, 7));
    s.show({ width: 0, height: 0, rgba: new Uint8ClampedArray(0) }); // a camera outside a level
    expect([s.texture.image.width, s.texture.image.height]).toEqual([1, 1]);
    expect([...s.texture.image.data]).toEqual([0, 0, 0, 255]);
    expect(s.aspect).toBe(4 / 3);
    expect(() => s.show({ width: 2, height: 2, rgba: new Uint8Array(15) })).toThrow(/needs 16 bytes/);
  });

  test("has each machine's shape at every size it draws", () => {
    const shape = (aspect, w, h) => {
      const s = new Screen({ aspect });
      s.show(picture(w, h));
      return s.aspect;
    };
    // Doom: 320x200 is 4:3, its pixels 5:6.
    expect(shape(ASPECT.doom, 320, 200)).toBe(4 / 3);
    expect(((4 / 3) * 200) / 320).toBeCloseTo(5 / 6, 12);
    // Super NES: 256 dots at 8:7 over 224 or 239 lines; hi-res (512) and interlace (448, 478) the same shapes.
    for (const w of [256, 512])
      for (const [h, lines] of [[224, 224], [239, 239], [448, 224], [478, 239]])
        expect(shape(ASPECT.snes, w, h)).toBeCloseTo((256 * 8) / 7 / lines, 12);
    expect(shape(ASPECT.snes, 256, 224)).toBeCloseTo(1.3061, 4);
    expect(shape(ASPECT.snes, 256, 239)).toBeCloseTo(1.2241, 4);
    expect(shape(undefined, 256, 224)).toBe(256 / 224);
  });

  test("shows a real Super NES picture as it is", async () => {
    const wasm = readFileSync(new URL("../../engines/snes/dist/snes.wasm", import.meta.url));
    const rom = new Uint8Array(readFileSync(new URL("../../engines/snes/test/unarmed.sfc", import.meta.url)));
    const e = (await compile(wasm)).boot(rom);
    for (let f = 0; f < 300; f++) e.step(pads(FOUR_PLAYERS, f));
    const p = e.frame(0);
    const s = new Screen({ aspect: ASPECT.snes });
    s.show(p);
    expect([s.texture.image.width, s.texture.image.height]).toEqual([256, 224]);
    expect(Buffer.from(s.texture.image.data).equals(Buffer.from(p.rgba))).toBe(true);
    expect(s.aspect).toBeCloseTo(2048 / 1568, 12);
  });
});

describe("viewOf", () => {
  // A page host: draws afresh on every picture(); its tick and revision say when the state moved.
  function pageHost() {
    const h = { tick: 0, revision: 0, engine: {}, drawn: 0, picture: (v) => (h.drawn++, { width: 1, height: 1, rgba: new Uint8Array([v, h.tick, h.revision, 255]) }) };
    return h;
  }

  test("a page host's player view is drawn exactly when its tick or revision moved", () => {
    // Every sequence of 4 frames, each moving the tick, the revision, both or neither (256).
    for (let code = 0; code < 256; code++) {
      const h = pageHost();
      const next = viewOf(h, { player: 2 });
      expect(next().rgba[0]).toBe(2); // the first frame always draws
      let expected = 1;
      for (let i = 0; i < 4; i++) {
        const move = (code >> (2 * i)) & 3;
        if (move & 1) h.tick++;
        if (move & 2) h.revision++;
        const p = next();
        if (move) {
          expected++;
          expect([...p.rgba.slice(0, 3)]).toEqual([2, h.tick, h.revision]);
        } else expect(p).toBe(null);
      }
      expect(h.drawn).toBe(expected);
    }
  });

  test("a page host's camera is drawn when the state or the pose moved, through the camera given", () => {
    const h = pageHost();
    const calls = [];
    const camera = (engine, pose) => (calls.push({ ...pose }), picture(320, 200));
    const view = { camera: { x: 0, y: 0, z: 41, angle: 0 } };
    const next = viewOf(h, view, { camera });
    expect(next()).not.toBe(null);
    expect(next()).toBe(null);
    view.camera.angle = 1;
    expect(next()).not.toBe(null);
    h.revision++;
    expect(next()).not.toBe(null);
    expect(calls.map((c) => c.angle)).toEqual([0, 1, 1]);
    expect(h.drawn).toBe(0);
  });

  test("a remote host is asked every frame; it has no camera", () => {
    let asked = 0;
    const same = picture(256, 224);
    const remote = { engine: null, picture: (v) => (asked++, v === 1 ? same : null) };
    const next = viewOf(remote, { player: 1 });
    const s = new Screen();
    for (let i = 0; i < 5; i++) s.show(next());
    expect(asked).toBe(5);
    expect(s.stats.uploads).toBe(1);
    expect(s.stats.skipped).toBe(4);
    expect(viewOf(remote, { camera: { x: 0, y: 0, z: 0, angle: 0 } }, { camera: () => same })()).toBe(null);
  });

  test("a view is a player or a camera", () => {
    for (const bad of [{}, { player: "0" }, { player: 1.5 }, null]) expect(() => viewOf(pageHost(), bad)).toThrow(/a view is/);
  });
});
