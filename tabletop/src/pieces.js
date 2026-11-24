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
//     table/faces.js): with every face of its group (`groupsOf`: every card
//     it could share a container with — its deck's, or the loose cards — and
//     every card cut from the same sheets, closed over both), so what the
//     game records (which GLBs exist, which sheets are cached) says only that
//     a card of that group was seen, never which: no more than its container,
//     which everyone sees, already says. Its docs are made, and recorded, in
//     kind order, in one change, once the group is drawn; the face asked for
//     is drawn first and shown from its bytes meanwhile;
//   - a piece's state (GAME-FORMAT.md §4), when someone first turns a piece
//     to it (`face`, by its ref `<kind>#<n>`, states.js: a group of its own,
//     since a state is public), kept in `drawn` under its ref.
//
// A web asset (an http(s) URL, GAME-FORMAT.md §4) is read from the file doc
// the game's `assets` names for it; else fetched (look/web.js), stored as a
// file doc and named there (`assets[url] = { file }`), so the next viewer,
// and a copy of the game, has it from Patchwork. Two viewers caching or
// drawing the same thing at once each write theirs only where nothing is yet
// (the rule the scene's ctx.file keeps for its `assets`): the merge keeps
// one, and each shows what it made.
//
// An image over `maxStoredBytes` (a deck's sheet of 7700 × 3174 px, 33 MB)
// is made smaller where the page can (tts/shrink.js: halved until it fits,
// as the importer stores one), stored and drawn from that, so every viewer
// draws from the same file and the next has it from Patchwork; where it
// can't be, it's drawn from as it is and not stored (held a while instead).
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
import { pieceAt } from "./states.js";
import { browserShrink } from "./tts/shrink.js";

/** How long a web asset that couldn't be fetched is left before it's tried again. */
export const RETRY_MS = 10 * 60 * 1000;
/** How many web assets are fetched at once. */
const LANES = 6;
/** How many web assets a viewer who can't store them keeps in memory (a sheet is a few MB). */
const HELD = 8;

/**
 * fn(item, i) for each item, `n` at a time, in order: the first failure stops
 * anything more being started, and is thrown once what's running has finished.
 */
