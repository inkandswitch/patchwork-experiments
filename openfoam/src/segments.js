// Big byte arrays, split across documents.
//
// ┌─ WORKAROUND, 2026-11-15. If it is December 2026 or later, check whether
// │  this is still needed, and retire it if not.
// │
// │  Measured against wss://subduction.sync.inkandswitch.com with
// │  automerge-repo 2.6.0-subduction.43 (probes/bulk-bench.mjs):
// │   · one 34 MB doc never reached the server: no error, ten minutes
// │     waiting. Docs up to 24 MB did (and a 92 MB file doc never reached a
// │     fresh peer, 2026-11-14);
// │   · fetching ran at 0.8–2 MB/s, whatever the chunk size or how many at
// │     once, and a doc that takes longer than the repo's 60 s sync timeout to
// │     arrive is reported "unavailable" (eight 8 MB fetches at once all
// │     failed that way);
// │   · the server's acknowledgement of a doc (its heads, reported back)
// │     sometimes never comes: 1 of 19, and 1 of 81 even after asking for
// │     more sync rounds. The one we chased was on the server all along (a
// │     fresh peer fetched it in 130 ms); the 34 MB doc above was not.
// │  Hence: no doc holds more than SEGMENT_BYTES of bytes, readers fetch a
// │  couple of segments at a time and check a digest, and a writer that can
// │  wait (a run) confirms each segment reached the server: by its
// │  acknowledgement, or failing that by a fresh peer fetching it.
// │
// │  To check: `node probes/bulk-bench.mjs post --case <a run dir>
// │  --chunk-mb 0`, then `get --url <index> --parallel 8`. If one big doc
// │  posts and fetches near link speed, and nothing goes missing (and
// │  `probes/volume-run.mjs keep` reports verified: 0, every doc
// │  acknowledged), store bytes
// │  inline again: drop putBytes/externalize (writers), keep getBytes/
// │  internalize (readers) until old docs are gone, then drop those too.
// └─
//
// What it is: a ref ({ "@segments": [url, …], size, sha256 }) stands where
// the bytes would; the bytes are cut into `openfoam-segment` docs
// ({ index, of, data }) in order. Anything that holds bytes reads them
// through getBytes or internalize, which take inline bytes or a ref alike.
// Segments are written once and never changed, so a ref can be copied (a
// rerun reuses its run's STL segments).
//
// Splitting by meaning comes first: a caller makes one ref per thing a
// reader might want on its own (a field on one processor, a mesh file), and
// this splits only what's still too big.

import { findWhenThere } from "./task-runs.js";

export const SEGMENT_TYPE = "openfoam-segment";
/** No doc holds more bytes than this (see the workaround note above). */
export const SEGMENT_BYTES = 4 * 1024 * 1024;
/** Arrays smaller than this stay inline when a doc is externalized. */
export const INLINE_BYTES = 64 * 1024;
/** Segments fetched at once: more only share the same server bandwidth and risk the 60 s timeout. */
export const FETCH_PARALLEL = 2;

/** Is this a ref to segmented bytes? */
export const isRef = (v) => !!v && typeof v === "object" && !ArrayBuffer.isView(v) && Array.isArray(v["@segments"]);

