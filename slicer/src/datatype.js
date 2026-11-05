// The slice-job datatype. Same id as bambu-slicer's, so its documents open
// here; they are migrated on read (normalizeJob), never rewritten wholesale.
//
// @typedef {{
//   "@patchwork": { type: "slice-job" },
//   title: string,
//   source: AutomergeUrl | null,          // a scene-render doc, or a GLB/STL file doc
//   settings: { [key]: value },           // see settings-spec.js; missing keys = defaults
//   auto: boolean,                        // re-slice by itself when the source or settings change
//   gcodeUrl: AutomergeUrl | null,        // the current G-code file doc
//   builtFrom: { sourceKey, settingsKey, sourceUrl, sourceHeads, gcodeHash } | null,
//   builtAt: number | null,
//   status: "idle" | "slicing" | "error",
//   error: string | null,
//   errorFrom: { sourceKey, settingsKey } | null,   // what the failed slice was of (no auto-retry on the same inputs)
//   stats: { layers, timeSeconds, filamentMm, grams, lines, sizeMm, triangles, openEdges, unit, unitSource, scale } | null,
//   createdAt: string,
// }} SliceJob

import { DEFAULT_SETTINGS, normalizeSettings } from "./settings.js";

export const JOB_TYPE = "slice-job";

/** A fresh slice-job doc (for repo.create2). */
export function newJobDoc({ title, source = null, settings = {}, auto = true, now = () => new Date().toISOString() } = {}) {
  return {
    "@patchwork": { type: JOB_TYPE },
    title: title || "Slice job",
    source: source ?? null,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    auto: !!auto,
    gcodeUrl: null,
    builtFrom: null,
    builtAt: null,
    status: "idle",
    error: null,
    errorFrom: null,
    stats: null,
    createdAt: now(),
  };
}

const isUrl = (s) => typeof s === "string" && /^automerge:[1-9A-HJ-NP-Za-km-z]{20,60}/.test(s.trim());

/**
 * A slice job as the tool reads it: every field present, old bambu-slicer
 * fields mapped (`modelUrl` → `source` when `source` is absent, top-level
 * `printer` → `settings.printer`, `printSpeed` → `settings.wallSpeed`), and
 * settings filled and clamped. Pure: never writes.
 */
export function normalizeJob(doc) {
  const d = doc ?? {};
  let source = null;
  let migratedSource = false;
  if (d.source !== undefined && d.source !== null) source = isUrl(d.source) ? d.source.trim() : null;
  else if (isUrl(d.modelUrl)) {
    source = d.modelUrl.trim();
    migratedSource = true;
  }
  return {
    title: typeof d.title === "string" && d.title ? d.title : "Slice job",
    source,
    migratedSource,
    settings: normalizeSettings(d.settings, d),
    auto: d.auto === undefined ? true : !!d.auto,
    gcodeUrl: isUrl(d.gcodeUrl) ? d.gcodeUrl : null,
    builtFrom: d.builtFrom && typeof d.builtFrom === "object" ? d.builtFrom : null,
    builtAt: typeof d.builtAt === "number" ? d.builtAt : null,
    status: d.status === "slicing" || d.status === "error" ? d.status : "idle",
    error: typeof d.error === "string" ? d.error : null,
    errorFrom: d.errorFrom && typeof d.errorFrom === "object" ? d.errorFrom : null,
    stats: d.stats && typeof d.stats === "object" ? d.stats : null,
  };
}

export const SliceJobDatatype = {
  init(doc) {
    const seed = newJobDoc();
    for (const [k, v] of Object.entries(seed)) if (k !== "@patchwork") doc[k] = v;
  },
  getTitle(doc) {
    return doc?.title || "Slice job";
  },
  setTitle(doc, title) {
    doc.title = title;
  },
  markCopy(doc) {
    doc.title = `Copy of ${doc.title || "slice job"}`;
  },
};

export default SliceJobDatatype;
