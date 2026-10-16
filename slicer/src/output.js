// Where a job's G-code goes: one current file doc per job. A slice whose bytes
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

/** A Patchwork file doc for G-code. Bytes, not a string: a string would be a collaborative text CRDT, megabytes of ops. */
export function gcodeFileDoc(title, bytes) {
  return {
    "@patchwork": { type: "file" },
    name: gcodeName(title),
    extension: "gcode",
    mimeType: "text/x-gcode",
    content: bytes,
  };
}

/**
 * Store G-code for a job, reusing its current file doc when the bytes match.
 * Never writes the job doc; the caller records { gcodeUrl, gcodeHash } in its own change.
 * @param {object} o
 * @param {object} o.repo
 * @param {object} o.job     the job doc as it is now (normalized or raw)
 * @param {string|Uint8Array} o.gcode
 * @param {string} [o.title]
 * @returns {Promise<{ url: string, hash: string, reused: boolean, bytes: Uint8Array }>}
 */
export async function saveGcode({ repo, job, gcode, title }) {
  const bytes = typeof gcode === "string" ? new TextEncoder().encode(gcode) : gcode;
  const hash = await hashBytes(bytes);
  if (job?.gcodeUrl && job?.builtFrom?.gcodeHash === hash) return { url: job.gcodeUrl, hash, reused: true, bytes };
  const handle = await repo.create2(gcodeFileDoc(title ?? job?.title, bytes));
  return { url: handle.url, hash, reused: false, bytes };
}
