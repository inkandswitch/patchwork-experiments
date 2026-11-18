// Each kind of piece of a game doc is drawn (look/look.js) as a GLB `file`
// doc the game keeps (`drawn[kind] = { url, key, bounds, missing? }`), the
// first time something needs to show it; every copy of that piece on every
// table set up from the game shows the same doc. Editing a piece redraws its
// GLB in place, so the tables already set up change with it. `drawn` is
// bookkeeping beside the game, never part of it (GAME-FORMAT.md §10).
//
// What needs a kind drawn:
//   - setting up a table: what a table lays out (its things, a card's back,
//     what's in a bag), all at once (`ensure`);
//   - a card's face, when a keeper is to show it to someone (`face`, through
//     table/faces.js): with every other face cut from its sheet, so what the
//     game records (which GLBs exist) says only that a card of that sheet was
//     seen, never which, as at a real table. Its docs are made, and recorded,
//     in kind order once the sheet is drawn; the face asked for is drawn
//     first and shown from its bytes meanwhile.
//
// A web asset (an http(s) URL, GAME-FORMAT.md §4) is read from the file doc
// the game's `assets` names for it; else fetched (look/web.js), stored as a
// file doc and named there (`assets[url] = { file }`), so the next viewer,
// and a copy of the game, has it from Patchwork. Two viewers caching or
// drawing the same thing at once each write theirs only where nothing is yet
// (the rule the scene's ctx.file keeps for its `assets`): the merge keeps
// one, and each shows what it made.
//
// Only a viewer who can write the game saves anything: one who can't
// (a read-only handle) draws for themselves and shows the bytes.
//
// An asset that can't be had (a host refusing a cross-origin fetch, a dead
// link) leaves its kind drawn without it, in its colour (look.js), with its
// URL noted (`drawn[kind].missing`, and the notes), and is tried again when
// the kind is next needed after `retryMs` (a viewer who comes later tries
// once), never on every look.
//
// A GLB drawn from file docs (a card sheet, a model) says where they came
// from: its `origin.urls` are theirs (provenance travels with what's drawn).

import { drawer, glbName, lookKey } from "./look/look.js";
import { fetchAsset, isWeb } from "./look/web.js";

/** How long a web asset that couldn't be fetched is left before it's tried again. */
export const RETRY_MS = 10 * 60 * 1000;
/** How many web assets are fetched at once. */
const LANES = 6;
/** How many web assets a viewer who can't store them keeps in memory (a sheet is a few MB). */
const HELD = 8;

/** A file doc as look.js reads it: { content, mimeType, extension, origin } | null. */
export async function readFile(repo, url) {
  try {
    const f = (await repo.find(url))?.doc?.();
    return f ? { content: f.content, mimeType: f.mimeType, extension: f.extension, origin: f.origin } : null;
  } catch {
    return null;
  }
}

/** Every file a piece is drawn from: its images, models and textures. */
export const filesOf = (piece) => [
  ...new Set((piece?.parts ?? []).flatMap((p) => [p?.top?.file, p?.bottom?.file, p?.file, p?.texture]).filter((u) => typeof u === "string" && u)),
];
/** The first image or model a piece is drawn from: kinds drawn in this order read each sheet once. */
const firstFile = (p) => (p?.parts ?? []).map((x) => x?.top?.file ?? x?.file ?? "").find(Boolean) ?? "";
/** The sheet a card's face is cut from: the faces drawn together ("" for faces without an image). */
const sheetOf = (p) => (p?.parts ?? []).map((x) => x?.top?.file).find(Boolean) ?? "";
const isCard = (pieces, k) => typeof pieces?.[k]?.back === "string";

/**
 * What draws a game's pieces, and remembers what it drew and couldn't fetch.
 * @param {{
 *   repo: object, handle: object,
 *   images?: object | null, source?: (type: string) => Promise<object | null>,
 *   fetch?: typeof fetch | null, now?: () => number, retryMs?: number, batch?: number, maxStoredBytes?: number,
 * }} o  handle: the game doc's; images, source: look.js's drawer's; batch: kinds to a change (`ensure`)
 */
