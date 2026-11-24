// Doom's pictures as RGBA images, and RGBA images as PNG files. Pure but for
// the deflate, which is the platform's own (CompressionStream: browsers and
// node 18+).
//
// A wall texture is its patches laid on a canvas (TEXTURE1/2 and PNAMES); a
// flat is 64 × 64 indices. Both go through palette 0 of PLAYPAL. A pixel no
// patch covers is clear (alpha 0): the gaps in a grate.

import { flat as flatLump, patch as patchLump, readPalette, readPicture, readTextures } from "./wad.js";

/** @typedef {{ name: string, width: number, height: number, rgba: Uint8Array, clear: boolean }} Image  clear: some pixel is transparent */

/** A wall texture, composed. null when the WAD doesn't define it. */
export function wallImage(wad, name) {
  const key = `wall:${name}`;
  if (wad.cache.has(key)) return wad.cache.get(key);
  const def = readTextures(wad).get(name);
  let img = null;
  if (def && def.width > 0 && def.height > 0) {
    const pal = readPalette(wad);
    const { width, height } = def;
    const index = new Int16Array(width * height).fill(-1);
    for (const p of def.patches) {
      const bytes = p.patch ? patchLump(wad, p.patch) : null;
      if (!bytes) continue;
      const pic = pictureOf(wad, p.patch, bytes);
      for (let y = 0; y < pic.height; y++) {
        const ty = p.y + y;
        if (ty < 0 || ty >= height) continue;
        for (let x = 0; x < pic.width; x++) {
          const tx = p.x + x;
          if (tx < 0 || tx >= width) continue;
          const c = pic.pixels[y * pic.width + x];
          if (c >= 0) index[ty * width + tx] = c;
        }
      }
    }
    img = paint(name, width, height, index, pal);
  }
  wad.cache.set(key, img);
  return img;
}

function pictureOf(wad, name, bytes) {
  const key = `pic:${name}`;
  if (!wad.cache.has(key)) wad.cache.set(key, readPicture(bytes));
  return wad.cache.get(key);
}

/** A flat, 64 × 64. null when the WAD has none of that name. */
export function flatImage(wad, name) {
  const key = `flat:${name}`;
  if (wad.cache.has(key)) return wad.cache.get(key);
  const bytes = flatLump(wad, name);
  const img = bytes ? paint(name, 64, 64, Int16Array.from(bytes), readPalette(wad)) : null;
  wad.cache.set(key, img);
  return img;
}

/** Palette indices (-1 clear) → RGBA. */
export function paint(name, width, height, index, pal) {
  const rgba = new Uint8Array(width * height * 4);
  let clear = false;
  for (let i = 0; i < index.length; i++) {
    const c = index[i];
    if (c < 0) {
      clear = true;
      continue;
    }
    rgba[i * 4] = pal[c * 3];
    rgba[i * 4 + 1] = pal[c * 3 + 1];
    rgba[i * 4 + 2] = pal[c * 3 + 2];
    rgba[i * 4 + 3] = 255;
  }
  return { name, width, height, rgba, clear };
}

// ─── PNG ─────────────────────────────────────────────────────────────────────

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0xffffffff) {
  for (let i = 0; i < bytes.length; i++) crc = CRC[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return crc;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  v.setUint32(8 + data.length, (crc32(out.subarray(4, 8 + data.length)) ^ 0xffffffff) >>> 0);
  return out;
}

/** zlib (RFC 1950) deflate, which PNG's IDAT holds. */
async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** An RGBA image as a PNG file: 8-bit RGBA, no filtering. */
export async function encodePNG({ width, height, rgba }) {
  const raw = new Uint8Array(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const head = new Uint8Array(13);
  const v = new DataView(head.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  head[8] = 8; // bit depth
  head[9] = 6; // RGBA
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", await deflate(raw)), chunk("IEND", new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, at), (at += p.length);
  return out;
}