async function inLanes(items, n, fn) {
  let next = 0;
  let failure = null;
  const lane = async () => {
    while (!failure && next < items.length) {
      const i = next++;
      try {
        await fn(items[i], i);
      } catch (err) {
        failure ??= { err };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, lane));
  if (failure) throw failure.err;
}

/** A file doc as look.js reads it: { content, mimeType, extension, origin } | null. */
export async function readFile(repo, url) {
  try {
    const f = (await repo.find(url))?.doc?.();
    return f ? { content: f.content, mimeType: f.mimeType, extension: f.extension, origin: f.origin } : null;
  } catch {
    return null;
  }
}

/** Every file a piece is drawn from: its images, models and textures, and a die document's pictured faces. */
export const filesOf = (piece) => [
  ...new Set(
    [...(piece?.parts ?? []).flatMap((p) => [p?.top?.file, p?.bottom?.file, p?.file, p?.texture]), ...(Array.isArray(piece?.doc?.faces) ? piece.doc.faces.map((f) => f?.image?.file) : [])].filter((u) => typeof u === "string" && u),
  ),
];
/** The first image or model a piece is drawn from: kinds drawn in this order read each sheet once. */
const firstFile = (p) => (p?.parts ?? []).map((x) => x?.top?.file ?? x?.file ?? "").find(Boolean) ?? "";
/** The sheet a card's face is cut from: the faces drawn together ("" for faces without an image). */
const sheetOf = (p) => (p?.parts ?? []).map((x) => x?.top?.file).find(Boolean) ?? "";
const isCard = (pieces, k) => typeof pieces?.[k]?.back === "string";

/**
 * The cards whose faces are drawn, fetched and recorded together: kind → its
 * group (sorted). Two cards are in one group when they may lie in one
 * container (a deck's cards; every loose card, setup.js's LOOSE), in the
 * game's setup or a kit of its recipe's, or are cut from one sheet, closed over both. What a container holds is public (each
 * kept card names its container), so recording a whole group says nothing
 * about which of its cards was shown. Pure.
 */
export function groupsOf(game) {
  const pieces = game?.pieces ?? {};
  const up = new Map();
  const root = (k) => {
    while (up.get(k) !== k) {
      up.set(k, up.get(up.get(k)));
      k = up.get(k);
    }
    return k;
  };
  const join = (a, b) => up.set(root(a), root(b));
  for (const k of Object.keys(pieces)) if (isCard(pieces, k)) up.set(k, k);
  const first = new Map(); // a sheet, or a container → its first card
  const meet = (key, k) => (first.has(key) ? join(first.get(key), k) : first.set(key, k));
  // (the faces with no image are one "sheet": cheap to draw, and so never told apart)
  for (const k of up.keys()) meet(`sheet ${sheetOf(pieces[k])}`, k);
  let decks = 0;
  const walk = (things) => {
    for (const t of Array.isArray(things) ? things : []) {
      const key = t?.deck ? `deck ${decks++}` : "loose";
      for (const k of t?.deck ? (t.deck.cards ?? []) : [t?.piece]) if (up.has(k)) meet(key, k);
      walk(t?.contents);
    }
  };
  // everything any way of laying it out can lay (its setup, and its recipe's kits, GAME-FORMAT.md §6): a recipe
  // only takes things away, moves them or adds a kit's, so a group is never smaller than any table makes it
  walk(game?.setup);
  for (const step of Array.isArray(game?.recipe?.layout) ? game.recipe.layout : []) walk(step?.kit);
  const by = new Map();
  for (const k of [...up.keys()].sort()) {
    const r = root(k);
    if (!by.has(r)) by.set(r, []);
    by.get(r).push(k);
  }
  const out = new Map();
  for (const g of by.values()) for (const k of g) out.set(k, g);
  return out;
}

/**
 * What draws a game's pieces, and remembers what it drew and couldn't fetch.
 * @param {{
 *   repo: object, handle: object,
 *   images?: object | null, source?: (type: string) => Promise<object | null>,
 *   fetch?: typeof fetch | null, now?: () => number, retryMs?: number, batch?: number, maxStoredBytes?: number, draws?: number,
 *   shrink?: ((bytes: Uint8Array, o: { mimeType: string, limit: number }) => Promise<{ bytes: Uint8Array, mimeType: string, extension: string } | null>) | null,
 * }} o  handle: the game doc's; images, source: look.js's drawer's; batch: kinds to a change (`ensure`);
 *   draws: pieces drawn at once (and images decoded at once: look.js); shrink: an image over
 *   maxStoredBytes made smaller to store (tts/shrink.js: the browser's, by default; none in Node)
 */
export function pieceDrawer({ repo, handle, images = null, source = async () => null, fetch = globalThis.fetch?.bind(globalThis) ?? null, now = () => Date.now(), retryMs = RETRY_MS, batch = 50, maxStoredBytes = 32e6, draws = 4, shrink = browserShrink() }) {
  const doc = () => handle.doc() ?? {};
  let refused = false; // a write was refused: this viewer draws for themselves from now on
  const writer = () => !refused && !(typeof handle.isReadOnly === "function" && handle.isReadOnly());
  const failed = new Map(); // a file → when it last couldn't be had
  const fetching = new Map(); // a web asset → its fetch on its way
  const cached = new Map(); // a web asset → the file doc stored for it here, not yet in `assets`
  const held = new Map(); // a web asset fetched but not stored (this viewer can't write, or it's too big) → its file, the last few
  const local = new Map(); // kind → what was drawn for this viewer alone ({ key, glb, missing })
  const waiting = new Map(); // kind → its face on its way
  const keeping = new Map(); // kind → its GLB doc on its way (its group being written)

  let grouped = { pieces: undefined, setup: undefined, recipe: undefined, of: new Map() };
  /** A card's group (groupsOf), as the game is now (its kits too: a group is never smaller than any table makes it). */
  const groupOf = (kind) => {
    const d = doc();
    if (grouped.pieces !== d.pieces || grouped.setup !== d.setup || grouped.recipe !== d.recipe) grouped = { pieces: d.pieces, setup: d.setup, recipe: d.recipe, of: groupsOf(d) };
    return grouped.of.get(kind) ?? [kind];
  };

  const recent = (u) => failed.has(u) && now() - failed.get(u) < retryMs;
  /** Something missing from this drawing is worth trying again. */
  const due = (e) => (e?.missing ?? []).some((u) => !recent(u));
  /** What a kind shows now: its doc, else what was drawn here, if either is of what it is now. */
  const known = (kind) => {
    const key = lookKey(pieceAt(doc().pieces, kind));
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
          let f = await fetchAsset(fetch, url);
          let size = f.content?.byteLength ?? f.content?.length ?? 0;
          if (writer() && size > maxStoredBytes && shrink && f.content instanceof Uint8Array) {
            const smaller = await shrink(f.content, { mimeType: f.mimeType, limit: maxStoredBytes }).catch(() => null);
            if (smaller?.bytes?.byteLength > 0 && smaller.bytes.byteLength <= maxStoredBytes) {
              f = { ...f, name: f.name.replace(/\.[^.]*$/, `.${smaller.extension}`), extension: smaller.extension, mimeType: smaller.mimeType, content: smaller.bytes };
              size = smaller.bytes.byteLength;
            }
          }
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

  /**
   * Fetch these web assets, a few at a time (a host that hangs holds up one lane, not every piece),
   * in the order of their URLs: what's fetched and stored first never says which face was asked for.
   */
  async function prefetch(urls) {
    const todo = [...new Set(urls)].sort().filter((u) => isWeb(u) && !doc().assets?.[u]?.file && !cached.has(u) && !held.has(u) && !recent(u));
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
    const d = drawer({ read, images, source, decodes: draws });
    return {
      /** Draw a kind as it is now: { key, glb, bounds, origins, missing, notes, name }, or null if it's gone. */
      async draw(kind) {
        const piece = pieceAt(doc().pieces, kind);
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
    const assets = [...cached].filter(([u]) => !doc().assets?.[u]?.file).sort(([a], [b]) => (a < b ? -1 : 1));
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
    const at = (k) => pieceAt(pieces, k);
    const todo = [...new Set(kinds)].filter((k) => at(k) && !current(k)).sort((a, b) => firstFile(at(a)).localeCompare(firstFile(at(b))));
    onProgress(0, todo.length);
    await prefetch(todo.flatMap((k) => filesOf(at(k))));
    const s = session();
    const notes = []; // each kind's, in todo's order
    let drawn = 0;
    let done = 0;
    const pending = [];
    try {
      // a few at once: decoding (a browser's cost) is done `draws` images at a time
      await inLanes(todo, draws, async (kind, i) => {
        const e = await s.draw(kind);
        if (e) {
          notes[i] = e.notes;
          if (writer()) pending.push([kind, await store(kind, e)]);
          else local.set(kind, e);
          drawn++;
          if (pending.length >= batch) record(pending.splice(0));
        }
        onProgress(++done, todo.length);
      });
    } finally {
      s.close();
      record(pending);
    }
    return { drawn, notes: notes.flat().filter(Boolean) };
  }

  /** Draw these faces (`kind`'s group's that need it), `kind` first; each kind's waiter resolves as it's drawn. */
  function drawGroup(kind, members) {
    const pieces = doc().pieces ?? {};
    // the face asked for first; the rest a sheet at a time (each read once)
    const rest = members.filter((k) => k !== kind).sort((a, b) => sheetOf(pieces[a]).localeCompare(sheetOf(pieces[b])) || (a < b ? -1 : 1));
    const order = members.includes(kind) ? [kind, ...rest] : rest;
    const deferred = () => {
      let settle;
      const p = new Promise((resolve, reject) => (settle = { resolve, reject }));
      p.catch(() => {});
      return { p, ...settle };
    };
    const waiters = new Map();
    const kept = new Map(); // kind → its doc, once the group is written ({ url }, or null: shown from its bytes only)
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
        await prefetch(order.flatMap((k) => filesOf(pieceAt(pieces, k))));
        const one = async (k) => {
          const e = await s.draw(k);
          if (e) {
            drawn.push([k, e]);
            local.set(k, e);
          }
          waiters.get(k).resolve(e ? { glb: e.glb, kept: kept.get(k).p } : null);
        };
        // the face asked for first, alone; the rest a few at once
        await one(order[0]);
        await inLanes(order.slice(1), draws, one);
        if (writer()) {
          // in kind order, all at once: what's recorded names the group, never the card asked for
          const entries = [];
          try {
            for (const [k, e] of drawn.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) entries.push([k, await store(k, e)]);
            record(entries);
          } catch (err) {
            // none of it is recorded (a part of the group would say which part was asked for): shown here only
            refused = true;
            console.warn("[tabletop] couldn't keep the faces drawn: shown here only", err);
          }
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
    return waiters.get(order[0])?.p ?? Promise.resolve(null);
  }

  /**
   * A card's face, to show: { url } (its GLB doc) or { glb, kept } (bytes
   * drawn here, and its doc once its group is written: { url }, or null when
   * it isn't), drawn with its group the first time; null if there's no such kind.
   * Whether anything is drawn (and written) is decided by the group, never by
   * the face: any of the group's faces not drawn, or missing an asset worth
   * trying again, is drawn behind whichever face is shown (its doc rewritten
   * in place), and a face already drawn is shown as it is meanwhile.
   */
  async function face(kind) {
    if (!pieceAt(doc().pieces, kind)) return null;
    if (waiting.has(kind)) return waiting.get(kind);
    const k = known(kind);
    const stale = groupOf(kind).filter((m) => pieceAt(doc().pieces, m) && !waiting.has(m) && !current(m));
    const drawing = stale.length ? drawGroup(kind, stale) : null;
    return k ? k.show : (drawing ?? null);
  }

  return { ensure, face, current };
}
