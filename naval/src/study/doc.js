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
//     design: { url, heads: string[] | null } | null,   // a rig-design doc
//   }],
//   notes: string,
// }
//
// Invariants normalizeStudy keeps (so every reader can rely on them):
// - every subject has a hull or a design (or both); one with neither is dropped;
// - subject ids are unique (a later duplicate is dropped);
// - the baseline names a subject, or is null when there are none (a
//   dangling baseline falls to the first subject).
// The change helpers below write only through these rules, and never
// assign undefined (automerge refuses it).

export const STUDY_VERSION = 1;
export const STUDY_TYPE = "naval-study";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v, d = "") => (typeof v === "string" ? v : d);

function ref(v) {
  if (!isObj(v) || typeof v.url !== "string" || !v.url) return null;
  const heads = Array.isArray(v.heads) && v.heads.length && v.heads.every((h) => typeof h === "string") ? [...v.heads] : null;
  return { url: v.url, heads };
}

export function normalizeSubject(s) {
  if (!isObj(s) || typeof s.id !== "string" || !s.id) return null;
  const hull = ref(s.hull);
  const design = ref(s.design);
  if (!hull && !design) return null;
  return { id: s.id, label: str(s.label, s.id), hull, design };
}

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

export function setLabel(d, id, label) {
  const s = (d.subjects ?? []).find((x) => x.id === id);
  if (s) s.label = String(label);
}

/** Pin a subject's hull or design to heads (an array), or follow the latest again (null). */
export function setHeads(d, id, which, heads) {
  const s = (d.subjects ?? []).find((x) => x.id === id);
  if (!s || !s[which]) return;
  s[which].heads = Array.isArray(heads) && heads.length ? heads.map(String) : null;
}
