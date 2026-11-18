// The import, a translation: a mod JSON + whatever cached asset files came
// with it → a tabletop-game doc (translate.js: the game as data,
// tabletop/GAME-FORMAT.md, its pieces naming each asset by the mod's own URL),
// and a report written into the tts-import doc. It writes no scene: the
// game's tables are set up from the game (setup.js), as any game's are.
//
// Assets are fetched when something is first drawn from them (pieces.js),
// not here: an asset that came with the mod (TTS's cache, dropped with it)
// is stored now, as a file doc saying which URL it came from, and the game's
// `assets` names it under that URL; the rest are only named. "Fetch every
// asset now" (settings.fetchNow, for a game to be played offline) fetches
// and stores the rest too.
//
// Everything the browser provides is passed in, so it runs in vitest too:
//   repo            create2(doc) → handle
//   fetch           for fetchNow (optional; CORS often says no)
//   onProgress      ({ phase, done, total }) → void

import { AssetIndex, cacheName, urlVariants, extensionOf } from "./cache.js";
import { readSave, countNames, collectAssets } from "./tts.js";
import { shortHash, translate } from "./translate.js";
import { sniff } from "./sniff.js";
import { fetchBytes, isWeb } from "../look/web.js";
import { DEFAULT_METRES_PER_UNIT } from "./convert.js";
import { DEFAULT_SETTINGS } from "./settings.js";
import { browserShrink } from "./shrink.js";

export { DEFAULT_SETTINGS };

/** A dropped file, however it came: { path, size, read() → Promise<Uint8Array> }. */
export const source = (path, size, read) => ({ path, size, read });

/** Pick the save among the sources: a .json with ObjectStates (the biggest, if several). */
export async function findSave(sources) {
  const jsons = sources.filter((s) => extensionOf(s.path) === "json" && !/(SaveFileInfos|WorkshopFileInfos)/i.test(s.path)).sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  for (const s of jsons) {
    try {
      const text = new TextDecoder().decode(await s.read());
      const save = readSave(text);
      return { save, path: s.path };
    } catch {
      /* not a save */
    }
  }
  return null;
}

const safeName = (s) => String(s ?? "asset").replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || "asset";

/**
 * Run an import. Returns { gameUrl, report, game }. Never throws for a
 * missing asset (whatever uses it is drawn without it), only for no save at
 * all, or a repo that won't take documents.
 *
 * `shrink(bytes, { mimeType, limit })` makes an image over maxStoredBytes
 * smaller (shrink.js: the browser's, by default; none in Node), resolving
 * { bytes, mimeType, extension, width, height } or null (then it isn't kept).
 *
 * @param {{ sources: ReturnType<typeof source>[], repo, fetch?, settings?, onProgress?, now?, shrink? }} o
 */
