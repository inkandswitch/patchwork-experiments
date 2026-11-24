// Subjects: what a dropped doc becomes in a study, and a subject resolved at
// its heads into the worker's "screen" job. Main thread only (the repo and
// the plugin registry, both late-bound).
//
// The hull is read through link/hull-link.js, so a subject is screened at
// real size, exactly as the Rig tool reads a linked hull: the hull's own doc
// built with its provider's default params (with its package's Chartroom
// table when it publishes one), or a GLB file. A scene render is refused,
// as there: "link the hull itself".

import { acquireHull, hullPathChip, renderRefusal } from "../link/hull-link.js";
import { isRenderDoc } from "../link/render-read.js";
import { normalize } from "../doc.js";
import { DEFAULT_FRAME } from "../naval/hull-frame.js";
import { STUDY_TYPE } from "./doc.js";

const DESIGN_TYPE = "rig-design";
const typeOf = (doc) => doc?.["@patchwork"]?.type ?? null;

/**
 * What a doc dropped into a study becomes.
 * @returns {{ ok: true, subject: { label, hull, design } } | { ok: false, error: string }}
 */
export function subjectFor(doc, url) {
  const type = typeOf(doc);
  if (!doc) return { ok: false, error: "that document isn't available here yet" };
  if (isRenderDoc(doc)) return { ok: false, error: renderRefusal(doc) };
  if (type === STUDY_TYPE) return { ok: false, error: "a study can't be a subject of a study" };
  if (type === DESIGN_TYPE) {
    const d = normalize(doc);
    // its hull is the one it links, read from it at every screen (doc.js): not copied here
    return { ok: true, subject: { label: d.title || "Rig", hull: null, design: { url, heads: null } } };
  }
  return { ok: true, subject: { label: String(doc.title || doc.name || type || "hull"), hull: { url, heads: null }, design: null } };
}

/** A handle at pinned heads (a read-only view), or the live one for null. */
export async function atHeads(handle, heads) {
  if (!heads) return handle;
  if (typeof handle?.view !== "function") throw Object.assign(new Error("this host can't open a document at a pinned version"), { permanent: true });
  return handle.view(heads);
}

const headsOf = (h) => {
  try {
    const v = h?.heads?.();
    return Array.isArray(v) ? v.map(String) : null;
  } catch {
    return null;
  }
};

/**
 * A subject, resolved: its docs at their heads, the hull read, the job built.
 * @param {{ id, label, hull, design }} subject a normalized subject
 * @param {{ repo: object, getRegistry?: Function }} ctx
 * @returns {Promise<{ ok: true, job: object, used: { hull: object|null, design: object|null }, chip: string, warnings: string[], live: object[] }
 *                  | { ok: false, error: string, transient: boolean, live: object[] }>}
 *   live: the handles followed (heads null), to watch for changes
 */
export async function resolveSubject(subject, { repo, getRegistry } = {}) {
  const live = [];
  const warnings = [];
  const used = { hull: null, design: null };
  const fail = (error, transient = false) => ({ ok: false, error, transient, live });
  if (!repo?.find) return fail("no repo to find the subject's documents in", true);
  let design = null;
  if (subject.design) {
    let h;
    try {
      h = await repo.find(subject.design.url);
      if (!subject.design.heads) live.push(h);
      h = await atHeads(h, subject.design.heads);
    } catch (err) {
      return fail(`couldn't open the design (${err?.message ?? err})`, !err?.permanent);
    }
    const raw = h?.doc?.();
    if (!raw) return fail("the design isn't available here yet", true);
    if (typeOf(raw) !== DESIGN_TYPE) return fail(`the design isn't a rig design (it is “${typeOf(raw)}”)`);
    design = normalize(raw);
    used.design = { url: subject.design.url, heads: subject.design.heads ?? headsOf(h) };
  }
  // the subject's own hull wins over the design's link (a design can be screened on another hull);
  // with none of its own, the hull is the design's link, at the heads the pin recorded for it
  const implied = !subject.hull && design?.hull.link ? design.hull.link.url : null;
  if (implied && subject.design.heads && !subject.design.hullHeads)
    return fail("this subject is pinned, but the hull its design links isn't: follow the latest, then pin it again");
  const hullRef = subject.hull ?? (implied ? { url: implied, heads: subject.design.hullHeads ?? null } : null);
  if (design && subject.hull) {
    if (design.hull.link && design.hull.link.url !== subject.hull.url) warnings.push("The design is linked to another hull: it is screened on this subject's hull.");
    design.hull.link = { url: subject.hull.url, frame: design.hull.link?.frame ?? { ...DEFAULT_FRAME } };
  }
  let linked = null;
  let chip = design && !hullRef ? "synthetic hull from the design's principal dimensions" : "";
  if (hullRef) {
    let h;
    try {
      h = await repo.find(hullRef.url);
      if (!hullRef.heads) live.push(h);
      h = await atHeads(h, hullRef.heads);
    } catch (err) {
      return fail(`couldn't open the hull (${err?.message ?? err})`, !err?.permanent);
    }
    const r = await acquireHull({ url: hullRef.url, repo, handle: h, getRegistry });
    if (!r.ok) return fail(r.error, r.transient !== false);
    if (r.table?.note) warnings.push(`The hull's ${r.table.note}; its statics are built from the mesh.`);
    linked = { status: "ready", mesh: r.mesh, chip: hullPathChip(r), tableSource: r.table?.providerName ?? null };
    chip = linked.chip;
    used.hull = { url: hullRef.url, heads: hullRef.heads ?? headsOf(h), table: r.table?.source ?? null, fingerprint: r.table?.fingerprint ?? null };
  }
  const job = {
    type: "screen",
    doc: design ? JSON.parse(JSON.stringify(design)) : null,
    linked,
    frame: design?.hull.link?.frame ?? { ...DEFAULT_FRAME },
    title: subject.label,
  };
  return { ok: true, job, used, chip, warnings, live };
}
