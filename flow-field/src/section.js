// Getting a section of the linked doc (doc.body.url). Main thread only: it
// uses the repo and the host's plugin registry, both late-bound.
//
// 0. render (preferred): the link is a scene's `scene-render` doc. Its
//    current GLB (render-read.js) is what the scene shows, built with the
//    params the scene chose, with the render's own dependencies already
//    folded in; mesh-section.js cuts its triangles with the plane. No
//    provider is called. A render with no GLB yet gives no body (not an
//    error the build throws on): the host rebuilds the flow when the render
//    gets a new glbUrl, since the url is in dependencies().
// Otherwise the link is a source doc (a hull), the legacy path:
// 1. exact: a `geometry:section` provider for the linked doc's datatype
//    (scene contract v2 §2) answers with loops in the floating frame. None
//    exists yet; the hook stays so one can be added without touching this.
// 2. mesh fallback: a `scene:source` provider for that datatype builds the doc
//    to a GLB in memory (nothing is stored), with its DEFAULT params, and
//    mesh-section.js cuts its triangles with the plane. Builds are cached
//    (upstream.js), so the two flow providers share one per hull edit.
// Either can be missing; the result then says why, and the flow goes on
// without a body.

import { loadGetRegistry } from "./registry.js";
import { meshSection } from "./mesh-section.js";
import { normalizeLoops, planeZ } from "./body.js";
import { stableStringify } from "./fingerprint.js";
import { sectionKey } from "./flow.js";
import { isRenderDoc, readRender, renderKey } from "./render-read.js";
import { cachedUpstream, rememberUpstreamDeps } from "./upstream.js";

export const OWN_DATATYPE = "flow-field";

/** The contract's request for a plane. */
export function sectionRequest(plane) {
  return plane?.kind === "z" && Number.isFinite(plane.z) ? { plane: { kind: "z", z: plane.z } } : { plane: { kind: "waterline" } };
}

/** Copy of the scene host's provider matching: datatype (and extension, for file providers). */
export function describeSource(doc) {
  const datatype = doc?.["@patchwork"]?.type ?? null;
  let extension = null;
  if (datatype === "file" || doc?.extension != null) {
    extension = String(doc?.extension ?? "").trim().replace(/^\.+/, "").toLowerCase() || null;
  }
  return { datatype, extension };
}

export function providerMatches(p, { datatype, extension }) {
  const sd = p?.supportedDatatypes;
  const typeOk = sd === "*" || (Array.isArray(sd) && (sd.includes("*") || (datatype != null && sd.includes(datatype))));
  if (!typeOk) return false;
  const exts = Array.isArray(p.extensions) ? p.extensions.map((e) => String(e).replace(/^\.+/, "").toLowerCase()) : null;
  if (exts && exts.length > 0) return extension != null && exts.includes(extension);
  return true;
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

/**
 * Find the linked doc and cut its section.
 * @param {object} o
 * @param {string} o.url              the linked doc
 * @param {object} o.plane            doc.body.plane
 * @param {object} o.repo             the automerge repo (o.handle may be given instead)
 * @param {object} [o.handle]         the linked doc's handle, if already found
 * @param {Function} [o.getRegistry]  defaults to the host's (late-bound)
 * @param {string} [o.selfUrl]        the flow doc's own url (a flow can't be its own body)
 * @returns {Promise<{ ok: true, section, path: "render"|"exact"|"mesh", providerId, providerName, datatype, handle, doc, renderKey?, title? }
 *                  | { ok: false, error: string, transient: boolean, pending?: true, datatype?, handle?, doc?, renderKey?, title? }>}
 *   `transient` failures are about this peer's situation, not the link: the
 *   doc hasn't loaded here, or nothing installed here can cut it. Another
 *   peer (or this one, later) may well succeed. The rest (a self-link, a flow
 *   linked to a flow, a render that hasn't been built: `pending`) are the same
 *   everywhere. For a render, `renderKey` is the key of the render as read;
 *   it changes exactly when its GLB does.
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
  if (isRenderDoc(doc)) return renderSection({ url, doc, handle: h, plane, repo, selfUrl, fail });
  const get = getRegistry ?? (await loadGetRegistry());
  if (!get) return fail("the plugin registry isn't available, so nothing can cut a section");
  const request = sectionRequest(plane);
  const z = planeZ(request.plane);
  const notes = [];

  // 1. an exact section
  let sections = null;
  try {
    sections = get("geometry:section");
  } catch {
    sections = null;
  }
  for (const p of list(sections).filter((p) => providerMatches(p, source))) {
    if (Array.isArray(p.planes) && !p.planes.includes(request.plane.kind)) continue;
    try {
      const mod = await loadModule(sections, p);
      if (typeof mod?.section !== "function") throw new Error("it has no section()");
      const result = await mod.section(doc, request);
      return { ok: true, section: cleanSection(result, request.plane), path: "exact", providerId: p.id, providerName: p.name ?? p.id, datatype, handle: h, doc };
    } catch (err) {
      notes.push(`${p.name ?? p.id} failed (${err?.message ?? err})`);
    }
  }

  // 2. slice the provider's mesh
  let sources = null;
  try {
    sources = get("scene:source");
  } catch {
    sources = null;
  }
  const candidates = list(sources).filter(
    (p) => providerMatches(p, source) && !(Array.isArray(p.supportedDatatypes) && p.supportedDatatypes.includes(OWN_DATATYPE)),
  );
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
      const section = cleanSection(meshSection(glb, z, request.plane), request.plane);
      if (notes.length) section.meta.notes = `${section.meta.notes ?? ""}; ${notes.join("; ")}`;
      return { ok: true, section, path: "mesh", providerId: p.id, providerName: p.name ?? p.id, datatype, handle: h, doc };
    } catch (err) {
      notes.push(`${p.name ?? p.id} failed (${err?.message ?? err})`);
    }
  }
  const what = datatype ? `“${datatype}” documents` : "this document";
  return fail(
    notes.length ? `no section of the linked document: ${notes.join("; ")}` : `no geometry:section or scene:source provider is installed for ${what}`,
  );
}

/**
 * The section of a linked scene-render doc: its current GLB, sliced. The GLB
 * is Y-up metres in the render's frame, mapped into the floating frame the
 * same way as the mesh fallback (x = X, y = −Z, z = Y).
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
  const request = sectionRequest(plane);
  const section = cleanSection(meshSection(r.glb, planeZ(request.plane), request.plane), request.plane);
  return { ok: true, section, path: "render", providerId: doc.providerId ?? null, providerName: title, handle, doc, ...extra };
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
  return r.path === "exact" ? `exact section (${r.providerName})` : `mesh slice of ${r.providerName}`;
}

/**
 * For the scene providers: the section for a doc's body, or why there isn't one.
 * A transient failure THROWS: a body-less build would be recorded as up to
 * date against the hull's heads and every peer would keep it, when the
 * trouble is only that this peer can't see the hull or has nothing
 * installed to cut it. Throwing keeps the last good render and leaves it
 * stale, so a peer that can cut the section rebuilds it.
 * @returns {Promise<{ section: object|null, result: object|null }>}
 */
export async function bodySectionFor(doc, spec, { repo, url, getRegistry } = {}) {
  if (!spec) return { section: null, result: null };
  const result = await acquireSection({ url: spec.url, plane: spec.plane, repo, getRegistry, selfUrl: url });
  if (!result.ok && result.transient) throw new Error(`the linked body isn't available here: ${result.error}`);
  return { section: result.ok ? result.section : null, result };
}
