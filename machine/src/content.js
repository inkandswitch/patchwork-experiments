// Content: the one byte string an engine boots from (ENGINE.md), which a
// session knows only by its SHA-256 (HOST.md, "The documents"), so that a
// game's files never enter a document. Each peer supplies its own copy. This
// module finds it: in a cache of this browser's, in an asset doc the scene
// links, or in files a viewer drops; checks each against the hash; keeps
// what checks out; and, when nothing does, says what each candidate is and
// why it is not what the session plays.
//
// Content is made of files, and a peer usually has the files, not the
// content: a WAD, a ROM. How the files make the content is the engine's
// (doom.js content() packs arguments and WADs; a Super NES's content is the
// ROM itself), so a session's content is described by a recipe, plain data
// that holds no file's bytes and so may go in any document:
//
//   { content: sha256, pack: "raw" | "parts", args?: [string], files: [{ name, size, sha256 }] }
//
//   raw    the content is its one file
//   parts  each part as a u32 length (little-endian) then its bytes: the
//          arguments (each NUL-terminated) then the files in order; this is
//          doom.js content()'s layout
//
// recipe(content, pack) derives one from content in hand, so the peer that
// starts a session can publish it next to the session's link.
//
// Nothing here knows a session or a scene: the caller passes the hash, the
// recipe if it has one, and the candidates' bytes.

const PACKS = {
  raw: {
    pack: (args, files) => {
      if (args.length || files.length !== 1) throw new Error("raw content is one file and no arguments");
      return files[0];
    },
    unpack: (content) => ({ args: [], files: [content] }),
  },
  parts: {
    pack(args, files) {
      const text = new TextEncoder().encode(args.map((a) => `${a}\0`).join(""));
      const parts = [text, ...files];
      const out = new Uint8Array(parts.reduce((n, p) => n + 4 + p.length, 0));
      const v = new DataView(out.buffer);
      let at = 0;
      for (const p of parts) {
        v.setUint32(at, p.length, true);
        out.set(p, at + 4);
        at += 4 + p.length;
      }
      return out;
    },
    unpack(content) {
      const v = new DataView(content.buffer, content.byteOffset, content.byteLength);
      const parts = [];
      for (let at = 0; at < content.length; ) {
        if (at + 4 > content.length) return null;
        const n = v.getUint32(at, true);
        if (at + 4 + n > content.length) return null;
        parts.push(content.subarray(at + 4, at + 4 + n));
        at += 4 + n;
      }
      if (!parts.length) return null;
      const text = new TextDecoder("utf-8", { fatal: true });
      let args;
      try {
        args = text.decode(parts[0]);
      } catch {
        return null;
      }
      if (args && !args.endsWith("\0")) return null;
      return { args: args ? args.slice(0, -1).split("\0") : [], files: parts.slice(1) };
    },
  },
};

/** SHA-256 as lowercase hex, as engine.js identify() gives it. */
export async function sha256(bytes) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

const packing = (name) => (typeof name === "string" && Object.hasOwn(PACKS, name) ? PACKS[name] : null);

/** Content made of files by a recipe's packing. */
export function pack(pack, args, files) {
  const p = packing(pack);
  if (!p) throw new Error(`no packing "${pack}"`);
  return p.pack(args ?? [], files);
}

/** A recipe for content in hand: its hash, and each file's name (from `names`, else "file n"), size and hash. */
export async function recipe(content, how, names = []) {
  const p = packing(how);
  if (!p) throw new Error(`no packing "${how}"`);
  const parts = p.unpack(content);
  if (!parts) throw new Error(`content is not "${how}"`);
  const files = [];
  for (const [i, f] of parts.files.entries()) files.push({ name: names[i] ?? `file ${i + 1}`, size: f.length, sha256: await sha256(f) });
  return { content: await sha256(content), pack: how, ...(how === "raw" ? {} : { args: parts.args }), files };
}

const HASH = /^[0-9a-f]{64}$/;

/**
 * A recipe read from a document is anyone's writing: its shape is checked
 * before it is used, and one that is not a recipe is refused by saying how.
 */
