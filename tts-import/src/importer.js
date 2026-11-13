// The import, a translation: a mod JSON + whatever cached asset files came
// with it → a file doc for each raw asset the game uses (saying which of the
// mod's URLs it came from), a tabletop-game doc (translate.js: the game as
// data, tabletop/GAME-FORMAT.md, its pieces naming those file docs), and a
// report written into the tts-import doc. It writes no scene: the game's
// tables are set up from the game, by the tabletop package, as any game's are.
//
// Everything the browser provides is passed in, so it runs in vitest too:
//   repo            create2(doc) → handle
//   fetch           for assets that weren't dropped (optional; CORS often says no)
//   onProgress      ({ phase, done, total }) → void

import { AssetIndex, cacheName, urlVariants, extensionOf } from "./cache.js";
import { readSave, countNames, collectAssets } from "./tts.js";
import { shortHash, translate } from "./translate.js";
import { imageSize } from "./image-size.js";
import { sniff } from "./sniff.js";
import { DEFAULT_METRES_PER_UNIT } from "./convert.js";
import { DEFAULT_SETTINGS } from "./settings.js";

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

async function fetchBytes(fetchFn, url, timeoutMs = 20000) {
  let lastError = null;
  for (const u of urlVariants(url)) {
    if (!/^https?:\/\//i.test(u)) continue;
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await fetchFn(u, ctl ? { signal: ctl.signal } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { bytes: new Uint8Array(await res.arrayBuffer()), via: u };
    } catch (err) {
      lastError = err?.name === "AbortError" ? new Error("timed out") : err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  throw lastError ?? new Error("not an http(s) URL");
}

/**
 * Run an import. Returns { gameUrl, report, game }. Never throws for a
 * missing asset (whatever uses it is drawn without it), only for no save at
 * all, or a repo that won't take documents.
 *
 * @param {{ sources: ReturnType<typeof source>[], repo, fetch?, settings?, onProgress?, now? }} o
 */
export async function runImport({ sources, repo, fetch: fetchFn = null, settings = {}, onProgress = () => {}, now = () => Date.now() }) {
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
      return null;
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
    const entry = { url: a.url, role: a.role, by: a.by, uses: a.uses, source: null, fileUrl: null, error: null, mimeType: null, extension: null, size: 0, bytes: null, dims: null };
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
      if (s.fetchMissing && fetchFn) {
        try {
          entry.bytes = (await fetchBytes(fetchFn, a.url)).bytes;
          entry.source = "fetch";
        } catch (err) {
          entry.error = `not in the dropped files; fetching failed: ${err?.message ?? err}`;
        }
      } else entry.error = "not in the dropped files";
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
      } else if (t.image) entry.dims = imageSize(entry.bytes);
    }
    assets.set(a.url, entry);
    progress("Finding assets", ++done, needed.size);
  }

  // ─── raw assets as file docs, each saying where it came from ─────────────
  done = 0;
  // a raw asset bigger than this isn't kept (a piece is drawn without it)
  const keepLimit = Number(s.maxStoredBytes) > 0 ? Number(s.maxStoredBytes) : 32e6;
  const present = [...assets.values()].filter((a) => a.bytes && a.size <= keepLimit);
  for (const a of assets.values())
    if (a.bytes && a.size > keepLimit) {
      warnings.push(`${a.url} (${Math.round(a.size / 1e6)} MB) wasn't stored: over ${Math.round(keepLimit / 1e6)} MB`);
      a.error = `over ${Math.round(keepLimit / 1e6)} MB: not stored`;
    }
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
  const t = translate(save, { ...options, file: (u) => assets.get(u)?.fileUrl ?? null, imageSize: (u) => assets.get(u)?.dims ?? null });
  warnings.push(...t.warnings);
  // the mod it came from (its Workshop id when the file is named for it), so a game made from a
  // publisher's module says whose it is wherever it goes, and every table set up from it says so too
  const workshopId = /(?:^|\/)(\d{6,})\.json$/i.exec(found.path)?.[1] ?? null;
  const game = { ...t.game, origin: { tts: { saveName: save.saveName ?? null, fileName: found.path, workshopId } } };
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
      mimeType: a.mimeType,
      usedBy: a.by,
      uses: a.uses,
      ...(a.error ? { error: a.error } : {}),
    };
  }
  const ok = (a) => !a.error && !!a.source && !!a.fileUrl;
  const report = {
    mod: { saveName: save.saveName, gameMode: save.gameMode, fileName: found.path, table: save.table, objects: Object.values(countNames(save.objects)).reduce((x, y) => x + y, 0) },
    counts: {
      byName: countNames(save.objects),
      ...t.counts,
      skipped: t.skipped,
      approximated: t.approximated,
      assets: { needed: assets.size, cache: [...assets.values()].filter((a) => ok(a) && a.source === "cache").length, fetched: [...assets.values()].filter((a) => ok(a) && a.source === "fetch").length, missing: [...assets.values()].filter((a) => !ok(a)).length, referenced: referenced.size },
    },
    assets: assetReport,
    warnings,
    gameUrl: gameHandle.url,
    finishedAt: now(),
  };
  progress("Done", 1, 1);
  return { gameUrl: gameHandle.url, report, game };
}
