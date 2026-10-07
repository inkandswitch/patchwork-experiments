// Reading the bytes out of a Patchwork `file` doc. Content may be a Uint8Array
// (binary uploads), a string, or an automerge ImmutableString.

export function fileBytes(doc) {
  const c = doc?.content;
  if (c instanceof Uint8Array) return c;
  if (c instanceof ArrayBuffer) return new Uint8Array(c);
  if (ArrayBuffer.isView(c)) return new Uint8Array(c.buffer, c.byteOffset, c.byteLength);
  if (typeof c === "string") return new TextEncoder().encode(c);
  if (c != null && typeof c.toString === "function") return new TextEncoder().encode(String(c));
  throw new Error("file has no content");
}

/** Either the bytes or the text, whichever the doc holds (STL parsing takes both). */
export function fileContent(doc) {
  const c = doc?.content;
  if (c == null) throw new Error("file has no content");
  if (typeof c === "string" || c instanceof Uint8Array) return c;
  if (ArrayBuffer.isView(c)) return new Uint8Array(c.buffer, c.byteOffset, c.byteLength);
  if (typeof c.toString === "function") return String(c);
  throw new Error("file has unreadable content");
}

/** A copy of the bytes as a standalone ArrayBuffer (what GLTFLoader.parse wants). */
export function toArrayBuffer(bytes) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

export function stripExtension(name) {
  return String(name ?? "").replace(/\.[^./\\]+$/, "");
}
