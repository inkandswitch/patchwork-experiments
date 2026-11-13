// A screen: a machine's picture as a three.js texture, kept current.
//
// A host draws pictures ({ width, height, rgba }, row 0 at the top, sRGB
// bytes); a scene draws textures. Screen holds one DataTexture for the
// screen's life and points it at each new picture's bytes: no copy in JS
// (a picture is already a fresh copy out of the engine, or a buffer the
// worker transferred), one upload per new picture, and none when the
// picture is the one already shown. A new size (a camera outside a level is
// 0 by 0; a Super NES game switching to overscan or hi-res) frees the GPU
// texture and keeps the same Texture object, so a material holding it
// never needs telling.
//
// Pixel art: nearest filtering both ways and no mipmaps, so each machine
// pixel stays a sharp rectangle; sRGB, since the bytes are palette colours
// as the machine shows them. The picture's top row is the texture's top:
// the flip is the texture's uv transform (repeat -1, offset 1), so nothing
// is copied to flip it; a ShaderMaterial of the scene's own must apply
// `texture.matrix` as three's materials do.
//
// Aspect is not the picture's: machines of this era drew non-square pixels.
// `aspect` is the shape a screen should have, width over height:
//   Doom:      320x200 shown as 4:3 (pixels 5:6, taller than wide);
//   Super NES: 256 dots at 8:7 (wider than tall), over 224 or 239 lines,
//              the same shape in hi-res (512 wide) and interlace (448/478).
//
// The only module here that imports three (a peer dependency: the scene's).

import { ClampToEdgeWrapping, DataTexture, NearestFilter, RGBAFormat, SRGBColorSpace, UnsignedByteType } from "three";

/** Display aspect (width / height) of a picture of w by h, per machine. */
export const ASPECT = {
  /** Square pixels: what the picture's own shape says. */
  square: (w, h) => w / h,
  /** Doom: every picture is 320x200 shown at 4:3. */
  doom: () => 4 / 3,
  /** Super NES: 256 dots of 8:7 across, the lines down (halved when interlaced). */
  snes: (w, h) => (256 * 8) / 7 / (h > 239 ? h / 2 : h),
};

const BLACK = { width: 1, height: 1, rgba: new Uint8Array([0, 0, 0, 255]) };

export class Screen {
  /** The texture to draw; the same object for the screen's life. */
  texture;
  /** Counts, for measuring: uploads (pictures handed to the GPU), resizes, skipped (same picture again). */
  stats = { uploads: 0, resizes: 0, skipped: 0 };
  #shape;
  #shown = null; // the picture the texture holds
  #aspect;

  /** @param {{ aspect?: (w: number, h: number) => number }} o   ASPECT.doom, ASPECT.snes, ... (default square) */
  constructor({ aspect = ASPECT.square } = {}) {
    this.#shape = aspect;
    const t = new DataTexture(BLACK.rgba, 1, 1, RGBAFormat, UnsignedByteType);
    t.colorSpace = SRGBColorSpace;
    t.magFilter = t.minFilter = NearestFilter;
    t.generateMipmaps = false;
    t.wrapS = t.wrapT = ClampToEdgeWrapping;
    t.flipY = false;
    t.repeat.set(1, -1);
    t.offset.set(0, 1);
    t.needsUpdate = true;
    this.texture = t;
    this.#aspect = aspect(4, 3);
  }

  /**
   * Shows a picture. null (nothing drawn yet, or this frame) keeps what is
   * shown; an empty one (0 by 0) shows black. Returns whether the texture
   * changed. The picture's bytes are the texture's from here on: the
   * caller must not write them (a host never does).
   */
  show(picture) {
    if (!picture) return false;
    if (picture === this.#shown) {
      this.stats.skipped++;
      return false;
    }
    const p = picture.width && picture.height ? picture : BLACK;
    const { rgba } = p;
    if (rgba.length !== p.width * p.height * 4) throw new Error(`a ${p.width}x${p.height} picture needs ${p.width * p.height * 4} bytes, not ${rgba.length}`);
    const t = this.texture;
    const img = t.image;
    if (img.width !== p.width || img.height !== p.height) {
      t.dispose(); // the GPU texture's storage is fixed at its size; the next draw makes a new one
      this.stats.resizes++;
    }
    // A view, not a copy: WebGL takes Uint8Array for UNSIGNED_BYTE.
    t.image = { data: rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), width: p.width, height: p.height };
    t.needsUpdate = true;
    if (p !== BLACK) this.#aspect = this.#shape(p.width, p.height);
    this.#shown = picture;
    this.stats.uploads++;
    return true;
  }

  /** Width over height, as the machine meant the picture to be seen. */
  get aspect() {
    return this.#aspect;
  }

  dispose() {
    this.texture.dispose();
    this.#shown = null;
  }
}

/**
 * What a screen draws: a named view, as plain data a scene can store on the
 * screen object.
 *   { player: n }                   that port's own view (frame(n)): its
 *                                   eyes, HUD and status bar included
 *   { camera: { x, y, z, angle } }  Doom only: the engine's renderer from
 *                                   anywhere in the map (map units, radians;
 *                                   doom.js camera()), no HUD
 *
 * Returns a function to call every frame that gives the newest picture, or
 * null when there is nothing new to show, so Screen.show uploads only what
 * changed:
 * - a host on the page (Host) draws only when its tick or revision moved
 *   (a rollback can re-step to the same tick and reach another state;
 *   revision counts steps and restores);
 * - a RemoteHost must be asked every frame (asking is what makes its
 *   worker draw), and hands back the same object until a new one arrives,
 *   which Screen.show skips.
 * A camera needs the engine itself, so it is drawn only by a host on the
 * page; a RemoteHost has none (`engine` is null) and the view gives null.
 *
 * @param host     Host or RemoteHost
 * @param view     as above
 * @param camera   doom.js camera, passed in so this module needs no engine's code
 */
export function viewOf(host, view, { camera } = {}) {
  const port = view?.player;
  const pose = view?.camera;
  if (!Number.isInteger(port) && !pose) throw new Error(`a view is { player } or { camera }, not ${JSON.stringify(view)}`);
  let drawn = null; // `${tick}:${revision}:${pose}` of the last picture drawn here
  return () => {
    // No engine here: a RemoteHost (ask it every frame), or a Host still loading (it gives null).
    if (!host.engine) return pose ? null : host.picture(port);
    const key = `${host.tick}:${host.revision}:${pose ? `${pose.x},${pose.y},${pose.z},${pose.angle}` : ""}`;
    if (key === drawn) return null;
    const p = pose ? (camera ? camera(host.engine, pose) : null) : host.picture(port);
    if (p) drawn = key;
    return p;
  };
}