export function pieceDrawer({ repo, handle, images = null, source = async () => null, fetch = globalThis.fetch?.bind(globalThis) ?? null, now = () => Date.now(), retryMs = RETRY_MS, batch = 50, maxStoredBytes = 32e6 }) {
  const doc = () => handle.doc() ?? {};
  let refused = false; // a write was refused: this viewer draws for themselves from now on
  const writer = () => !refused && !(typeof handle.isReadOnly === "function" && handle.isReadOnly());
  const failed = new Map(); // a file → when it last couldn't be had
  const fetching = new Map(); // a web asset → its fetch on its way
  const cached = new Map(); // a web asset → the file doc stored for it here, not yet in `assets`
  const held = new Map(); // a web asset fetched but not stored (this viewer can't write, or it's too big) → its file, the last few
  const local = new Map(); // kind → what was drawn for this viewer alone ({ key, glb, missing })
  const waiting = new Map(); // kind → its face on its way
  const keeping = new Map(); // kind → its GLB doc on its way (its sheet being written)

  const recent = (u) => failed.has(u) && now() - failed.get(u) < retryMs;
  /** Something missing from this drawing is worth trying again. */
  const due = (e) => (e?.missing ?? []).some((u) => !recent(u));
  /** What a kind shows now: its doc, else what was drawn here, if either is of what it is now. */
  const known = (kind) => {
    const key = lookKey(doc().pieces?.[kind]);
    const have = doc().drawn?.[kind];
    if (have?.url && have.key === key) return { show: { url: have.url }, entry: have };
    const l = local.get(kind);
    return l?.key === key ? { show: { glb: l.glb }, entry: l } : null;
  };
  const current = (kind) => {
    const k = known(kind);
    return !!k && !due(k.entry);
  };

  /** A web asset: the file doc that caches it, else fetched (and cached, by a writer), else null. */
  function webFile(url) {
    const file = doc().assets?.[url]?.file ?? cached.get(url);
    if (file) return readFile(repo, file);
    if (held.has(url)) return Promise.resolve(held.get(url));
    if (recent(url)) return Promise.resolve(null);
    if (!fetching.has(url)) {
      const p = (async () => {
        try {
          const f = await fetchAsset(fetch, url);
          const size = f.content?.byteLength ?? f.content?.length ?? 0;
          if (writer() && size <= maxStoredBytes) {
            try {
              cached.set(url, (await repo.create2({ "@patchwork": { type: "file" }, ...f })).url);
              return f;
            } catch {
              refused = true;
            }
          }
          held.set(url, f);
          while (held.size > HELD) held.delete(held.keys().next().value);
          return f;
        } catch (err) {
          console.warn(`[tabletop] couldn't fetch ${url}: ${err?.message ?? err}`);
          failed.set(url, now());
          return null;
        }
      })();
      fetching.set(url, p);
      p.finally(() => fetching.delete(url));
    }
    return fetching.get(url);
  }

  /** Fetch these web assets, a few at a time (a host that hangs holds up one lane, not every piece). */
  async function prefetch(urls) {
    const todo = [...new Set(urls)].filter((u) => isWeb(u) && !doc().assets?.[u]?.file && !cached.has(u) && !held.has(u) && !recent(u));
    const lane = async () => {
      while (todo.length) await webFile(todo.shift());
    };
    await Promise.all(Array.from({ length: Math.min(LANES, todo.length) }, lane));
  }

  /** A drawing session: one look.js drawer (it keeps what it decoded, so a sheet is read once), closed after. */
  function session() {
    const misses = new Set();
    const read = async (url) => {
      const f = isWeb(url) ? await webFile(url) : await readFile(repo, url);
      if (!f) {
        misses.add(url);
        if (!isWeb(url)) failed.set(url, now());
      }
      return f;
    };
    const d = drawer({ read, images, source });
    return {
      /** Draw a kind as it is now: { key, glb, bounds, origins, missing, notes, name }, or null if it's gone. */
      async draw(kind) {
        const piece = doc().pieces?.[kind];
        if (!piece) return null;
        const out = await d.draw(piece);
        return {
          key: lookKey(piece),
          glb: out.glb,
          bounds: out.bounds,
          origins: out.origins,
          missing: filesOf(piece).filter((u) => misses.has(u)),
          notes: out.notes.map((n) => `${piece.name}: ${n}`),
          name: glbName(piece),
        };
      },
      close: () => d.close(),
    };
  }

  /** Put a drawing in its GLB doc (rewritten in place if the kind has one): its `drawn` entry, to record. */
  async function store(kind, e) {
    const origin = e.origins.length ? { urls: e.origins } : null;
    let url = doc().drawn?.[kind]?.url ?? null;
    if (url) {
      (await repo.find(url)).change((f) => {
        f.content = e.glb;
        f.name = e.name;
        if (origin) f.origin = origin;
        else delete f.origin;
      });
    } else {
      const file = await repo.create2({ "@patchwork": { type: "file" }, name: e.name, extension: "glb", mimeType: "model/gltf-binary", content: e.glb, ...(origin ? { origin } : {}) });
      url = file.url;
    }
    return { url, key: e.key, bounds: e.bounds, missing: e.missing };
  }

  /** Write drawn entries, and the web assets cached since the last write, in one change. */
  function record(entries) {
    const assets = [...cached].filter(([u]) => !doc().assets?.[u]?.file);
    if (!entries.length && !assets.length) return;
    handle.change((g) => {
      if (assets.length && !g.assets) g.assets = {};
      // someone else cached it first: theirs is kept, ours is an orphan
      for (const [u, file] of assets) if (!g.assets[u]?.file) g.assets[u] = { file };
      if (entries.length && !g.drawn) g.drawn = {};
      for (const [kind, { url, key, bounds, missing }] of entries) {
        const was = g.drawn[kind];
        // someone else drew it first: theirs wins, ours is an orphan
        const entry = { url: was?.url ?? url, key };
        if (bounds) entry.bounds = bounds;
        if (missing?.length) entry.missing = [...missing];
        g.drawn[kind] = entry;
      }
    });
    for (const [u] of assets) cached.delete(u);
    for (const [kind] of entries) local.delete(kind);
  }

  /**
   * Make sure these kinds have GLBs drawn from what they are now: create the
   * file doc the first time, rewrite it when the piece has changed (or an
   * asset it lacked is worth trying again). Writes `drawn` a batch of kinds to
   * a change (and whatever is drawn when it stops, even by failing): an
   * imported game lays out hundreds of kinds, and a change per kind is
   * hundreds of changes to a big doc, each one redrawing every page that shows it.
   * @returns {Promise<{ drawn: number, notes: string[] }>}
   */
  async function ensure(kinds, { onProgress = () => {} } = {}) {
    const pieces = doc().pieces ?? {};
    const todo = [...new Set(kinds)].filter((k) => pieces[k] && !current(k)).sort((a, b) => firstFile(pieces[a]).localeCompare(firstFile(pieces[b])));
    onProgress(0, todo.length);
    await prefetch(todo.flatMap((k) => filesOf(pieces[k])));
    const s = session();
    const notes = [];
    let drawn = 0;
    const pending = [];
    try {
      for (const [i, kind] of todo.entries()) {
        const e = await s.draw(kind);
        if (e) {
          notes.push(...e.notes);
          if (writer()) pending.push([kind, await store(kind, e)]);
          else local.set(kind, e);
          drawn++;
          if (pending.length >= batch) record(pending.splice(0));
        }
        onProgress(i + 1, todo.length);
      }
    } finally {
      s.close();
      record(pending);
    }
    return { drawn, notes };
  }

  /** Draw the faces of `kind`'s sheet that need it, `kind` first; each kind's waiter resolves as it's drawn. */
  function drawSheet(kind) {
    const pieces = doc().pieces ?? {};
    const sheet = sheetOf(pieces[kind]);
    const rest = Object.keys(pieces)
      .filter((k) => k !== kind && isCard(pieces, k) && sheetOf(pieces[k]) === sheet && !waiting.has(k) && !current(k))
      .sort();
    const order = [kind, ...rest];
    const deferred = () => {
      let settle;
      const p = new Promise((resolve, reject) => (settle = { resolve, reject }));
      p.catch(() => {});
      return { p, ...settle };
    };
    const waiters = new Map();
    const kept = new Map(); // kind → its doc, once the sheet is written ({ url }, or null: shown from its bytes only)
    for (const k of order) {
      waiters.set(k, deferred());
      waiting.set(k, waiters.get(k).p);
      kept.set(k, deferred());
      keeping.set(k, kept.get(k).p);
    }
    (async () => {
      const s = session();
      const drawn = [];
      try {
        await prefetch(order.flatMap((k) => filesOf(pieces[k])));
        for (const k of order) {
          const e = await s.draw(k);
          if (e) {
            drawn.push([k, e]);
            local.set(k, e);
          }
          waiters.get(k).resolve(e ? { glb: e.glb, kept: kept.get(k).p } : null);
        }
        if (writer()) {
          // in kind order, all at once: what's recorded names the sheet, never the card asked for
          const entries = [];
          try {
            for (const [k, e] of drawn.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) entries.push([k, await store(k, e)]);
          } catch (err) {
            refused = true;
            console.warn("[tabletop] couldn't keep the faces drawn: shown here only", err);
          }
          record(entries);
          for (const [k] of entries) kept.get(k).resolve(doc().drawn?.[k]?.url ? { url: doc().drawn[k].url } : null);
        }
      } catch (err) {
        for (const w of waiters.values()) w.reject(err);
      } finally {
        s.close();
        for (const d of kept.values()) d.resolve(null);
        for (const [k, w] of waiters) if (waiting.get(k) === w.p) waiting.delete(k);
        for (const [k, d] of kept) if (keeping.get(k) === d.p) keeping.delete(k);
      }
    })();
    return waiters.get(kind).p;
  }

  /**
   * A card's face, to show: { url } (its GLB doc) or { glb, kept } (bytes
   * drawn here, and its doc once its sheet is written: { url }, or null when
   * it isn't), drawn with its sheet the first time; null if there's no such kind.
   * One drawn but missing an asset worth trying again is shown as it is, and
   * drawn again behind it (its doc is rewritten in place).
   */
  async function face(kind) {
    if (!doc().pieces?.[kind]) return null;
    if (waiting.has(kind)) return waiting.get(kind);
    const k = known(kind);
    if (k && !due(k.entry)) return k.show;
    const drawing = drawSheet(kind);
    return k ? k.show : drawing;
  }

  return { ensure, face, current };
}
