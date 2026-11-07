// Getting a hull mesh from a linked doc (doc.hull.link.url). Main thread
// only: it uses the repo and the host's plugin registry, both late-bound.
//
// The three paths and the provider matching are flow-field's section.js,
// copied (packages never import each other), returning the GLB's triangles
// instead of a section:
// 1. render (preferred): a scene's `scene-render` doc. Its current GLB is
//    what the scene shows, built with the params the scene chose: for a
//    camber hull, that is where "Scale to length" gives a real-size boat.
// 2. file: a Patchwork `file` doc holding a GLB.
// 3. source: any other doc some `scene:source` provider can build (the most
//    specific match first, as the scene host picks), built in memory with the
//    provider's DEFAULT params. For camber that is document size, so its
//    1 m example hulls arrive as 1 m models (the tool says so).
// The hull is used at the size it arrives: no size override (real size only).
// extras.ship is never read. A Chartroom hydrostatic table carried in the
// GLB's scene extras (wherever a producer nests it) is picked up and checked.

import { loadGetRegistry } from "./registry.js";
import { decodeGLB, glbTriangles } from "./glb-read.js";
import { fileBytes, isRenderDoc, readRender, renderKey } from "./render-read.js";
import { HYDROSTATIC_TABLE_FORMAT } from "../naval/chartroom-types.js";

export const OWN_DATATYPE = "rig-design";

/** Lower-case, no leading dot (copy of scene/src/providers.js). */
export function normalizeExtension(ext) {
  return String(ext ?? "")
    .trim()
    .replace(/^\.+/, "")
    .toLowerCase();
}

/** Extension from a file name, "" if none (copy of scene/src/providers.js). */
export function extensionOf(name) {
  const m = /\.([^./\\]+)$/.exec(String(name ?? ""));
  return m ? m[1].toLowerCase() : "";
}

/** Copy of the scene host's source description: datatype, and extension (or the name's) for files. */
export function describeSource(doc) {
  const datatype = doc?.["@patchwork"]?.type ?? null;
  let extension = null;
  if (datatype === "file" || doc?.extension != null) extension = normalizeExtension(doc?.extension) || extensionOf(doc?.name) || null;
  return { datatype, extension };
}

/** Copy of the scene host's provider matching: datatype (and extension, for file providers). */
export function providerMatches(p, { datatype, extension }) {
  const sd = p?.supportedDatatypes;
  const typeOk = sd === "*" || (Array.isArray(sd) && (sd.includes("*") || (datatype != null && sd.includes(datatype))));
  if (!typeOk) return false;
  const exts = Array.isArray(p.extensions) ? p.extensions.map(normalizeExtension) : null;
  if (exts && exts.length > 0) return extension != null && exts.includes(extension);
  return true;
}

