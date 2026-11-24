// The hull a case links, as triangles in the floating frame. Main thread
// only (it needs the repo and the plugin registry). Three paths, tried in
// this order, the same ones flow-field takes for its body:
//
//   render  a scene's `scene-render` doc: its current GLB, exactly what the
//           scene shows (preferred: built once, with the scene's params)
//   file    a Patchwork `file` doc holding a GLB
//   source  any other doc a `scene:source` provider can build (a camber hull,
//           an OpenSCAD part, an STL file): built here with the provider's
//           default params
//
// Nothing is stored: a run freezes the result as STL when it is asked for.

import { readRender, isRenderDoc, fileBytes, renderKey } from "../render-read.js";
import { decodeGLB, glbTriangles } from "./mesh-read.js";
import { loadGetRegistry } from "../registry.js";
import { CASE_TYPE, RUN_TYPE, SERVER_TYPE } from "../protocol.js";

const GLB_MAGIC = 0x46546c67;
const OWN = new Set([CASE_TYPE, RUN_TYPE, SERVER_TYPE]);

function extensionOf(doc) {
  const ext = String(doc?.extension ?? "").replace(/^\./, "").toLowerCase();
  if (ext) return ext;
  const m = String(doc?.name ?? "").match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : null;
}

export function isGlbFile(doc) {
  if (doc?.["@patchwork"]?.type !== "file") return false;
  const ext = extensionOf(doc);
  if (ext) return ext === "glb";
  try {
    const b = fileBytes(doc);
    return b.byteLength >= 4 && new DataView(b.buffer, b.byteOffset, 4).getUint32(0, true) === GLB_MAGIC;
  } catch {
    return false;
  }
}

function providerMatches(p, datatype, ext) {
  const types = Array.isArray(p.supportedDatatypes) ? p.supportedDatatypes : [];
  if (!(types.includes(datatype) || types.includes("*"))) return 0;
  const exts = Array.isArray(p.extensions) ? p.extensions : null;
  if (exts) return ext && exts.includes(ext) ? 3 : 0;
  return types.includes(datatype) ? 2 : 1;
}

const titleOf = (doc) => String(doc?.title || doc?.name || "hull");

/**
 * @returns {Promise<{ ok: true, triangles: Float64Array, path: "render"|"file"|"source", title: string, providerId: string|null, renderKey?: string }
 *                 | { ok: false, error: string, pending?: boolean }>}
 */
export async function acquireHull(repo, url, { getRegistry } = {}) {
  if (!url) return { ok: false, error: "no hull linked" };
  let h;
  try {
    h = await repo.find(url);
  } catch (err) {
    return { ok: false, error: `couldn't load the hull (${err?.message ?? err})` };
  }
  const doc = h.doc();
  if (!doc) return { ok: false, error: "the hull isn't available" };
  let heads = null;
  try {
    heads = h.heads?.() ?? null;
  } catch {
    heads = null;
  }
  const type = doc?.["@patchwork"]?.type ?? null;
  if (OWN.has(type)) return { ok: false, error: "that's an OpenFOAM document, not a hull" };
  const cut = async (bytes) => glbTriangles(await decodeGLB(bytes));

  if (isRenderDoc(doc)) {
    const title = String(doc.title || "scene render");
    let r;
    try {
      r = await readRender({ find: (u) => (u === url ? h : repo.find(u)) }, url);
    } catch (err) {
      return { ok: false, error: `couldn't read the render (${err?.message ?? err})` };
    }
    if (!r.glb) return { ok: false, pending: true, error: r.failure?.error ? `the render failed: ${r.failure.error}` : `“${title}” isn't built yet` };
    const t = await cut(r.glb);
    return { ok: true, triangles: t.triangles, ranges: t.ranges, heads, path: "render", title, providerId: doc.providerId ?? null, renderKey: renderKey(doc) };
  }
  if (isGlbFile(doc)) {
    const t = await cut(fileBytes(doc));
    return { ok: true, triangles: t.triangles, ranges: t.ranges, heads, path: "file", title: titleOf(doc), providerId: null };
  }
  const get = getRegistry ?? (await loadGetRegistry());
  if (!get) return { ok: false, error: "no plugin registry here, so nothing can build the hull" };
  let sources;
  try {
    sources = get("scene:source");
  } catch {
    sources = null;
  }
  const ext = type === "file" ? extensionOf(doc) : null;
  const candidates = (sources?.filter?.(() => true) ?? [])
    .map((p) => ({ p, score: providerMatches(p, type, ext) }))
    .filter(({ p, score }) => score > 0 && p.content === "built" && !String(p.id).startsWith("openfoam"))
    .sort((a, b) => b.score - a.score || String(a.p.id).localeCompare(String(b.p.id)))
    .map(({ p }) => p);
  const notes = [];
  for (const p of candidates) {
    try {
      const mod = (await sources.load(p.id))?.module;
      if (typeof mod?.build !== "function") throw new Error("it has no build()");
      const params = Object.fromEntries((p.params ?? []).map((s) => [s.key, s.default]));
      const result = await mod.build({ doc, handle: h, url, params, repo });
      let bytes = result?.glb;
      if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
      if (!(bytes instanceof Uint8Array)) throw new Error("it returned no GLB");
      const t = await cut(bytes);
      return { ok: true, triangles: t.triangles, ranges: t.ranges, heads, path: "source", title: titleOf(doc), providerId: p.id, providerName: p.name ?? p.id };
    } catch (err) {
      notes.push(`${p.name ?? p.id} failed (${err?.message ?? err})`);
    }
  }
  const what = type === "file" ? (ext ? `.${ext} files` : "this kind of file") : `${type ?? "this kind of"} documents`;
  return {
    ok: false,
    error: notes.length
      ? `couldn't read the hull: ${notes.join("; ")}`
      : `nothing loaded here reads ${what}: load a package that does (a geometry reader for them, registered as a scene:source), or link a GLB`,
  };
}

export function pathLabel(r) {
  if (!r?.ok) return "";
  if (r.path === "render") return "scene render";
  if (r.path === "file") return "GLB file";
  return `built by ${r.providerName ?? r.providerId} (defaults)`;
}
