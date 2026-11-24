// What a downloaded asset is, from its first bytes. Pure. TTS URLs rarely end
// in an extension (Steam's never do), so the bytes decide.

export function sniff(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes ?? []);
  const at = (i, ...v) => v.every((x, k) => b[i + k] === x);
  if (b.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return { mimeType: "image/png", extension: "png", image: true };
  if (b.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return { mimeType: "image/jpeg", extension: "jpg", image: true };
  if (b.length >= 6 && at(0, 0x47, 0x49, 0x46, 0x38)) return { mimeType: "image/gif", extension: "gif", image: true };
  if (b.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return { mimeType: "image/webp", extension: "webp", image: true };
  if (b.length >= 2 && at(0, 0x42, 0x4d)) return { mimeType: "image/bmp", extension: "bmp", image: true };
  if (b.length >= 5 && at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return { mimeType: "application/pdf", extension: "pdf", image: false };
  if (b.length >= 4 && at(0, 0x55, 0x6e, 0x69, 0x74)) return { mimeType: "application/octet-stream", extension: "unity3d", image: false }; // "UnityFS"
  // OBJ is text: lines of v / vt / vn / f / # / o / g / mtllib
  const head = new TextDecoder("utf-8", { fatal: false }).decode(b.subarray(0, 2048));
  if (/^(\s*(#.*|v|vt|vn|f|o|g|s|mtllib|usemtl)(\s.*)?\r?\n)+/m.test(head) && /(^|\n)\s*v\s+-?[\d.]/.test(head)) return { mimeType: "model/obj", extension: "obj", image: false };
  if (/^\s*[{[]/.test(head)) return { mimeType: "application/json", extension: "json", image: false };
  if (/^\s*</.test(head)) return { mimeType: "text/html", extension: "html", image: false };
  return { mimeType: "application/octet-stream", extension: "bin", image: false };
}
