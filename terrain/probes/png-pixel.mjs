// One pixel of a PNG a screenshot wrote: 8-bit RGB or RGBA, not interlaced
// (what Chrome's Page.captureScreenshot gives). For the probes' checks on a
// shot (the sky isn't black), without a decoder package.

import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/** [r, g, b] (0–255) of the pixel at (x, y) of the PNG at `path`. */
export function pngPixel(path, x, y) {
  const buf = readFileSync(path);
  let p = 8, width = 0, height = 0, type = 0, depth = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), kind = buf.toString("latin1", p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") (width = data.readUInt32BE(0)), (height = data.readUInt32BE(4)), (depth = data[8]), (type = data[9]), (interlace = data[12]);
    else if (kind === "IDAT") idat.push(data);
    else if (kind === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || (type !== 2 && type !== 6) || interlace) throw new Error(`pngPixel reads 8-bit RGB(A), not interlaced: depth ${depth}, type ${type}, interlace ${interlace}`);
  if (x < 0 || y < 0 || x >= width || y >= height) throw new Error(`(${x}, ${y}) is outside the ${width} × ${height} image`);
  const bpp = type === 6 ? 4 : 3, stride = width * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  let prev = new Uint8Array(stride), row = new Uint8Array(stride);
  for (let r = 0; r <= y; r++) {
    const f = raw[r * (stride + 1)], src = raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = src[i];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 255;
    }
    [prev, row] = [row, prev];
  }
  return [prev[x * bpp], prev[x * bpp + 1], prev[x * bpp + 2]];
}
