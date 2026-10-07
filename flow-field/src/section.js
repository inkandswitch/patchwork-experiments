// Getting a section of the linked doc (doc.body.url). Main thread only: it
// uses the repo and the host's plugin registry, both late-bound.
//
// 1. exact: a `geometry:section` provider for the linked doc's datatype
//    (scene contract v2 §2) answers with loops in the floating frame.
// 2. mesh fallback: a `scene:source` provider for that datatype builds the doc
//    to a GLB in memory (nothing is stored), and mesh-section.js cuts its
//    triangles with the plane.
// Either can be missing; the result then says why, and the flow goes on
// without a body.

import { loadGetRegistry } from "./registry.js";
import { meshSection } from "./mesh-section.js";
import { normalizeLoops, planeZ } from "./body.js";

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

/** A section result made safe: loops normalised, plane z filled in. */
export function cleanSection(result, plane) {
  const z = Number.isFinite(result?.plane?.z) ? result.plane.z : planeZ(plane);
  const loops = normalizeLoops(result?.loops).map((points) => ({ points, closed: true }));
  return {
    frame: "floating",
    units: "m",
    plane: { kind: plane?.kind === "z" ? "z" : "waterline", z },
    loops,
    meta: result?.meta && typeof result.meta === "object" ? { ...result.meta } : {},
  };
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
 * @returns {Promise<{ ok: true, section, path: "exact"|"mesh", providerId, providerName, datatype, handle, doc }
 *                  | { ok: false, error: string, transient: boolean, datatype?, handle?, doc? }>}
 *   `transient` failures are about this peer's situation, not the link: the
 *   doc hasn't loaded here, or nothing installed here can cut it. Another
 *   peer (or this one, later) may well succeed. The rest (a self-link, a flow
 *   linked to a flow) fail the same everywhere.
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
      const result = await mod.build({ doc, handle: h, url, params: defaultParams(p.params), repo });
      let glb = result?.glb;
      if (glb instanceof ArrayBuffer) glb = new Uint8Array(glb);
      if (!(glb instanceof Uint8Array)) throw new Error("it returned no GLB");
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

/** A short human line for which path gave the section. */
export function sectionPathLabel(r) {
  if (!r?.ok) return "";
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