function checkRecipe(r) {
  const no = (why) => {
    throw new Error(`not a content recipe: ${why}`);
  };
  if (!r || typeof r !== "object") no("not an object");
  if (typeof r.content !== "string" || !HASH.test(r.content)) no("its content is not a SHA-256");
  if (!packing(r.pack)) no(`no packing ${JSON.stringify(r.pack)}`);
  if (!Array.isArray(r.files) || !r.files.length) no("it names no files");
  for (const f of r.files)
    if (!f || typeof f.name !== "string" || !Number.isSafeInteger(f.size) || f.size < 0 || typeof f.sha256 !== "string" || !HASH.test(f.sha256))
      no("a file is not { name, size, sha256 }");
  if (r.args !== undefined && !(Array.isArray(r.args) && r.args.every((a) => typeof a === "string"))) no("its args are not strings");
  if (r.pack === "raw" && (r.files.length !== 1 || r.args?.length)) no("raw content is one file and no arguments");
}

// ---------------------------------------------------------------------
// What a file is

/** Files whose hashes are known, to name them in an explanation. */
export const KNOWN = {
  "7323bcc168c5a45ff10749b339960e98314740a734c30d4b9f3337001f9e703d": "Freedoom: Phase 1, 0.13.0 (freedoom1.wad)",
  a8772e088847032510d97ba2312406a6998f21cbab44d4ff10696faa9c0ecd4b: "Freedoom: Phase 2, 0.13.0 (freedoom2.wad)",
};

const ascii = (b) => String.fromCharCode(...b);
const kb = (n) => (n >= 1 << 20 ? `${+(n / (1 << 20)).toFixed(2)} MB` : n >= 1024 ? `${+(n / 1024).toFixed(1)} KB` : `${n} bytes`);

function wad(b) {
  if (b.length < 12) return null;
  const magic = ascii(b.subarray(0, 4));
  if (magic !== "IWAD" && magic !== "PWAD") return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getInt32(4, true);
  const dir = v.getInt32(8, true);
  if (n < 0 || dir < 12 || dir + 16 * n > b.length) return null;
  const maps = [];
  for (let i = 0; i < n; i++) {
    const raw = b.subarray(dir + 16 * i + 8, dir + 16 * i + 16);
    const name = ascii(raw.subarray(0, raw.indexOf(0) < 0 ? 8 : raw.indexOf(0)));
    if (/^(E\dM\d|MAP\d\d)$/.test(name)) maps.push(name);
  }
  return { kind: "wad", type: magic, lumps: n, maps };
}

/**
 * A Super NES cartridge: the internal header at $7FC0 (LoROM) or $FFC0
 * (HiROM), after a 512-byte copier header if there is one, chosen by its
 * checksum and complement summing to $FFFF, then by a plausible map mode.
 */
function snes(b) {
  const skip = b.length % 1024 === 512 ? 512 : 0;
  const rom = b.subarray(skip);
  if (rom.length < 0x8000 || rom.length % 1024) return null;
  let best = null;
  for (const [at, mapping] of [[0x7fc0, "LoROM"], [0xffc0, "HiROM"]]) {
    if (at + 32 > rom.length) continue;
    const h = rom.subarray(at, at + 32);
    const complement = h[28] | (h[29] << 8); // $xFDC
    const sum = h[30] | (h[31] << 8); // $xFDE
    const mode = h[21];
    const valid = (sum ^ complement) === 0xffff;
    const plausible = (mode & 0xe0) === 0x20 && (mode & 0x01) === (mapping === "HiROM" ? 1 : 0);
    const score = (valid ? 2 : 0) + (plausible ? 1 : 0);
    if (score && (!best || score > best.score)) {
      const title = ascii(h.subarray(0, 21).map((c) => (c >= 0x20 && c < 0x7f ? c : 0x20))).trim();
      best = { score, title, mapping, fast: (mode & 0x10) !== 0, sum, valid };
    }
  }
  if (!best || best.score < 2) return null;
  let actual = 0;
  for (const c of rom) actual = (actual + c) & 0xffff;
  return { kind: "snes", title: best.title, mapping: best.mapping, copier: skip > 0, size: rom.length, checksum: best.sum === actual };
}

/**
 * What some bytes are, as far as can be told from them alone: a WAD, a
 * Super NES cartridge, content packed as "parts" (its arguments and files,
 * each identified), or unknown. { kind, summary, ... }; summary is one line
 * for a person.
 */
