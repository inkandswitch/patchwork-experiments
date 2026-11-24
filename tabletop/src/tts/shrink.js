// An image too big to keep (over the import's maxStoredBytes), made smaller
// instead of dropped: the same picture at half the width and height, again
// until it fits (at most four halvings, a sixteenth of the size), in its own
// format (a PNG stays a PNG: alpha kept, and every reader of a GLB reads it;
// a GIF becomes a PNG). Only where the page can decode and encode images
// (createImageBitmap and OffscreenCanvas, as in Patchwork's tab); elsewhere
// (Node, a test) there is no shrinker and the image isn't kept, as before.
// A card sheet keeps its layout: its grid is in fractions of the picture.

const TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "png", "image/webp": "png" };

/** The browser's shrinker, or null where images can't be re-encoded here. */
export function browserShrink() {
  if (typeof globalThis.createImageBitmap !== "function" || typeof globalThis.OffscreenCanvas !== "function") return null;
  return async (bytes, { mimeType, limit }) => {
    const type = mimeType === "image/jpeg" ? "image/jpeg" : "image/png";
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
    try {
      let { width, height } = bitmap;
      for (let n = 0; n < 4; n++) {
        width = Math.max(1, Math.floor(width / 2));
        height = Math.max(1, Math.floor(height / 2));
        const canvas = new OffscreenCanvas(width, height);
        canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
        const out = new Uint8Array(await (await canvas.convertToBlob({ type, quality: 0.9 })).arrayBuffer());
        if (out.byteLength <= limit) return { bytes: out, mimeType: type, extension: TYPES[type], width, height };
      }
      return null;
    } finally {
      bitmap.close?.();
    }
  };
}
