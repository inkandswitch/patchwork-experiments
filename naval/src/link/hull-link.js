// Getting a hull mesh from a linked doc (doc.hull.link.url). Main thread
// only: it uses the repo and the host's plugin registry, both late-bound.
//
// Real size only. Analysis geometry comes from the hull itself, never from
// how a scene chose to show it:
// 1. source (the ordinary case): the hull's own doc (a camber hull, or any
//    doc some `scene:source` provider can build), built in memory by the most
//    specific provider with its DEFAULT params. For camber that is document
//    size (its unit, in metres), so a hull drawn at 12 m arrives at 12 m.
//    When the hull's package also registers a `chartroom:source` for its
//    datatype (chartroom-link.js), its hydrostatic table comes with the mesh
//    and is the statics' authority; else rig-build.js builds one from the
//    mesh.
// 2. file: a Patchwork `file` doc holding a GLB, at the size it holds.
// A scene's `scene-render` doc is refused ("link the hull itself"): its GLB
// is built with the params a scene chose ("Scale to length" stretches a
// hull to any length), and linking it made the rig's hull a different doc
// from the one a scene's sailing hull names. The provider matching is
// flow-field's section.js, copied (packages never import each other). The
// hull is used at the size it arrives: no size override. extras.ship is
// never read. A Chartroom table carried in a GLB's scene extras (wherever a
// producer nests it) is picked up and checked, below a chartroom:source's.

import { loadGetRegistry } from "./registry.js";
import { decodeGLB, glbTriangles } from "./glb-read.js";
import { fileBytes, isRenderDoc } from "./render-read.js";
import { chartroomTableFor } from "./chartroom-link.js";
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

/**
 * The fingerprint a GLB states for the document it was built from: its
 * producer's block of the scene extras (camber: extras.camber.fingerprint,
 * "camber-hull-surface/6:<hash>"), or null.
 */
export function glbFingerprint(json) {
  const extras = json?.scenes?.[json?.scene ?? 0]?.extras;
  if (!extras || typeof extras !== "object") return null;
  for (const v of Object.values(extras)) if (v && typeof v === "object" && typeof v.fingerprint === "string" && v.fingerprint) return v.fingerprint;
  return null;
}

/**
 * Do a GLB and a chartroom:source describe the same hull? The two write the
 * same hash differently: the GLB's is its scene provider's
 * ("<provider>/<build version>:<hash>"), the chartroom module's is the bare
 * "<hash>" that one ends in. So: equal, or the GLB's ends in ":<hash>".
 * @returns {"same"|"different"|"unknown"} unknown: one of them states none
 */
export function sameHull(glbPrint, tablePrint) {
  if (typeof glbPrint !== "string" || !glbPrint || typeof tablePrint !== "string" || !tablePrint) return "unknown";
  return glbPrint === tablePrint || glbPrint.endsWith(`:${tablePrint}`) ? "same" : "different";
}

/** GLB bytes → { triangles (glTF, metres), meshes, units, table, fingerprint }. Throws on a bad GLB. */
export async function meshFromGlb(bytes) {
  const g = await decodeGLB(bytes);
  const r = glbTriangles(g);
  return { ...r, table: findChartroomTable(g.json), generator: g.json?.asset?.generator ?? null, fingerprint: glbFingerprint(g.json) };
}

/** What a scene render says to a designer who linked it. */
export function renderRefusal(doc) {
  const title = String(doc?.title || "a scene render");
  const p = doc?.params ?? {};
  const scaled = p.size === "length" ? `, stretched to ${Number(p.lengthMeters) > 0 ? `${Number(p.lengthMeters)} m` : "a length"} by the scene` : "";
  return `“${title}” is a scene render${scaled}, not a hull: link the hull itself`;
}