export async function runImport({ sources, repo, fetch: fetchFn = null, settings = {}, onProgress = () => {}, now = () => Date.now(), shrink = browserShrink() }) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const unit = Number(s.metresPerUnit) > 0 ? Number(s.metresPerUnit) : DEFAULT_METRES_PER_UNIT;
  const progress = (phase, done = 0, total = 0) => onProgress({ phase, done, total });
  const warnings = [];

  progress("Reading the mod");
  const found = await findSave(sources);
  if (!found) throw new Error("No Tabletop Simulator save found: drop the mod's .json (Mods/Workshop/<id>.json, or a save from Saves/).");
  const { save } = found;
  const index = new AssetIndex();
  for (const src of sources) if (src.path !== found.path) index.add(src.path, src);
  const options = { unit, flipObjX: s.flipObjX, includeContents: s.includeContents, maxObjects: s.maxObjects };

  // ─── which assets the game uses: a dry translation names them ────────────
  const needed = new Map(); // url → { url, role, by: Set<string>, uses }
  const roleOf = (u) => (/\.obj(\?|#|$)/i.test(u) ? "model" : "image");
  translate(save, {
    ...options,
    file: (u) => {
      let a = needed.get(u);
      if (!a) needed.set(u, (a = { url: u, role: roleOf(u), uses: 0 }));
      a.uses++;
      return u; // named, so everything drawn from it is asked for (a model's texture too)
    },
  });
  // what uses each (up to five names), and which are models, from the save itself
  const referenced = collectAssets(save.objects, { tableURL: save.tableURL });
  for (const a of needed.values()) {
    const r = referenced.get(a.url);
    a.by = r?.by ?? [];
    if (r?.type === "model") a.role = "model";
  }

  const assets = new Map(); // url → { url, role, source, bytes?, mimeType, extension, fileUrl, error, by, uses, size }
  let done = 0;
  progress("Finding assets", 0, needed.size);
  for (const a of needed.values()) {
    const entry = { url: a.url, role: a.role, by: a.by, uses: a.uses, source: null, fileUrl: null, error: null, mimeType: null, extension: null, size: 0, bytes: null };
    const hit = index.find(a.url);
    if (hit) {
      try {
        entry.bytes = await hit.value.read();
        entry.source = "cache";
      } catch (err) {
        entry.error = `found in the dropped files (${hit.path.split(/[\\/]/).pop()}) but couldn't read it: ${err?.message ?? err}`;
      }
    }
    if (!entry.bytes && !entry.error) {
      if (!isWeb(a.url)) entry.error = "not in the dropped files, and not on the web";
      else if (s.fetchNow && fetchFn) {
        try {
          entry.bytes = (await fetchBytes(fetchFn, a.url)).bytes;
          entry.source = "fetch";
        } catch (err) {
          entry.error = `not in the dropped files; fetching failed: ${err?.message ?? err}`;
        }
      } else entry.source = "web"; // fetched when something is first drawn from it
    }
    if (entry.bytes) {
      const t = sniff(entry.bytes);
      entry.mimeType = t.mimeType;
      entry.extension = t.extension;
      entry.size = entry.bytes.byteLength;
      const ok = a.role === "model" ? t.extension === "obj" : t.image;
      if (!ok) {
        entry.error = `expected ${a.role === "model" ? "an OBJ" : "an image"}, got ${t.mimeType}${t.extension === "html" ? " (a web page: the link is probably dead)" : ""}`;
        entry.bytes = null;
        entry.source = null;
      }
    }
    assets.set(a.url, entry);
    progress("Finding assets", ++done, needed.size);
  }

  // ─── raw assets as file docs, each saying where it came from ─────────────
  done = 0;
  // a raw asset bigger than this isn't kept (a piece is drawn without it)
  const keepLimit = Number(s.maxStoredBytes) > 0 ? Number(s.maxStoredBytes) : 32e6;
  const mb = (n) => `${Math.round(n / 1e6)} MB`;
  for (const a of assets.values()) {
    if (!a.bytes || a.size <= keepLimit) continue;
    // an image is made smaller where the page can (shrink.js); anything else, or an image that won't go small enough, isn't kept
    let smaller = null;
    if (a.role !== "model" && shrink) {
      try {
        smaller = await shrink(a.bytes, { mimeType: a.mimeType, limit: keepLimit });
      } catch {
        smaller = null;
      }
    }
    if (smaller?.bytes?.byteLength > 0 && smaller.bytes.byteLength <= keepLimit) {
      warnings.push(`${a.url} (${mb(a.size)}) was over ${mb(keepLimit)}: stored at ${smaller.width} × ${smaller.height} (${mb(smaller.bytes.byteLength)}) instead`);
      Object.assign(a, { bytes: smaller.bytes, size: smaller.bytes.byteLength, mimeType: smaller.mimeType, extension: smaller.extension, shrunkFrom: a.size });
      continue;
    }
    warnings.push(`${a.url} (${mb(a.size)}) wasn't stored: over ${mb(keepLimit)}`);
    a.error = `over ${mb(keepLimit)}: not stored`;
  }
  const present = [...assets.values()].filter((a) => a.bytes && !a.error && a.size <= keepLimit);
  progress("Storing assets", 0, present.length);
  for (const a of present) {
    const content = a.extension === "obj" ? new TextDecoder().decode(a.bytes) : a.bytes;
    const h = await repo.create2({
      "@patchwork": { type: "file" },
      name: `${safeName(a.by[0] ?? "asset")} (${a.role === "model" ? "model" : "image"}).${a.extension}`,
      extension: a.extension,
      mimeType: a.mimeType,
      content,
      // where it came from: the mod's own URL, so a withdrawn module's assets can be found
      origin: { urls: [a.url] },
    });
    a.fileUrl = h.url;
    progress("Storing assets", ++done, present.length);
  }

  // ─── the game ────────────────────────────────────────────────────────────
  progress("Translating the game");
  // a web asset by its URL, cached in `assets` when it's stored; anything else by the file doc it's stored in
  const t = translate(save, { ...options, file: (u) => (isWeb(u) ? u : (assets.get(u)?.fileUrl ?? null)) });
  warnings.push(...t.warnings);
  const cached = Object.fromEntries([...assets.values()].filter((a) => isWeb(a.url) && a.fileUrl).map((a) => [a.url, { file: a.fileUrl }]));
  // the mod it came from (its Workshop id when the file is named for it), so a game made from a
  // publisher's module says whose it is wherever it goes, and every table set up from it says so too
  const workshopId = /(?:^|\/)(\d{6,})\.json$/i.exec(found.path)?.[1] ?? null;
  const game = { ...t.game, origin: { tts: { saveName: save.saveName ?? null, fileName: found.path, workshopId } }, ...(Object.keys(cached).length ? { assets: cached } : {}) };
  const gameHandle = await repo.create2({ "@patchwork": { type: "tabletop-game" }, ...game, drawn: {}, tables: [] });

  // ─── the report ──────────────────────────────────────────────────────────
  const assetReport = {};
  for (const a of assets.values()) {
    assetReport[cacheName(a.url).slice(-60) || shortHash(a.url)] = {
      url: a.url,
      role: a.role,
      source: a.error ? null : a.source,
      fileUrl: a.fileUrl,
      bytes: a.size,
      ...(a.shrunkFrom ? { shrunkFrom: a.shrunkFrom } : {}),
      mimeType: a.mimeType,
      usedBy: a.by,
      uses: a.uses,
      ...(a.error ? { error: a.error } : {}),
    };
  }
  const ok = (a) => !a.error && !!a.source && !!a.fileUrl;
  const later = (a) => !a.error && a.source === "web";
  const report = {
    mod: { saveName: save.saveName, gameMode: save.gameMode, fileName: found.path, table: save.table, objects: Object.values(countNames(save.objects)).reduce((x, y) => x + y, 0) },
    counts: {
      byName: countNames(save.objects),
      ...t.counts,
      skipped: t.skipped,
      approximated: t.approximated,
      assets: {
        needed: assets.size,
        cache: [...assets.values()].filter((a) => ok(a) && a.source === "cache").length,
        fetched: [...assets.values()].filter((a) => ok(a) && a.source === "fetch").length,
        web: [...assets.values()].filter(later).length,
        missing: [...assets.values()].filter((a) => !ok(a) && !later(a)).length,
        referenced: referenced.size,
      },
    },
    assets: assetReport,
    warnings,
    gameUrl: gameHandle.url,
    finishedAt: now(),
  };
  progress("Done", 1, 1);
  return { gameUrl: gameHandle.url, report, game };
}