export function identify(bytes, sha = null) {
  const known = sha && KNOWN[sha];
  const w = wad(bytes);
  if (w) {
    const maps = w.maps.length ? `, ${w.maps.length} maps (${w.maps[0]}${w.maps.length > 1 ? `–${w.maps.at(-1)}` : ""})` : ", no maps";
    return { ...w, summary: `${known ?? `a Doom ${w.type}`}: ${w.lumps} lumps${maps}, ${kb(bytes.length)}` };
  }
  const s = snes(bytes);
  if (s) {
    const how = `${s.mapping}${s.copier ? ", with a copier header" : ""}${s.checksum ? "" : ", its checksum wrong (a modified copy?)"}`;
    return { ...s, summary: `a Super NES cartridge, "${s.title || "untitled"}" (${how}), ${kb(s.size)}` };
  }
  const p = bytes.length >= 4 ? PACKS.parts.unpack(bytes) : null;
  if (p && p.files.length) {
    const files = p.files.map((f) => identify(f));
    return { kind: "parts", args: p.args, files, summary: `content of ${files.length} file${files.length > 1 ? "s" : ""} (${files.map((f) => f.summary).join("; ")})${p.args.length ? `, arguments ${p.args.join(" ")}` : ""}` };
  }
  return { kind: "unknown", summary: `${known ?? "an unrecognised file"}, ${kb(bytes.length)}` };
}

// ---------------------------------------------------------------------
// The cache

/**
 * Content kept by this browser, by hash, in IndexedDB (database
 * "machine-content", store "content"). Every call is in try/catch: in a
 * private window, with storage blocked or full, or in a preview, it keeps
 * nothing and says so (`stats.failed`), and provisioning goes on without
 * it. What it gives back is checked against the hash again by the caller.
 */
