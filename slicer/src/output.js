// Where a job's G-code goes: one current file doc per job, gzip-compressed.
// G-code is enormous and repetitive (a 31 cm print at 0.2 mm layers is ~150 MB
// of text, ~6M lines) and compresses about tenfold; stored raw, every automatic
// re-slice of a big model would push a 100+ MB doc to the sync server. Above
// MAX_STORED_BYTES even compressed, nothing is stored: the job records the
// slice (builtFrom, stats) with gcodeUrl null, and the G-code is downloaded
// from the view that sliced it. A slice whose bytes
// hash the same as the current G-code's (builtFrom.gcodeHash) keeps that doc,
// so re-slicing after a change that doesn't alter the output (a source rename
// that changed heads, a setting changed and changed back, a peer's identical
// slice) writes no new doc and leaves gcodeUrl alone. New bytes make a new
// immutable file doc and repoint gcodeUrl; superseded ones are orphaned, like
// the scene's GLBs.

/** A content hash: SHA-256 hex where WebCrypto exists, else a 53-bit hash. (As scene/src/build.js.) */
export async function hashBytes(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
    return `sha256:${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")}`;
  }
  let h1 = 0xdeadbeef ^ bytes.length;
  let h2 = 0x41c6ce57 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `c53:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)}`;
}

/** "Hull (3D render)" → "Hull.gcode" */
export function gcodeName(title) {
  const base = String(title || "slice")
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim();
  return `${base || "slice"}.gcode`;
}

/** The most compressed G-code a job stores (bytes). */
export const MAX_STORED_BYTES = 24 * 1024 * 1024;

async function pipeThrough(bytes, stream) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
}
export const gzip = (bytes) => pipeThrough(bytes, new CompressionStream("gzip"));
export const gunzip = (bytes) => pipeThrough(bytes, new DecompressionStream("gzip"));

/**
 * A Patchwork file doc for G-code, gzip-compressed (`contentEncoding: "gzip"`,
 * name `….gcode.gz`). Bytes, not a string: a string would be a collaborative
 * text CRDT, megabytes of ops.
 */
export function gcodeFileDoc(title, gzBytes) {
  return {
    "@patchwork": { type: "file" },
    name: `${gcodeName(title)}.gz`,
    extension: "gz",
    mimeType: "application/gzip",
    contentEncoding: "gzip",
    content: gzBytes,
  };
}

/** The G-code text in a stored file doc: gzip (this slicer) or plain (older docs). */
export async function readGcode(doc, fileBytes) {
  const bytes = fileBytes(doc);
  const gz = doc?.contentEncoding === "gzip" || (bytes[0] === 0x1f && bytes[1] === 0x8b);
  return new TextDecoder().decode(gz ? await gunzip(bytes) : bytes);
}

/**
 * Store G-code for a job, reusing its current file doc when the bytes match.
 * Never writes the job doc; the caller records { gcodeUrl, gcodeHash } in its own change.
 * @param {object} o
 * @param {object} o.repo
 * @param {object} o.job     the job doc as it is now (normalized or raw)
 * @param {string|Uint8Array} o.gcode
 * @param {string} [o.title]
 * @returns {Promise<{ url: string | null, hash: string, reused: boolean, bytes: Uint8Array, storedBytes: number | null, tooLarge?: true }>}
 */
export async function saveGcode({ repo, job, gcode, title, maxStored = MAX_STORED_BYTES }) {
  const bytes = typeof gcode === "string" ? new TextEncoder().encode(gcode) : gcode;
  const hash = await hashBytes(bytes); // of the G-code itself, so dedupe doesn't depend on the compressor
  if (job?.gcodeUrl && job?.builtFrom?.gcodeHash === hash) return { url: job.gcodeUrl, hash, reused: true, bytes, storedBytes: null };
  const gz = await gzip(bytes);
  if (gz.byteLength > maxStored) return { url: null, hash, reused: false, bytes, storedBytes: gz.byteLength, tooLarge: true };
  const handle = await repo.create2(gcodeFileDoc(title ?? job?.title, gz));
  return { url: handle.url, hash, reused: false, bytes, storedBytes: gz.byteLength };
}