/** Copy of the scene host's matchProviders: most specific first, registry order among equals. */
export function matchProviders(providers, source) {
  const score = (p) => {
    const sd = p.supportedDatatypes;
    const wild = sd === "*" || (Array.isArray(sd) && sd.includes("*"));
    const hasExt = Array.isArray(p.extensions) && p.extensions.length > 0;
    return (wild ? 0 : 2) + (hasExt ? 1 : 0);
  };
  return (providers ?? [])
    .filter((p) => p && p.id && providerMatches(p, source))
    .map((p, i) => ({ p, i, s: score(p) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map(({ p }) => p);
}

/** Copy of the scene host's wording for a source: ".stl files", "“camber-hull” documents". */
export function describeForHumans({ datatype, extension }) {
  if (datatype === "file" && extension) return `.${extension} files`;
  if (datatype) return `“${datatype}” documents`;
  return "this document";
}

const GLB_MAGIC = 0x46546c67; // "glTF"

/** Is this a `file` doc holding a GLB? By its extension (or its name's), else its first four bytes. */
export function isGlbFile(doc) {
  if (doc?.["@patchwork"]?.type !== "file") return false;
  const { extension } = describeSource(doc);
  if (extension) return extension === "glb";
  try {
    const b = fileBytes(doc);
    return b.byteLength >= 4 && new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true) === GLB_MAGIC;
  } catch {
    return false;
  }
}

/** Build params from a provider's ParamSpecs: every default. */
export function defaultParams(specs) {
  const out = {};
  for (const s of Array.isArray(specs) ? specs : []) if (s?.key != null) out[s.key] = s.default;
  return out;
}

function list(registry) {
  try {
    return registry?.filter?.(() => true) ?? [];
  } catch {
    return [];
  }
}

/** One of this package's own providers? (A rig can't be its own hull.) */
const isOwnProvider = (p) => typeof p?.id === "string" && (p.id.startsWith("rig-design") || (Array.isArray(p.supportedDatatypes) && p.supportedDatatypes.includes(OWN_DATATYPE)));

/**
 * A Chartroom hydrostatic table anywhere in the GLB's scene (or asset) extras,
 * at most three levels down: the camber wrapper has not settled where it
 * will put one, so any object that says it is one counts.
 */
export function findChartroomTable(json) {
  const roots = [json?.scenes?.[json?.scene ?? 0]?.extras, json?.asset?.extras];
  const seen = new Set();
  const walk = (o, depth) => {
    if (!o || typeof o !== "object" || seen.has(o) || depth > 3) return null;
    seen.add(o);
    if (o.format === HYDROSTATIC_TABLE_FORMAT) return o;
    for (const v of Object.values(o)) {
      const hit = walk(v, depth + 1);
      if (hit) return hit;
    }
    return null;
  };
  for (const r of roots) {
    const hit = walk(r, 0);
    if (hit) return hit;
  }
  return null;
}

/** GLB bytes → { triangles (glTF, metres), meshes, units, table }. Throws on a bad GLB. */
export async function meshFromGlb(bytes) {
  const g = await decodeGLB(bytes);
  const r = glbTriangles(g);
  return { ...r, table: findChartroomTable(g.json), generator: g.json?.asset?.generator ?? null };
}

/**
 * Find the linked doc and read its hull mesh.
 * @param {{ url: string, repo?: object, handle?: object, getRegistry?: Function, selfUrl?: string }} o
 * @returns {Promise<{ ok: true, mesh, path: "render"|"file"|"source", providerId, providerName, title, datatype, handle, doc, renderKey? }
 *                  | { ok: false, error: string, transient: boolean, pending?: true, handle?, doc?, renderKey?, title? }>}
 *   transient: about this peer (not loaded yet, nothing here can build it); a retry may succeed.
 */
export async function acquireHull({ url, repo, handle, getRegistry, selfUrl } = {}) {
  if (!url) return { ok: false, error: "no linked document", transient: false };
  if (selfUrl && url === selfUrl) return { ok: false, error: "a rig can't be its own hull", transient: false };
  let h = handle ?? null;
  try {
    if (!h) {
      if (!repo?.find) return { ok: false, error: "no repo to find the linked document in", transient: true };
      h = await repo.find(url);
    }
  } catch (err) {
    return { ok: false, error: `couldn't load the linked document (${err?.message ?? err})`, transient: true };
  }
  const doc = h?.doc?.();
  if (!doc) return { ok: false, error: "the linked document isn't available", transient: true, handle: h };
  const source = describeSource(doc);
  const { datatype } = source;
  const fail = (error, transient = true, extra = {}) => ({ ok: false, error, transient, datatype, handle: h, doc, ...extra });
  if (datatype === OWN_DATATYPE) return fail("a rig design can't be the hull of another rig", false);

  if (isRenderDoc(doc)) {
    const title = String(doc.title || "scene render");
    const extra = { renderKey: renderKey(doc), title };
    if (selfUrl && doc.parent === selfUrl) return fail("a rig can't be linked to its own render", false, extra);
    let r;
    try {
      r = await readRender({ find: (u) => (u === url ? h : repo.find(u)) }, url);
    } catch (err) {
      return fail(`couldn't load the linked render's GLB (${err?.message ?? err})`, true, extra);
    }
    extra.renderKey = renderKey(r.render);
    if (!r.glb) {
      const why = r.status === "error" && r.error ? `its last build failed: ${r.error}` : `“${title}” has no GLB yet`;
      return fail(`the linked hull isn't built yet (${why})`, false, { pending: true, ...extra });
    }
    try {
      return { ok: true, mesh: await meshFromGlb(r.glb), path: "render", providerId: doc.providerId ?? null, providerName: title, datatype: "scene-render", handle: h, doc, ...extra };
    } catch (err) {
      return fail(`the render's GLB can't be read (${err?.message ?? err})`, err?.transient === true, extra);
    }
  }

  if (isGlbFile(doc)) {
    const title = String(doc.name || doc.title || "GLB file");
    let bytes;
    try {
      bytes = fileBytes(doc);
    } catch (err) {
      return fail(`“${title}” has no content here (${err?.message ?? err})`, true, { title });
    }
    try {
      return { ok: true, mesh: await meshFromGlb(bytes), path: "file", providerId: null, providerName: title, title, datatype: "file", handle: h, doc };
    } catch (err) {
      return fail(`“${title}” can't be read as a GLB (${err?.message ?? err})`, err?.transient === true, { title });
    }
  }

  const get = getRegistry ?? (await loadGetRegistry());
  if (!get) return fail("the plugin registry isn't available, so nothing can build the linked document");
  let sources = null;
  try {
    sources = get("scene:source");
  } catch {
    sources = null;
  }
  const candidates = matchProviders(list(sources), source).filter((p) => !isOwnProvider(p));
  const notes = [];
  for (const p of candidates) {
    try {
      const loaded = await sources.load?.(p.id);
      const mod = loaded?.module ?? null;
      if (typeof mod?.build !== "function") throw new Error("it has no build()");
      const result = await mod.build({ doc, handle: h, url, params: defaultParams(p.params), repo });
      let bytes = result?.glb;
      if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
      if (!(bytes instanceof Uint8Array)) throw new Error("it returned no GLB");
      const name = p.name ?? p.id;
      return { ok: true, mesh: await meshFromGlb(bytes), path: "source", providerId: p.id, providerName: name, title: name, datatype, handle: h, doc };
    } catch (err) {
      notes.push(`${p.name ?? p.id} failed (${err?.message ?? err})`);
    }
  }
  return fail(notes.length ? `no hull from the linked document: ${notes.join("; ")}` : `nothing installed here can build ${describeForHumans(source)} (no scene:source provider)`);
}

/** The chip's few words for the path. */
export function hullPathChip(r) {
  if (!r?.ok) return "";
  if (r.path === "render") return `scene render “${r.providerName}”`;
  if (r.path === "file") return `GLB file “${r.providerName}”`;
  return `built by ${r.providerName} (its default params)`;
}