const asBytes = (v) => (v instanceof Uint8Array ? v : ArrayBuffer.isView(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : new Uint8Array(v));

/** SHA-256 in hex (Web Crypto: browser and node alike). */
export async function sha256(bytes) {
  const buf = await crypto.subtle.digest("SHA-256", asBytes(bytes));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** How to cut `size` bytes: [from, to) pairs of at most `segmentBytes`; one empty piece for nothing. */
export function cuts(size, segmentBytes = SEGMENT_BYTES) {
  if (!(segmentBytes > 0)) throw new Error("segmentBytes must be positive");
  if (size === 0) return [[0, 0]];
  const out = [];
  for (let o = 0; o < size; o += segmentBytes) out.push([o, Math.min(size, o + segmentBytes)]);
  return out;
}

/**
 * Write bytes as segment docs.
 * @returns {Promise<{ ref: { "@segments": string[], size: number, sha256: string }, handles: object[] }>}
 */
export async function putBytes(repo, bytes, { segmentBytes = SEGMENT_BYTES, title = null } = {}) {
  const b = asBytes(bytes);
  const pieces = cuts(b.byteLength, segmentBytes);
  const handles = [];
  for (let i = 0; i < pieces.length; i++) {
    const [from, to] = pieces[i];
    handles.push(await repo.create2({ "@patchwork": { type: SEGMENT_TYPE }, ...(title ? { title: `${title} · ${i + 1}/${pieces.length}` } : {}), index: i, of: pieces.length, data: b.slice(from, to) }));
  }
  return { ref: { "@segments": handles.map((h) => h.url), size: b.byteLength, sha256: await sha256(b) }, handles };
}

/**
 * Bytes, inline or from a ref, checked against the ref's size and digest.
 * @returns {Promise<Uint8Array|null>}  null for null/undefined
 */
export async function getBytes(repo, v, { parallel = FETCH_PARALLEL, find = findWhenThere } = {}) {
  if (v == null) return null;
  if (!isRef(v)) return asBytes(v);
  const urls = v["@segments"];
  const parts = new Array(urls.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(parallel, urls.length) }, async () => {
      while (next < urls.length) {
        const i = next++;
        const d = (await find(repo, urls[i])).doc();
        if (d?.["@patchwork"]?.type !== SEGMENT_TYPE || d.index !== i || d.of !== urls.length) throw new Error(`${urls[i]} isn't segment ${i + 1} of ${urls.length}`);
        parts[i] = asBytes(d.data);
      }
    }),
  );
  const out = new Uint8Array(v.size);
  let o = 0;
  for (const p of parts) {
    if (o + p.byteLength > v.size) throw new Error(`segments hold more than the ${v.size} bytes they should`);
    out.set(p, o);
    o += p.byteLength;
  }
  if (o !== v.size) throw new Error(`segments hold ${o} bytes, not ${v.size}`);
  if ((await sha256(out)) !== v.sha256) throw new Error("segments don't match their digest");
  return out;
}

/** Bytes held inline anywhere in a plain value (refs count nothing). */
export function inlineBytes(v) {
  if (v == null || typeof v !== "object" || isRef(v)) return 0;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  let n = 0;
  for (const x of Array.isArray(v) ? v : Object.values(v)) n += inlineBytes(x);
  return n;
}

/**
 * A doc's contents ready to write: as it is when its bytes fit in one doc
 * (`budget`), else with every array of INLINE_BYTES or more replaced by a ref.
 * @returns {Promise<{ value: any, handles: object[] }>}  handles: the segment docs made
 */
export async function externalize(repo, value, { budget = SEGMENT_BYTES, segmentBytes = SEGMENT_BYTES, inline = INLINE_BYTES, title = null } = {}) {
  const handles = [];
  if (inlineBytes(value) <= budget) return { value, handles };
  const walk = async (v, path) => {
    if (v == null || typeof v !== "object" || isRef(v)) return v;
    if (ArrayBuffer.isView(v)) {
      if (v.byteLength < inline) return v;
      const r = await putBytes(repo, v, { segmentBytes, title: title ? `${title} · ${path}` : null });
      handles.push(...r.handles);
      return r.ref;
    }
    if (Array.isArray(v)) {
      const out = [];
      for (let i = 0; i < v.length; i++) out.push(await walk(v[i], `${path}[${i}]`));
      return out;
    }
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = await walk(x, path ? `${path}.${k}` : k);
    return out;
  };
  return { value: await walk(value, ""), handles };
}

/** A doc's contents with every ref replaced by its bytes (a copy; the doc itself is untouched). */
export async function internalize(repo, value, opts) {
  if (value == null || typeof value !== "object") return value;
  if (isRef(value)) return getBytes(repo, value, opts);
  if (ArrayBuffer.isView(value)) return value;
  if (Array.isArray(value)) {
    const out = [];
    for (const x of value) out.push(await internalize(repo, x, opts));
    return out;
  }
  const out = {};
  for (const [k, x] of Object.entries(value)) out[k] = await internalize(repo, x, opts);
  return out;
}

/**
 * Watches which docs the sync server has, so a writer can wait for what it
 * made to be there. Start it before making the docs: the server's answer can
 * come before anyone asks.
 *
 * The server acknowledges a doc by reporting its heads ("subduction-remote-
 * heads"); a doc is there when they equal ours. But an acknowledgement can go
 * missing while the doc arrived (2026-11-15: one of 81 never came, and a
 * fresh peer fetched that doc at once). So when acknowledgements don't come
 * within `ackMs`, `verify` (see freshPeer) asks a separate peer to fetch the
 * rest; only what it can't get, after asking for another sync round and
 * trying again until `timeoutMs`, is missing.
 *
 * Only a repo that reports the server's heads (automerge-repo's Subduction
 * source) can confirm; with any other repo `available` is false and `wait`
 * resolves at once with ok: null (unknown).
 */
