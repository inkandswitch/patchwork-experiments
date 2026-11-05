// What a job's source is, its current key, and its geometry in print space.
//
// A source is a scene-render doc (preferred: exactly the geometry the scene
// shows, built with the scene's params, in metres) or a Patchwork `file` doc
// holding a GLB or an STL.

import { fileBytes, isRenderDoc, readRender, renderKey } from "./render-read.js";
import { parseGlb } from "./glb-read.js";
import { parseStl } from "./stl.js";
import { maxExtent, resolveUnits, toPrintSpace } from "./units.js";
import { hashBytes } from "./output.js";
import { sourceKeyFor } from "./staleness.js";
import { openEdges } from "./mesh.js";

const GLB_MAGIC = 0x46546c67;

function sniff(bytes) {
  if (bytes.byteLength >= 4 && new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true) === GLB_MAGIC) return "glb";
  if (bytes.byteLength >= 84) {
    const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
    if (84 + n * 50 === bytes.byteLength) return "stl";
  }
  const head = new TextDecoder().decode(bytes.subarray(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("solid") && /facet|endsolid/.test(new TextDecoder().decode(bytes.subarray(0, 4096)).toLowerCase())) return "stl";
  return null;
}

/** "glb" | "stl" | null for a Patchwork file doc: by extension, name or mime type, then by its bytes. */
export function fileFormat(doc) {
  if (!doc || doc.content == null) return null;
  const ext = String(doc.extension ?? "").toLowerCase().replace(/^\./, "");
  const name = String(doc.name ?? doc.title ?? "").toLowerCase();
  const mime = String(doc.mimeType ?? "").toLowerCase();
  if (ext === "glb" || name.endsWith(".glb") || mime === "model/gltf-binary") return "glb";
  if (ext === "stl" || name.endsWith(".stl") || mime.includes("stl")) return "stl";
  try {
    return sniff(fileBytes(doc));
  } catch {
    return null;
  }
}

/**
 * @returns {{ kind: "render" } | { kind: "file", format: "glb"|"stl" } | { kind: "unsupported", type: string|null }}
 */
export function describeSource(doc) {
  if (isRenderDoc(doc)) return { kind: "render" };
  const format = fileFormat(doc);
  if (format) return { kind: "file", format };
  return { kind: "unsupported", type: doc?.["@patchwork"]?.type ?? null };
}

/** A name for a source doc, for the UI and file names. */
export function sourceName(doc) {
  const n = doc?.title || doc?.name || "";
  return String(n || "model");
}

/**
 * The source's current key and state, as decide() wants it.
 * @returns {Promise<{ sourceState: "ok"|"unbuilt"|"unsupported", sourceKey: string|null }>}
 */
export async function currentSourceKey(url, doc) {
  const d = describeSource(doc);
  if (d.kind === "render") {
    if (!doc.glbUrl) return { sourceState: "unbuilt", sourceKey: null };
    return { sourceState: "ok", sourceKey: sourceKeyFor(url, renderKey(doc)) };
  }
  if (d.kind === "file") return { sourceState: "ok", sourceKey: sourceKeyFor(url, await hashBytes(fileBytes(doc))) };
  return { sourceState: "unsupported", sourceKey: null };
}

export class SourceError extends Error {
  constructor(message, { code = "error", sourceKey = null } = {}) {
    super(message);
    this.code = code; // "unbuilt" | "unsupported" | "error"
    this.sourceKey = sourceKey;
  }
}

/**
 * Read a source's geometry into print space (Z up, mm, scaled).
 * The returned sourceKey is of what was actually read, so a slice records the
 * GLB it sliced even if the render moved on meanwhile.
 * @param {object} o
 * @param {object} o.repo
 * @param {string} o.url
 * @param {object} o.settings   normalized settings
 * @returns {Promise<{ tris: Float32Array, sourceKey: string, sourceKind: "scene-render"|"glb"|"stl",
 *   renderOf: string|null, units: ReturnType<typeof resolveUnits>, triangles: number, openEdges: number, heads: string[] }>}
 */
export async function loadModel({ repo, url, settings }) {
  const handle = await repo.find(url);
  const doc = handle.doc();
  const heads = [...(handle.heads?.() ?? [])].map(String);
  const d = describeSource(doc);
  if (d.kind === "unsupported") {
    throw new SourceError(
      d.type === "openscad"
        ? "This is an OpenSCAD document. Add it to a scene, then drag its object from the scene's outline here: the slicer reads the scene's render."
        : `Can't slice a ${d.type ?? "document of unknown type"}: the source must be a scene object's render, or a GLB or STL file.`,
      { code: "unsupported" },
    );
  }
  let raw, units, sourceKey, sourceKind, renderOf = null;
  if (d.kind === "render") {
    const r = await readRender(repo, url);
    sourceKey = sourceKeyFor(url, renderKey(r.render));
    renderOf = r.source;
    if (!r.glb) {
      throw new SourceError(
        r.status === "error" ? `The scene couldn't build this object: ${r.error ?? "unknown error"}` : "This object hasn't been built yet. Open its scene to build it.",
        { code: "unbuilt", sourceKey },
      );
    }
    sourceKind = "scene-render";
    try {
      raw = parseGlb(r.glb).tris;
    } catch (err) {
      throw new SourceError(err.message, { sourceKey });
    }
    units = resolveUnits({ kind: "render", settings });
  } else {
    const bytes = fileBytes(doc);
    sourceKey = sourceKeyFor(url, await hashBytes(bytes));
    sourceKind = d.format;
    try {
      if (d.format === "glb") {
        const g = parseGlb(bytes);
        raw = g.tris;
        units = resolveUnits({ kind: "glb", fileUnits: g.units, settings, extent: maxExtent(raw) });
      } else {
        raw = parseStl(bytes);
        units = resolveUnits({ kind: "stl", settings });
      }
    } catch (err) {
      throw new SourceError(err.message, { sourceKey });
    }
  }
  const tris = toPrintSpace(raw, units.unit, units.up, settings.scale);
  return { tris, sourceKey, sourceKind, renderOf, units, triangles: tris.length / 9, openEdges: openEdges(tris), heads };
}
