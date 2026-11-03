// The browser's image backend: decode with createImageBitmap, crop and
// resize on an OffscreenCanvas, encode JPEG (opaque) or PNG (with alpha).
//
// Card sheets are cropped here rather than mapped with UVs: a scene object is
// one self-contained GLB (a passthrough file doc), so a UV-mapped card would
// carry its whole sheet — up to 70 cards' worth, often 4096² — in every card's
// GLB. A cropped cell is a few tens of kB.
//
// The same interface is implemented over a PNG codec for tests
// (src/test/node-images.js):
//   open(bytes, mimeType) → handle { width, height }
//   crop(handle, rect, { maxSize }) → { bytes, mimeType, width, height, hasAlpha }
//   shape(handle, rect) → "opaque" | "circle" | "cutout"
//   close(handle)

import { alphaShape, fitSize, hasAlpha, pixelRect } from "./alpha.js";

const canvas = (w, h) => (typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h }));

async function encode(c, type, quality) {
  if (c.convertToBlob) return new Uint8Array(await (await c.convertToBlob({ type, quality })).arrayBuffer());
  const blob = await new Promise((r) => c.toBlob(r, type, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

export function canvasImages({ quality = 0.85 } = {}) {
  return {
    async open(bytes, mimeType) {
      const bmp = await createImageBitmap(new Blob([bytes], { type: mimeType || "application/octet-stream" }));
      return { width: bmp.width, height: bmp.height, bmp };
    },
    async crop(h, rect, { maxSize = 512 } = {}) {
      const { sx, sy, sw, sh } = pixelRect(rect, h.width, h.height);
      const { dw, dh } = fitSize(sw, sh, maxSize);
      const c = canvas(dw, dh);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(h.bmp, sx, sy, sw, sh, 0, 0, dw, dh);
      const alpha = hasAlpha(ctx.getImageData(0, 0, dw, dh).data);
      const type = alpha ? "image/png" : "image/jpeg";
      return { bytes: await encode(c, type, quality), mimeType: type, width: dw, height: dh, hasAlpha: alpha };
    },
    async shape(h, rect) {
      const { sx, sy, sw, sh } = pixelRect(rect, h.width, h.height);
      const c = canvas(48, 48);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(h.bmp, sx, sy, sw, sh, 0, 0, 48, 48);
      return alphaShape(ctx.getImageData(0, 0, 48, 48).data, 48, 48);
    },
    close(h) {
      h?.bmp?.close?.();
    },
  };
}