export function serverWatch(repo) {
  const seen = new Map(); // documentId → sorted heads joined
  const waiters = new Set();
  const available = typeof repo?.on === "function" && typeof repo?.resyncSubduction === "function";
  const key = (heads) => [...heads].map(String).sort().join(",");
  const onHeads = ({ documentId, heads }) => {
    seen.set(documentId, key(heads));
    for (const w of waiters) w();
  };
  if (available) repo.on("subduction-remote-heads", onHeads);
  const has = (h) => seen.get(h.documentId) === key(h.heads());

  /** Acknowledgements for these, for up to `ms`: the handles still without one. */
  const acks = (handles, ms, resyncEveryMs) =>
    new Promise((resolve) => {
      const left = () => handles.filter((h) => !has(h));
      let timer, resync;
      const finish = () => {
        waiters.delete(check);
        clearTimeout(timer);
        clearInterval(resync);
        resolve(left());
      };
      const check = () => left().length === 0 && finish();
      waiters.add(check);
      // a doc the server hasn't acknowledged: ask for another sync round
      resync = setInterval(() => {
        for (const h of left()) repo.resyncSubduction(h.documentId);
      }, resyncEveryMs);
      timer = setTimeout(finish, Math.max(0, ms));
      check();
    });

  /**
   * Wait until the server has every one of these handles at their current heads.
   * @param {object[]} handles
   * @param {{ timeoutMs?: number, ackMs?: number, resyncEveryMs?: number, verify?: (urls: string[]) => Promise<string[]> }} [o]
   *   verify: given urls, the ones a fresh peer couldn't fetch
   * @returns {Promise<{ ok: boolean|null, missing: string[], verified: number }>}  verified: docs found by fetching, not acknowledged
   */
  const wait = async (handles, { timeoutMs = 300_000, ackMs = 60_000, resyncEveryMs = 20_000, verify = null } = {}) => {
    if (!available) return { ok: null, missing: [], verified: 0 };
    // no sync server connected (a repo without one, or offline just now): nothing will acknowledge
    if (typeof repo.connectedSubductionPeerIds === "function" && !(await repo.connectedSubductionPeerIds().catch(() => [])).length) return { ok: null, missing: [], verified: 0 };
    const deadline = Date.now() + timeoutMs;
    let left = handles, verified = 0;
    for (;;) {
      left = await acks(left, Math.min(ackMs, deadline - Date.now()), resyncEveryMs);
      if (!left.length) return { ok: true, missing: [], verified };
      if (verify) {
        const gone = new Set(await verify(left.map((h) => h.url)));
        for (const h of left) if (!gone.has(h.url)) seen.set(h.documentId, key(h.heads()));
        verified += left.filter((h) => !gone.has(h.url)).length;
        left = left.filter((h) => gone.has(h.url));
        if (!left.length) return { ok: true, missing: [], verified };
      }
      if (Date.now() >= deadline) return { ok: false, missing: left.map((h) => h.url), verified };
    }
  };
  return { available, wait, has, dispose: () => available && repo.off?.("subduction-remote-heads", onHeads) };
}

/**
 * A check that docs are on the sync server the way a reader would find out:
 * a separate peer (its own repo, nothing stored) fetching them. For
 * serverWatch's `verify`. The peer is made on first use.
 * @param {() => object|Promise<object>} makeRepo   a fresh repo on the same sync server
 * @returns {{ verify: (urls: string[]) => Promise<string[]>, close: () => Promise<void> }}
 */
export function freshPeer(makeRepo, { tries = 2, parallel = FETCH_PARALLEL } = {}) {
  let peer = null;
  const verify = async (urls) => {
    peer ??= await makeRepo();
    const gone = [];
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(parallel, urls.length) }, async () => {
        while (next < urls.length) {
          const u = urls[next++];
          try {
            await findWhenThere(peer, u, { tries });
          } catch {
            gone.push(u);
          }
        }
      }),
    );
    return gone;
  };
  return { verify, close: async () => peer?.shutdown?.().catch(() => {}) };
}
