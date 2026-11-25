// What was dropped, kept: the page's part of an import. A dropped file
// exists only in the page it was dropped on, so before anything is imported
// the mod's save and every dropped file it refers to are stored as file docs
// (the lab's file shape: name, extension, mimeType, content), and from then
// on the import's input is those documents (request.js), which any machine
// that runs the import can read.
//
// Only the files the save refers to are stored (found by TTS's cache naming,
// cache.js), so dropping the whole Mods folder stores this mod's assets and
// nothing of the other mods' gigabytes. Each asset says which of the mod's
// URLs it was found under (`origin.urls`), as the importer's own asset docs
// do, and the importer uses it as the game's asset when it needs no
// shrinking. Nothing here touches the DOM.

import { AssetIndex, fileStem } from "./cache.js";
import { collectAssets } from "./tts.js";
import { translate } from "./translate.js";
import { findSave } from "./importer.js";
import { sniff } from "./sniff.js";
import { DEFAULT_SETTINGS } from "./settings.js";

/** What it throws when nothing dropped is a save, as the importer says it. */
export const NO_SAVE = "No Tabletop Simulator save found: drop the mod's .json (Mods/Workshop/<id>.json, or a save from Saves/).";

const baseName = (path) => String(path ?? "").split(/[\\/]/).pop() || "file";

/**
 * Every URL a save may ask for: what its objects name (collectAssets), and
 * what a translation with bags' contents asks for, so that whichever
 * settings it is imported with find their files among those stored.
 */
export function urlsOf(save) {
  const urls = new Set(collectAssets(save.objects, { tableURL: save.tableURL }).keys());
  const s = DEFAULT_SETTINGS;
  translate(save, { unit: s.metresPerUnit, flipObjX: s.flipObjX, includeContents: true, maxObjects: s.maxObjects, file: (u) => (urls.add(u), u) });
  return urls;
}

/**
 * The save, and the dropped files it refers to, each with the URLs it was
 * found under. Reads only the save candidates.
 * @param {{ path: string, size: number, read(): Promise<Uint8Array> }[]} sources
 * @returns {Promise<{ save: { source: object, path: string }, assets: { source: object, urls: string[] }[] }>}
 */
export async function chooseDropped(sources) {
  const found = await findSave(sources);
  if (!found) throw new Error(NO_SAVE);
  const index = new AssetIndex();
  for (const src of sources) if (src.path !== found.path) index.add(src.path, src);
  const bySource = new Map();
  for (const url of urlsOf(found.save)) {
    const hit = index.find(url);
    if (!hit) continue;
    if (!bySource.has(hit.value)) bySource.set(hit.value, []);
    bySource.get(hit.value).push(url);
  }
  const save = sources.find((s) => s.path === found.path);
  return { save: { source: save, path: found.path }, assets: [...bySource].map(([source, urls]) => ({ source, urls })) };
}

/**
 * Stores the save and the dropped files it refers to as file docs. Returns
 * them as the request lists them, the save first. Aborting `signal` stops it
 * between files (what was stored by then is left to nobody).
 * @param {{ create2(doc: object): Promise<{ url: string }> }} repo
 * @param {object[]} sources
 * @param {{ onProgress?: (p: { phase: string, done: number, total: number }) => void, signal?: AbortSignal }} [options]
 * @returns {Promise<{ path: string, url: string, size: number }[]>}
 */
export async function storeDropped(repo, sources, { onProgress = () => {}, signal } = {}) {
  const { save, assets } = await chooseDropped(sources);
  const total = assets.length + 1;
  const progress = (done) => {
    signal?.throwIfAborted();
    onProgress({ phase: "Keeping what was dropped", done, total });
  };
  progress(0);
  const saveBytes = await save.source.read();
  const out = [];
  const saveDoc = await repo.create2({ "@patchwork": { type: "file" }, name: baseName(save.path), extension: "json", mimeType: "application/json", content: saveBytes });
  out.push({ path: save.path, url: saveDoc.url, size: saveBytes.byteLength });
  progress(1);
  for (const { source, urls } of assets) {
    const bytes = await source.read();
    const t = sniff(bytes);
    const h = await repo.create2({
      "@patchwork": { type: "file" },
      name: `${fileStem(source.path)}.${t.extension}`,
      extension: t.extension,
      mimeType: t.mimeType,
      // a model is text, as every OBJ file doc in this package is
      content: t.extension === "obj" ? new TextDecoder().decode(bytes) : bytes,
      origin: { urls },
    });
    out.push({ path: source.path, url: h.url, size: bytes.byteLength });
    progress(out.length);
  }
  return out;
}
