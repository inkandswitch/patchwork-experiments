// Getting a section of the linked body (doc.body.url). Main thread only: it
// uses the repo and the host's plugin registry, both late-bound.
//
// The body is a geometry source, and the flow always cuts it itself
// (mesh-section.js), whatever it is. Anything a scene can show will do:
// 1. render (preferred): a scene's `scene-render` doc. Its current GLB
//    (render-read.js) is what the scene shows, built with the params the
//    scene chose, with the render's own dependencies already folded in. No
//    provider is called. A render with no GLB yet gives no body (not an error
//    the build throws on): the host rebuilds the flow when the render gets a
//    new glbUrl, since the url is in dependencies().
// 2. file: a Patchwork `file` doc holding a GLB (extension or name `.glb`, or
//    glTF magic bytes): what a scene shows directly for a passthrough object
//    (`renderUrl: null`, shown from `sourceUrl`; no render doc: scene/README.md,
//    "`scene` — the composition"). Its bytes are cut as they are.
// 3. source: any other doc some `scene:source` provider can build (the most
//    specific match first, as the scene host picks): it is built in memory
//    (nothing is stored) with the provider's DEFAULT params and the GLB is
//    cut. Builds are cached (upstream.js), so the two flow providers and the
//    editor share one per edit of the source.
// The flow never asks anything for a ready-made section (`geometry:section`):
// cutting the geometry here works for every source alike.

import { loadGetRegistry } from "./registry.js";
import { sliceGLB } from "./mesh-section.js";
import { normalizeLoops, planeZ } from "./body.js";
import { stableStringify } from "./fingerprint.js";
import { sectionKey } from "./flow.js";
import { fileBytes, isRenderDoc, readRender, renderKey } from "./render-read.js";
import { cachedUpstream, rememberUpstreamDeps } from "./upstream.js";

export const OWN_DATATYPE = "flow-field";

/** The plane, made safe: a finite z plane, else the waterline. */
export function normalizePlane(plane) {
  return plane?.kind === "z" && Number.isFinite(plane.z) ? { kind: "z", z: plane.z } : { kind: "waterline" };
}

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
  if (datatype === "file" || doc?.extension != null) {
    extension = normalizeExtension(doc?.extension) || extensionOf(doc?.name) || null;
  }
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

/**
 * Copy of the scene host's matchProviders: the providers for a source, most
 * specific first (datatype + extension, then datatype, then a wildcard),
 * registry order among equals.
 */
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

/**
 * Is this a `file` doc holding a GLB? By its extension (or its name's), and
 * for a file that names none, by its first four bytes.
 */
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

function list(registry) {
  try {
    return registry?.filter?.(() => true) ?? [];
  } catch {
    return [];
  }
}

async function loadModule(registry, p) {
  const loaded = await registry.load?.(p.id);
  return loaded?.module ?? null;
}

/** Build params from a provider's ParamSpecs: every default. */
export function defaultParams(specs) {
  const out = {};
  for (const s of Array.isArray(specs) ? specs : []) if (s?.key != null) out[s.key] = s.default;
  return out;
}

/**
 * A section result made safe: loops normalised, plane z filled in. `key` is a
 * hash of the plane and the loops, so two cuts with the same geometry share a
 * key however many times they are made (compileFlow caches on it).
 */
export function cleanSection(result, plane) {
  const z = Number.isFinite(result?.plane?.z) ? result.plane.z : planeZ(plane);
  const loops = normalizeLoops(result?.loops).map((points) => ({ points, closed: true }));
  const kind = plane?.kind === "z" ? "z" : "waterline";
  return {
    frame: "floating",
    units: "m",
    plane: { kind, z },
    loops,
    key: sectionKey({ plane: { kind, z }, loops }),
    meta: result?.meta && typeof result.meta === "object" ? { ...result.meta } : {},
  };
}

/** Sorted heads of a handle, or null if it can't say. */
function headsOf(h) {
  try {
    const heads = h?.heads?.();
    return Array.isArray(heads) ? [...heads].map(String).sort() : null;
  } catch {
    return null;
  }
}

/**
 * The cache key of an upstream build: the provider (and its version), its
 * params, the body as the provider sees it (its fingerprint() if it has one,
 * else the body's heads), and the heads of every doc it says it reads. Null
 * (don't cache) when the body can't be identified.
 */
async function upstreamKey(p, mod, doc, h, params, deps, repo) {
  let body = null;
  if (typeof mod.fingerprint === "function") {
    try {
      const fp = mod.fingerprint(doc);
      if (fp != null) body = `fp:${fp}`;
    } catch {
      body = null;
    }
  }
  if (body == null) {
    const heads = headsOf(h);
    if (!heads) return null;
    body = `h:${heads.join(",")}`;
  }
  const depKeys = [];
  for (const d of deps) {
    let heads = null;
    try {
      heads = headsOf(await repo?.find?.(d));
    } catch {
      heads = null;
    }
    depKeys.push(`${d}=${heads ? heads.join(",") : "-"}`);
  }
  return `${p.id}@${p.version ?? ""}|${stableStringify(params)}|${body}|${depKeys.join(";")}`;
}

