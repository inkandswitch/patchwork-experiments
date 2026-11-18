// scene:source "die": a die doc → its GLB, at real size (die-glb.js). The
// scene builds it whenever the die changes and shows the result; the GLB's
// `extras.dice` is what the dice extension rolls and reads (roll.js).
//
// A face with a picture (die.js `image`) is drawn with it when whoever
// builds it can crop images: `image({ file, rect })` → { bytes, mimeType }
// or null (look/look.js gives one, reading through the game's assets, so an
// imported TTS custom die shows its faces); without, its marks.

import { dieKey, dieOf } from "./die.js";
import { dieGLB } from "./die-glb.js";

/** Each pictured face's picture, cropped: face index → { bytes, mimeType }, those that could be had. */
export async function faceTextures(doc, image) {
  const out = new Map();
  if (typeof image !== "function") return out;
  const faces = dieOf(doc).faces;
  await Promise.all(
    faces.map(async (f, i) => {
      if (!f.image) return;
      const t = await Promise.resolve(image(f.image)).catch(() => null);
      if (t?.bytes?.length) out.set(i, { bytes: t.bytes, mimeType: t.mimeType ?? "image/png" });
    }),
  );
  return out;
}

export default {
  async build({ doc, image = null }) {
    const { glb, bounds } = dieGLB(doc, { textures: await faceTextures(doc, image) });
    return { kind: "glb", glb, meta: { bounds } };
  },
  // only what the die is made from: a roll in its panel, or a new title, builds nothing
  fingerprint: (doc) => dieKey(doc),
};