/**
 * Find the linked doc and read its hull mesh.
 * @param {{ url: string, repo?: object, handle?: object, getRegistry?: Function, selfUrl?: string }} o
 *   handle: the linked doc's handle when the caller has it (a study reads a doc at pinned heads through a view)
 * @returns {Promise<{ ok: true, mesh, path: "file"|"source", providerId, providerName, title, datatype, handle, doc, table: { source: "chartroom"|"glb"|null, providerId?, fingerprint?, note? } }
 *                  | { ok: false, error: string, transient: boolean, handle?, doc?, title?, parent? }>}
 *   transient: about this peer (not loaded yet, nothing here can build it); a retry may succeed.
 *   parent: for a refused scene render, the hull it renders (what to link instead).
 *   mesh.table: the hull's own Chartroom table when one checks out (its chartroom:source's, else its GLB's), else null.
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
  if (isRenderDoc(doc)) return fail(renderRefusal(doc), false, { title: String(doc.title || "scene render"), parent: typeof doc.parent === "string" ? doc.parent : null });

  if (isGlbFile(doc)) {
    const title = String(doc.name || doc.title || "GLB file");
    let bytes;
    try {
      bytes = fileBytes(doc);
    } catch (err) {
      return fail(`“${title}” has no content here (${err?.message ?? err})`, true, { title });
    }
    try {
      const mesh = await meshFromGlb(bytes);
      return { ok: true, mesh, path: "file", providerId: null, providerName: title, title, datatype: "file", handle: h, doc, table: { source: mesh.table ? "glb" : null } };
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
    let mesh;
    try {
      const loaded = await sources.load?.(p.id);
      const mod = loaded?.module ?? null;
      if (typeof mod?.build !== "function") throw new Error("it has no build()");
      const result = await mod.build({ doc, handle: h, url, params: defaultParams(p.params), repo });
      let bytes = result?.glb;
      if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
      if (!(bytes instanceof Uint8Array)) throw new Error("it returned no GLB");
      mesh = await meshFromGlb(bytes);
    } catch (err) {
      notes.push(`${p.name ?? p.id} failed (${err?.message ?? err})`);
      continue;
    }
    const name = p.name ?? p.id;
    const table = await ownTable(doc, datatype, get, mesh);
    return { ok: true, mesh, path: "source", providerId: p.id, providerName: name, title: name, datatype, handle: h, doc, table };
  }
  return fail(notes.length ? `no hull from the linked document: ${notes.join("; ")}` : `nothing installed here can build ${describeForHumans(source)} (no scene:source provider)`);
}

/**
 * The hull's own table, put on the mesh: its package's chartroom:source
 * when one is installed, its table checks out (validateTable) and it
 * describes the hull the GLB was built from, else the GLB's own
 * (findChartroomTable), else none (rig-build.js builds one from the mesh).
 * Never throws.
 *
 * The same hull, by the fingerprints the two state (sameHull):
 *   same      → the table is used, and shares the mesh's frame (mesh.tableFrame "shared": camber builds both
 *               from one document in one authored origin), so LCB and LCF are the table's
 *   unknown   → the table is used, slid onto the mesh by its LCB (mesh.tableFrame "aligned")
 *   different → the table is another hull's: not used, and the note says so
 */
async function ownTable(doc, datatype, getRegistry, mesh) {
  let c;
  try {
    c = await chartroomTableFor({ doc, datatype, getRegistry });
  } catch (err) {
    c = { ok: false, absent: false, why: String(err?.message ?? err) };
  }
  if (c.ok) {
    const same = sameHull(mesh.fingerprint, c.fingerprint);
    if (same !== "different") {
      mesh.table = c.table;
      mesh.tableFrame = same === "same" ? "shared" : "aligned";
      mesh.tableName = c.providerName;
      return { source: "chartroom", providerId: c.providerId, providerName: c.providerName, fingerprint: c.fingerprint, frame: mesh.tableFrame };
    }
    c = { ok: false, absent: false, why: `its table is for another hull than its GLB (fingerprint ${c.fingerprint}, the GLB's ${mesh.fingerprint})` };
  }
  const note = c.absent ? undefined : `its chartroom:source wasn't used (${c.why})`;
  if (mesh.table) mesh.tableFrame = "aligned";
  return { source: mesh.table ? "glb" : null, ...(note ? { note } : {}) };
}

/** The chip's few words for the path. */
export function hullPathChip(r) {
  if (!r?.ok) return "";
  if (r.path === "file") return `GLB file “${r.providerName}”`;
  const statics = r.table?.source === "chartroom" ? `; statics from ${r.table.providerName ?? r.table.providerId}` : "";
  return `built by ${r.providerName} (its default params, at its own size${statics})`;
}