/** A provider's dependencies(doc), defensively: distinct urls, sorted, never the doc's own. */
function upstreamDeps(mod, doc, url) {
  try {
    const list = typeof mod?.dependencies === "function" ? mod.dependencies(doc) : [];
    return Array.isArray(list) ? [...new Set(list.filter((u) => typeof u === "string" && u && u !== url))].sort() : [];
  } catch {
    return [];
  }
}

/** One of the flow field's own scene providers? (A flow can't be the body of a flow.) */
const isFlowProviderId = (id) => typeof id === "string" && id.startsWith("flow-field");

/** A cut section, with why it is empty (if it is) lifted onto the result. */
function cut(raw, plane) {
  const section = cleanSection(raw, plane);
  return section.meta.miss ? { section, miss: section.meta.miss } : { section };
}

/**
 * Find the linked doc and cut its section.
 * @param {object} o
 * @param {string} o.url              the linked doc
 * @param {object} o.plane            doc.body.plane
 * @param {object} o.repo             the automerge repo (o.handle may be given instead)
 * @param {object} [o.handle]         the linked doc's handle, if already found
 * @param {Function} [o.getRegistry]  defaults to the host's (late-bound)
 * @param {string} [o.selfUrl]        the flow doc's own url (a flow can't be its own body)
 * @returns {Promise<{ ok: true, section, path: "render"|"file"|"source", providerId, providerName, datatype, handle, doc, miss?, renderKey?, title? }
 *                  | { ok: false, error: string, transient: boolean, pending?: true, datatype?, handle?, doc?, renderKey?, title? }>}
 *   `transient` failures are about this peer's situation, not the link: the
 *   doc hasn't loaded here, nothing installed here can build it, or this
 *   runtime can't decode its GLB (a meshopt GLB with no WebAssembly). Another
 *   peer (or this one, later) may well succeed. The rest (a self-link, a flow
 *   linked to a flow, a render that hasn't been built: `pending`, a file that
 *   isn't a readable GLB) are the same everywhere. For a render, `renderKey`
 *   is the key of the render as read; it changes exactly when its GLB does.
 *   `miss` says why an ok section has no loops (the plane misses the body).
 */
export async function acquireSection({ url, plane, repo, handle, getRegistry, selfUrl } = {}) {
  if (!url) return { ok: false, error: "no linked document", transient: false };
  if (selfUrl && url === selfUrl) return { ok: false, error: "a flow can't be linked to itself", transient: false };
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
  const fail = (error, transient = true) => ({ ok: false, error, transient, datatype, handle: h, doc });
  if (datatype === OWN_DATATYPE) return fail("a flow field can't be the body of another flow field", false);
  const at = normalizePlane(plane);
  const z = planeZ(at);
  if (isRenderDoc(doc)) return renderSection({ url, doc, handle: h, plane: at, repo, selfUrl, fail });
  if (isGlbFile(doc)) return fileSection({ doc, handle: h, plane: at, fail });

  // any doc a scene:source provider can build: build it, then cut the GLB
  const get = getRegistry ?? (await loadGetRegistry());
  if (!get) return fail("the plugin registry isn't available, so nothing can build the linked document");
  let sources = null;
  try {
    sources = get("scene:source");
  } catch {
    sources = null;
  }
  const candidates = matchProviders(list(sources), source).filter(
    (p) => !isFlowProviderId(p.id) && !(Array.isArray(p.supportedDatatypes) && p.supportedDatatypes.includes(OWN_DATATYPE)),
  );
  const notes = [];
  for (const p of candidates) {
    try {
      const mod = await loadModule(sources, p);
      if (typeof mod?.build !== "function") throw new Error("it has no build()");
      const params = defaultParams(p.params);
      const deps = upstreamDeps(mod, doc, url);
      rememberUpstreamDeps(url, deps);
      const key = await upstreamKey(p, mod, doc, h, params, deps, repo);
      const glb = await cachedUpstream(key, async () => {
        const result = await mod.build({ doc, handle: h, url, params, repo });
        let bytes = result?.glb;
        if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
        if (!(bytes instanceof Uint8Array)) throw new Error("it returned no GLB");
        return bytes;
      });
      const c = cut(await sliceGLB(glb, z, at), at);
      if (notes.length) c.section.meta.notes = `${c.section.meta.notes ?? ""}; ${notes.join("; ")}`;
      return { ok: true, ...c, path: "source", providerId: p.id, providerName: p.name ?? p.id, datatype, handle: h, doc };
    } catch (err) {
      notes.push(`${p.name ?? p.id} failed (${err?.message ?? err})`);
    }
  }
  return fail(
    notes.length
      ? `no section of the linked document: ${notes.join("; ")}`
      : `nothing installed here can build ${describeForHumans(source)} (no scene:source provider)`,
  );
}

