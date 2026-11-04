// The import: a mod JSON + whatever cached asset files came with it → file
// docs for the raw assets, one GLB file doc per kind, a scene laid out like
// the mod's table, and a report written into the tts-import doc.
//
// Everything the browser provides is passed in, so it runs in vitest too:
//   repo            create2(doc) → handle, find(url) → handle
//   images          the image backend (images.js; test/node-images.js)
//   fetch           for assets that weren't dropped (optional; CORS often says no)
//   onProgress      ({ phase, done, total }) → void

import { AssetIndex, cacheName, urlVariants, extensionOf } from "./cache.js";
import { readSave, countNames, collectAssets } from "./tts.js";
import { kindAssets, kindKey, shortHash } from "./kinds.js";
import { plan as makePlan, secretsDocs, sceneDoc, tableExtent, tableKind } from "./layout.js";
import { buildKind } from "./build.js";
import { parseOBJ } from "./obj.js";
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
 * Run an import. Returns { sceneUrl, report }. Never throws for a missing
 * asset — only for no save at all, or a repo that won't take documents.
 *
 * @param {{ sources: ReturnType<typeof source>[], repo, images, fetch?, settings?, onProgress?, infoUrl?, infoToolId?, now? }} o
 */
export async function runImport({ sources, repo, images, fetch: fetchFn = null, settings = {}, onProgress = () => {}, infoUrl = null, infoToolId = null, now = () => Date.now() }) {
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

  const p = makePlan(save, { includeContents: s.includeContents, hideFaceDown: s.hideFaceDown, maxObjects: s.maxObjects });
  warnings.push(...p.warnings);
  const extent = tableExtent(p);
  const table = tableKind(p, extent);
  const tableKey = kindKey(table);

  // ─── assets: only what something drawn needs (and the PDFs) ──────────────
  const needed = new Map(); // url → { url, role, by: Set<string>, uses }
  const need = (url, role, who) => {
    if (!url) return;
    let a = needed.get(url);
    if (!a) needed.set(url, (a = { url, role, by: new Set(), uses: 0 }));
    a.uses++;
    if (who && a.by.size < 5) a.by.add(who);
  };
  for (const [, k] of p.kinds) for (const a of kindAssets(k.kind)) need(a.url, a.role, k.name);
  for (const a of kindAssets(table)) need(a.url, a.role, "the table");
  for (const o of p.objects) if (o.pdf) need(o.pdf, "pdf", o.name);
  const referenced = collectAssets(save.objects, { tableURL: save.tableURL });

  const assets = new Map(); // url → { url, role, source, bytes?, mimeType, extension, fileUrl, error, by, uses, size }
  let done = 0;
  progress("Finding assets", 0, needed.size);
  for (const a of needed.values()) {
    const entry = { url: a.url, role: a.role, by: [...a.by], uses: a.uses, source: null, fileUrl: null, error: null, mimeType: null, extension: null, size: 0, bytes: null };
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
      const ok = a.role === "model" ? t.extension === "obj" : a.role === "pdf" ? t.extension === "pdf" : t.image;
      if (!ok) {
        entry.error = `expected ${a.role === "model" ? "an OBJ" : a.role === "pdf" ? "a PDF" : "an image"}, got ${t.mimeType}${t.extension === "html" ? " (a web page: the link is probably dead)" : ""}`;
        entry.bytes = null;
        entry.source = null;
      }
    }
    assets.set(a.url, entry);
    progress("Finding assets", ++done, needed.size);
  }

  // ─── raw assets as file docs ─────────────────────────────────────────────
  done = 0;
  // a raw asset bigger than this is used, but not kept as a document of its own
  const keepLimit = Number(s.maxStoredBytes) > 0 ? Number(s.maxStoredBytes) : 32e6;
  const present = [...assets.values()].filter((a) => a.bytes && a.size <= keepLimit);
  for (const a of assets.values()) if (a.bytes && a.size > keepLimit) warnings.push(`${a.url} (${Math.round(a.size / 1e6)} MB) was used but not stored: over ${Math.round(keepLimit / 1e6)} MB`);
  progress("Storing assets", 0, present.length);
  for (const a of present) {
    const content = a.extension === "obj" ? new TextDecoder().decode(a.bytes) : a.bytes;
    const h = await repo.create2({
      "@patchwork": { type: "file" },
      name: `${safeName(a.by[0] ?? "asset")} (${a.role === "model" ? "model" : a.role === "pdf" ? "pdf" : "image"}).${a.extension}`,
      extension: a.extension,
      mimeType: a.mimeType,
      content,
    });
    a.fileUrl = h.url;
    progress("Storing assets", ++done, present.length);
  }

  // ─── the build context ───────────────────────────────────────────────────
  const opened = new Map(); // url → Promise<handle>, a few at a time (sheets are big)
  const openOrder = [];
  const open = (url) => {
    const a = assets.get(url);
    if (!a?.bytes || a.role === "model") return null;
    if (!opened.has(url)) {
      opened.set(
        url,
        images.open(a.bytes, a.mimeType).catch((err) => {
          a.error = `couldn't decode: ${err?.message ?? err}`;
          return null;
        }),
      );
      openOrder.push(url);
      while (openOrder.length > 6) {
        const old = openOrder.shift();
        opened.get(old)?.then((h) => h && images.close(h));
        opened.delete(old);
      }
    }
    return opened.get(url);
  };
  const textures = new Map();
  const meshes = new Map();
  const ctx = {
    unit,
    flipObjX: s.flipObjX,
    sizes: { card: s.cardTexture },
    async texture(url, rect, max) {
      const key = `${url}|${rect.x},${rect.y},${rect.w},${rect.h}|${max}`;
      if (!textures.has(key)) textures.set(key, Promise.resolve(open(url)).then((h) => (h ? images.crop(h, rect, { maxSize: max }) : null)));
      return textures.get(key);
    },
    async imageSize(url) {
      const h = await open(url);
      return h ? { width: h.width, height: h.height } : null;
    },
    async shape(url) {
      const h = await open(url);
      return h ? images.shape(h, { x: 0, y: 0, w: 1, h: 1 }) : null;
    },
    async mesh(url) {
      const a = assets.get(url);
      if (!a?.bytes) return null;
      if (!meshes.has(url)) {
        try {
          meshes.set(url, parseOBJ(a.bytes));
        } catch (err) {
          a.error = `couldn't parse: ${err?.message ?? err}`;
          meshes.set(url, null);
        }
      }
      return meshes.get(url);
    },
  };

  // ─── one GLB per kind, sheet by sheet ────────────────────────────────────
  const list = [...p.kinds.entries(), [tableKey, { kind: table, name: "Table", count: 1 }]];
  const firstImage = (k) => kindAssets(k.kind).find((a) => a.role === "image")?.url ?? "";
  list.sort((a, b) => firstImage(a[1]).localeCompare(firstImage(b[1])));
  const built = new Map();
  const kindReport = {};
  const notes = new Map();
  done = 0;
  progress("Drawing pieces", 0, list.length);
  for (const [key, k] of list) {
    try {
      const out = await buildKind(k.kind, ctx);
      const h = await repo.create2({
        "@patchwork": { type: "file" },
        name: `${safeName(k.name)}.glb`,
        extension: "glb",
        mimeType: "model/gltf-binary",
        content: out.glb,
      });
      built.set(key, { glbUrl: h.url, bounds: out.bounds });
      kindReport[shortHash(key)] = { name: k.name, type: k.kind.type, copies: k.count, glbUrl: h.url, bytes: out.glb.byteLength, triangles: out.triangles, ...(out.notes.length ? { notes: out.notes.slice(0, 4) } : {}) };
      for (const n of out.notes) notes.set(n, (notes.get(n) ?? 0) + 1);
    } catch (err) {
      kindReport[shortHash(key)] = { name: k.name, type: k.kind.type, copies: k.count, glbUrl: null, error: String(err?.message ?? err) };
      warnings.push(`couldn't draw “${k.name}”: ${err?.message ?? err}`);
    }
    progress("Drawing pieces", ++done, list.length);
  }
  for (const h of opened.values()) h?.then((x) => x && images.close(x));

  // ─── secrets, then the scene ─────────────────────────────────────────────
  progress("Laying out the table");
  const secretUrls = new Map();
  for (const { key, doc } of secretsDocs(p, built)) secretUrls.set(key, (await repo.create2(doc)).url);
  const pdfUrls = new Map();
  for (const a of assets.values()) if (a.role === "pdf" && a.fileUrl) pdfUrls.set(a.url, a.fileUrl);
  const { scene, stats } = sceneDoc(p, built, { unit, infoUrl, infoToolId, title: `${save.saveName}`, secretUrls, pdfUrls, table: { key: tableKey, extent } });
  const sceneHandle = await repo.create2(scene);

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
  const ok = (a) => !a.error && !!a.source;
  const missing = [...assets.values()].filter((a) => !ok(a)).length;
  const report = {
    mod: { saveName: save.saveName, gameMode: save.gameMode, fileName: found.path, table: save.table, objects: Object.values(countNames(save.objects)).reduce((x, y) => x + y, 0) },
    counts: {
      byName: countNames(save.objects),
      placed: p.counts.placed,
      hidden: p.counts.hidden,
      groups: p.groups.length,
      skipped: p.counts.skipped,
      approximated: p.counts.approximated,
      kinds: list.length,
      glbBytes: Object.values(kindReport).reduce((n, k) => n + (k.bytes ?? 0), 0),
      assets: { needed: assets.size, cache: [...assets.values()].filter((a) => ok(a) && a.source === "cache").length, fetched: [...assets.values()].filter((a) => ok(a) && a.source === "fetch").length, missing, referenced: referenced.size },
      seats: Object.keys(scene.traits?.["tabletop.seats"] ?? {}).length,
      secrets: secretUrls.size,
      tableY: stats.tableY,
    },
    assets: assetReport,
    kinds: kindReport,
    notes: Object.fromEntries([...notes].slice(0, 50)),
    warnings,
    sceneUrl: sceneHandle.url,
    finishedAt: now(),
  };
  progress("Done", 1, 1);
  return { sceneUrl: sceneHandle.url, report, scene };
}
