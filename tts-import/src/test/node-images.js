// The image backend (see src/images.js) over the test PNG codec: PNG only,
// nearest-neighbour resizing. Lets the whole import run in vitest.
import { alphaShape, fitSize, hasAlpha, pixelRect } from "../alpha.js";
import { decodePNG, encodePNG } from "./png.js";

function resample(src, sx, sy, sw, sh, dw, dh) {
  const out = new Uint8Array(dw * dh * 4);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const px = sx + Math.min(sw - 1, Math.floor(((x + 0.5) * sw) / dw));
      const py = sy + Math.min(sh - 1, Math.floor(((y + 0.5) * sh) / dh));
      const s = (py * src.width + px) * 4;
      out.set(src.data.subarray(s, s + 4), (y * dw + x) * 4);
    }
  return out;
}

export function nodeImages() {
  const log = { opened: 0, crops: [] };
  return {
    log,
    async open(bytes, mimeType) {
      if (mimeType && mimeType !== "image/png") throw new Error(`test images: can't decode ${mimeType}`);
      log.opened++;
      return decodePNG(bytes);
    },
    async crop(h, rect, { maxSize = 512 } = {}) {
      const { sx, sy, sw, sh } = pixelRect(rect, h.width, h.height);
      const { dw, dh } = fitSize(sw, sh, maxSize);
      const px = resample(h, sx, sy, sw, sh, dw, dh);
      log.crops.push({ sx, sy, sw, sh, dw, dh });
      return { bytes: encodePNG(dw, dh, px), mimeType: "image/png", width: dw, height: dh, hasAlpha: hasAlpha(px) };
    },
    async shape(h, rect) {
      const { sx, sy, sw, sh } = pixelRect(rect, h.width, h.height);
      return alphaShape(resample(h, sx, sy, sw, sh, 48, 48), 48, 48);
    },
    close() {},
  };
}