export function contentCache({ indexedDB = globalThis.indexedDB, name = "machine-content" } = {}) {
  const stats = { hits: 0, misses: 0, puts: 0, failed: 0 };
  let opened = null;
  const open = () =>
    (opened ??= new Promise((resolve) => {
      try {
        if (!indexedDB) return resolve(null);
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore("content");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    }));
  const run = (mode, f) =>
    open().then(
      (db) =>
        db &&
        new Promise((resolve) => {
          try {
            const tx = db.transaction("content", mode);
            const req = f(tx.objectStore("content"));
            let value;
            req.onsuccess = () => (value = req.result);
            tx.oncomplete = () => resolve({ value });
            tx.onerror = tx.onabort = () => resolve(null);
          } catch {
            resolve(null);
          }
        }),
    );
  return {
    stats,
    /** The bytes kept for a hash, or null. */
    async get(hash) {
      const r = await run("readonly", (s) => s.get(hash));
      if (!r) stats.failed++;
      const v = r?.value;
      const bytes = v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null;
      if (bytes) stats.hits++;
      else stats.misses++;
      return bytes;
    },
    /** Keeps bytes under their hash; whether it could. */
    async put(hash, bytes) {
      const r = await run("readwrite", (s) => s.put(bytes, hash));
      if (r) stats.puts++;
      else stats.failed++;
      return !!r;
    },
    /** Forgets a hash (content that no longer checks out). */
    async delete(hash) {
      await run("readwrite", (s) => s.delete(hash));
    },
  };
}

// ---------------------------------------------------------------------
// Provisioning

/**
 * A candidate from a Patchwork `file` doc (an asset the scene links:
 * { name, extension, content: bytes }), or null if it holds no bytes.
 * Copied from the scene package's reading of file docs, not imported.
 */
export function fileCandidate(doc) {
  const c = doc?.content;
  const bytes = c instanceof Uint8Array ? c : c instanceof ArrayBuffer ? new Uint8Array(c) : ArrayBuffer.isView(c) ? new Uint8Array(c.buffer, c.byteOffset, c.byteLength) : null;
  if (!bytes) return null;
  const ext = doc.extension ? `.${String(doc.extension).replace(/^\./, "")}` : "";
  const name = String(doc.name ?? "file");
  return { name: ext && !name.toLowerCase().endsWith(ext.toLowerCase()) ? name + ext : name, bytes };
}

/**
 * Finds the content whose SHA-256 is `want`.
 *
 * @param want        the session's content hash (session.engine.content)
 * @param o.recipe    how the content is made of files (recipe()), if known
 * @param o.cache     contentCache(), or null
 * @param o.candidates  [{ name, bytes }]: an asset doc's file, files dropped, in order of preference
 * @returns { ok: true, bytes, from: "cache" | name, made: boolean }
 *        or { ok: false, needs, explain: [{ name, what, why }] }
 *
 * A candidate is the content itself, or, with a recipe, one of its files;
 * once every file is at hand they are packed and the result checked. What
 * checks out is cached. Each candidate that is neither gets an explanation.
 */
export async function provide(want, { recipe: r = null, cache = null, candidates = [] } = {}) {
  if (cache) {
    const kept = await cache.get(want);
    if (kept) {
      if ((await sha256(kept)) === want) return { ok: true, bytes: kept, from: "cache", made: false };
      await cache.delete(want); // corrupt: forget it and look on
    }
  }
  if (r) checkRecipe(r);
  if (r && r.content !== want) throw new Error(`the recipe is for content ${r.content.slice(0, 12)}…, not ${want.slice(0, 12)}…`);
  const found = new Map(); // file hash -> bytes
  const seen = [];
  const done = async (bytes, from, made) => {
    if (cache) await cache.put(want, bytes);
    return { ok: true, bytes, from, made };
  };
  let madeOther = null; // what the recipe's files made, when that was not the content
  const tryRecipe = async () => {
    if (!r || !r.files.every((f) => found.has(f.sha256))) return null;
    const bytes = pack(r.pack, r.args ?? [], r.files.map((f) => found.get(f.sha256)));
    const sha = await sha256(bytes);
    if (sha === want) return bytes;
    madeOther = sha;
    return null;
  };
  for (const c of candidates) {
    const bytes = c.bytes instanceof Uint8Array ? c.bytes : new Uint8Array(c.bytes);
    const sha = await sha256(bytes);
    if (sha === want) return done(bytes, c.name, false);
    const use = [];
    if (r) {
      if (r.files.some((f) => f.sha256 === sha)) use.push([sha, bytes]);
      // Content packed the same way may hold the files.
      const inner = packing(r.pack).unpack(bytes);
      if (inner && r.pack !== "raw") for (const f of inner.files) use.push([await sha256(f), f]);
    }
    let useful = false;
    for (const [h, b] of use)
      if (r.files.some((f) => f.sha256 === h)) {
        found.set(h, b);
        useful = true;
      }
    seen.push({ name: c.name, bytes, sha, useful });
    const made = await tryRecipe();
    if (made) return done(made, c.name, true);
  }
  const needs = r ? r.files.filter((f) => !found.has(f.sha256)) : [];
  const out = { ok: false, needs, explain: seen.filter((s) => !s.useful).map((s) => explain(want, r, s)) };
  // Every file it names is here and still no content: the recipe is wrong, not the files.
  if (madeOther) out.recipe = `every file the recipe names is here, but packed as it says they make ${madeOther.slice(0, 12)}…, not the session's ${want.slice(0, 12)}…: the recipe is not this content's`;
  return out;
}

/** Why a candidate is not the content, or one of its files, in words. */
function explain(want, r, { name, bytes, sha }) {
  const what = identify(bytes, sha);
  const short = (h) => `${h.slice(0, 12)}…`;
  let why;
  if (!r) {
    why = `its SHA-256 is ${short(sha)}; the session's content is ${short(want)}, and without the session's recipe no file can be made into it`;
  } else {
    const sameName = r.files.find((f) => f.name.toLowerCase() === String(name ?? "").toLowerCase());
    const sameSize = r.files.find((f) => f.size === bytes.length);
    if (sameName) why = `the session plays another ${sameName.name}: ${kb(sameName.size)}, SHA-256 ${short(sameName.sha256)}${KNOWN[sameName.sha256] ? ` (${KNOWN[sameName.sha256]})` : ""}; this one is ${kb(bytes.length)}, ${short(sha)}${sameName.size === bytes.length ? " (the same size: another revision, or a modified copy)" : ""}`;
    else if (sameSize) why = `it is the size of ${sameSize.name} but not that file (SHA-256 ${short(sha)}, not ${short(sameSize.sha256)}): another revision, or a modified copy`;
    else why = `it is not one of the session's files, which ${r.files.length === 1 ? "is" : "are"} ${r.files.map((f) => `${f.name} (${kb(f.size)}${KNOWN[f.sha256] ? `, ${KNOWN[f.sha256]}` : ""})`).join(", ")}`;
  }
  return { name, what: what.summary, why };
}
