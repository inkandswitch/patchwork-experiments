// The naval-study doc: which hulls and designs are compared, at which
// versions, and which is the baseline. Nothing derived is stored: every
// figure is recomputed from the subjects' docs at their heads.
//
// {
//   version: 1,
//   title: string,
//   baseline: string | null,          // a subject's id
//   subjects: [{
//     id: string,                      // "s1", "s2", … never reused within a doc
//     label: string,
//     hull: { url, heads: string[] | null } | null,     // heads null: follow the latest
//     design: { url, heads: string[] | null, hullHeads: string[] | null } | null,   // a rig-design doc
//   }],
//   notes: string,
// }
//
// Which hull a subject is screened on (subjects.js resolveSubject), one rule:
// - `hull` given: that hull, whatever the design links (a design can be
//   screened on another hull);
// - `hull` null, with a design: the hull the design links, read from the
//   design every time (its synthetic hull when it links none). The link is
//   never copied here, so re-linking the design is followed.
//
// Pinned or following, the whole subject at once: a subject is pinned when
// every document it reads is at stated heads. For a design-implied hull
// those are `design.hullHeads`: the heads of the hull the design links at
// `design.heads` (a design at fixed heads has a fixed link, so the hull's
// url needs no copy; null when it links none).
//
// Invariants normalizeStudy keeps (so every reader can rely on them):
// - every subject has a hull or a design (or both); one with neither is dropped;
// - a subject is pinned whole or not at all: if any ref it has lacks heads,
//   none keeps them (it follows); `design.hullHeads` is kept only on a
//   pinned design with no `hull` of the subject's own;
// - subject ids are unique (a later duplicate is dropped);
// - the baseline names a subject, or is null when there are none (a
//   dangling baseline falls to the first subject).
// The change helpers below write only through these rules, and never
// assign undefined (automerge refuses it).

export const STUDY_VERSION = 1;
export const STUDY_TYPE = "naval-study";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v, d = "") => (typeof v === "string" ? v : d);

const headsOf = (v) => (Array.isArray(v) && v.length && v.every((h) => typeof h === "string") ? [...v] : null);

function ref(v) {
  if (!isObj(v) || typeof v.url !== "string" || !v.url) return null;
  return { url: v.url, heads: headsOf(v.heads) };
}

export function normalizeSubject(s) {
  if (!isObj(s) || typeof s.id !== "string" || !s.id) return null;
  const hull = ref(s.hull);
  const d = ref(s.design);
  if (!hull && !d) return null;
  const pinned = (!hull || !!hull.heads) && (!d || !!d.heads);
  if (hull && !pinned) hull.heads = null;
  const design = d ? { url: d.url, heads: pinned ? d.heads : null, hullHeads: pinned && !hull ? headsOf(s.design.hullHeads) : null } : null;
  return { id: s.id, label: str(s.label, s.id), hull, design };
}

/** Is a (normalized) subject pinned: every document it reads at stated heads? */
export const isPinned = (s) => !!(s?.design ? s.design.heads : s?.hull?.heads);

/** The doc as every reader sees it. */
export function normalizeStudy(raw) {
  const r = isObj(raw) ? raw : {};
  const seen = new Set();
  const subjects = [];
  for (const s of Array.isArray(r.subjects) ? r.subjects : []) {
    const n = normalizeSubject(s);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    subjects.push(n);
  }
  const baseline = typeof r.baseline === "string" && seen.has(r.baseline) ? r.baseline : (subjects[0]?.id ?? null);
  return { version: STUDY_VERSION, title: str(r.title, "Study"), baseline, subjects, notes: str(r.notes) };
}

export const newStudy = () => normalizeStudy({ title: "Hull study" });

/** The next unused id: one past the largest "s<n>" in the doc (so a removed subject's id is never reused). */
export function nextSubjectId(raw) {
  let max = 0;
  for (const s of Array.isArray(raw?.subjects) ? raw.subjects : []) {
    const m = /^s(\d+)$/.exec(s?.id ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `s${max + 1}`;
}

// ── change helpers: call inside handle.change(d => …)

/** Add a subject; it becomes the baseline if there was none. Returns its id. */
export function addSubject(d, { label, hull = null, design = null }) {
  const id = nextSubjectId(d);
  const s = normalizeSubject({ id, label, hull, design });
  if (!s) throw new Error("a subject needs a hull or a design");
  if (!Array.isArray(d.subjects)) d.subjects = [];
  d.subjects.push(s);
  if (typeof d.baseline !== "string" || !d.subjects.some((x) => x.id === d.baseline)) d.baseline = id;
  return id;
}

export function removeSubject(d, id) {
  const i = (d.subjects ?? []).findIndex((s) => s.id === id);
  if (i < 0) return;
  d.subjects.splice(i, 1);
  if (d.baseline === id) d.baseline = d.subjects[0]?.id ?? null;
}

export function setBaseline(d, id) {
  if ((d.subjects ?? []).some((s) => s.id === id)) d.baseline = id;
}

/**
 * Pin a subject, whole: every document it reads, at the heads given.
 * @param {{ design?: string[]|null, hull?: string[]|null }} heads  the design's, and the hull's it is
 *   screened on (the subject's own, or the one its design links; null only when it has none: a synthetic hull)
 * @returns {boolean} false, and nothing written, when a document the subject names has no heads here
 */
export function pinSubject(d, id, { design = null, hull = null } = {}) {
  const s = (d.subjects ?? []).find((x) => x.id === id);
  if (!s) return false;
  const dh = headsOf(design), hh = headsOf(hull);
  if ((s.design && !dh) || (s.hull && !hh)) return false;
  if (s.design) {
    s.design.heads = dh;
    s.design.hullHeads = s.hull ? null : hh;
  }
  if (s.hull) s.hull.heads = hh;
  return true;
}

/** Follow the latest again: every document the subject reads. */
export function followSubject(d, id) {
  const s = (d.subjects ?? []).find((x) => x.id === id);
  if (!s) return;
  if (s.hull) s.hull.heads = null;
  if (s.design) {
    s.design.heads = null;
    s.design.hullHeads = null;
  }
}