/**
 * The section of a linked GLB `file` doc: its bytes, cut as they are. A file
 * that isn't a readable GLB is the same on every peer (not transient); one
 * whose content isn't here, or that this peer can't decode, is.
 */
async function fileSection({ doc, handle, plane, fail }) {
  const title = String(doc.name || doc.title || "GLB file");
  const extra = { title };
  let bytes;
  try {
    bytes = fileBytes(doc);
  } catch (err) {
    return { ...fail(`“${title}” has no content here (${err?.message ?? err})`), ...extra };
  }
  let raw;
  try {
    raw = await sliceGLB(bytes, planeZ(plane), plane);
  } catch (err) {
    // bad bytes are bad everywhere; a decoder this peer can't run is not
    if (err?.transient === true) return { ...fail(`“${title}” can't be decoded here (${err?.message ?? err})`), ...extra };
    return { ...fail(`“${title}” can't be read as a GLB (${err?.message ?? err})`, false), ...extra };
  }
  return { ok: true, ...cut(raw, plane), path: "file", providerId: null, providerName: title, datatype: "file", handle, doc, ...extra };
}

/**
 * The section of a linked scene-render doc: its current GLB, sliced. The GLB
 * is Y-up metres in the render's frame, mapped into the floating frame like
 * any other (x = X, y = −Z, z = Y).
 */
async function renderSection({ url, doc, handle, plane, repo, selfUrl, fail }) {
  const title = renderTitle(doc);
  const extra = { datatype: RENDER_DATATYPE, renderKey: renderKey(doc), title };
  if (selfUrl && doc.parent === selfUrl) return { ...fail("a flow can't be linked to its own render", false), ...extra };
  if (isFlowProviderId(doc.providerId)) return { ...fail("a flow field's render can't be the body of a flow field", false), ...extra };
  let r;
  try {
    if (!repo?.find) throw new Error("no repo to find it in");
    // the render's own handle is in hand: don't look it up again
    r = await readRender({ find: (u) => (u === url ? handle : repo.find(u)) }, url);
  } catch (err) {
    return { ...fail(`couldn't load the linked render's GLB (${err?.message ?? err})`), ...extra };
  }
  extra.renderKey = renderKey(r.render);
  if (!r.glb) {
    const why = r.status === "error" && r.error ? `its last build failed: ${r.error}` : `“${title}” has no GLB yet`;
    // the same on every peer, and the host rebuilds the flow when the render's
    // glbUrl changes: no body, and no throw
    return { ...fail(`linked body not built yet (${why})`, false), pending: true, ...extra };
  }
  let raw;
  try {
    raw = await sliceGLB(r.glb, planeZ(plane), plane);
  } catch (err) {
    // the same bytes everywhere: not transient, unless it's this peer's
    // decoder that's missing (no WebAssembly, the chunk didn't load)
    if (err?.transient === true) return { ...fail(`the render's GLB can't be decoded here (${err?.message ?? err})`), ...extra };
    return { ...fail(`the render's GLB can't be read (${err?.message ?? err})`, false), ...extra };
  }
  return { ok: true, ...cut(raw, plane), path: "render", providerId: doc.providerId ?? null, providerName: title, handle, doc, ...extra };
}

export const RENDER_DATATYPE = "scene-render";

/** A render doc's own title (the datatype's getTitle adds " (3D render)"; the editor asks it). */
export function renderTitle(render) {
  return String(render?.title || "scene render");
}

/** A short human line for which path gave the section. */
export function sectionPathLabel(r) {
  if (!r?.ok) return "";
  if (r.path === "render") return `slice of the scene render “${r.providerName}”`;
  if (r.path === "file") return `slice of the GLB file “${r.providerName}”`;
  return `slice of ${r.providerName}'s build (default params)`;
}

/** The editor chip's few words for the path. */
export function sectionPathChip(r) {
  if (!r?.ok) return "";
  if (r.path === "render") return "scene render";
  if (r.path === "file") return "GLB file";
  return `built from ${r.providerName} (defaults)`;
}

/**
 * For the scene providers: the section for a doc's body, or why there isn't one.
 * A transient failure THROWS: a body-less build would be recorded as up to
 * date against the body's key and every peer would keep it, when the
 * trouble is only that this peer can't see the body or has nothing
 * installed to build it. Throwing keeps the last good render and leaves it
 * stale, so a peer that can cut the section rebuilds it.
 * @returns {Promise<{ section: object|null, result: object|null }>}
 */
export async function bodySectionFor(doc, spec, { repo, url, getRegistry } = {}) {
  if (!spec) return { section: null, result: null };
  const result = await acquireSection({ url: spec.url, plane: spec.plane, repo, getRegistry, selfUrl: url });
  if (!result.ok && result.transient) throw new Error(`the linked body isn't available here: ${result.error}`);
  return { section: result.ok ? result.section : null, result };
}
