// Chartroom from the hull's own package: `chartroom:source` plugins in the
// host's registry, looked up by the hull doc's datatype at runtime. Main
// thread only (it uses the registry, late-bound). Nothing here imports a
// provider's package: when none is installed, or each fails, or no table
// checks out, the caller keeps the mesh path (rig-build.js builds a table
// from the floated mesh) and says why.
//
// Any number of providers may offer a table for a datatype (camber's own
// package for camber-hull docs; a second analysis package; one that offers
// it for every datatype). None is "the" provider: THE RULE below says which
// table is read, as a function of the set of providers alone, and the
// result lists what every candidate did.
//
// A plugin (camber/patchwork registers one for camber-hull docs):
//
//   { type: "chartroom:source", id, supportedDatatypes: [...] | "*",
//     formats: ["hydrostatic-table/1", "marine-geometry/1"], version: 1,
//     load: () => import(...) }
//
// `formats` is required: a provider offers only what it lists. Its module:
//
//   { fingerprint(doc) → string,
//     hydrostaticTable(doc, opts) → a Chartroom hydrostatic-table v1 (or a promise of one),
//     marineGeometry(doc, opts) → a Chartroom marine-geometry v1 (or a promise of one) }
//
// The table is in metres in the producer's own frame (x forward, y port,
// z up). It is the hull's statics engine (naval/hull-form.js floatHull):
// every upright figure it carries is read from it, and the mesh gives only
// what a table has no field for. Its frame is the mesh's when the GLB names
// the same hull (sameHull: the GLB's fingerprint ends in the one
// fingerprint(doc) gives here); otherwise it is slid onto the mesh by its
// LCB, so its origin doesn't matter. It is validated (validateTable) before
// anything reads it: a reading outside its coverage is unavailable, never
// extrapolated.

import { loadGetRegistry } from "./registry.js";
import { validateTable, DEFAULT_HEELS } from "../naval/statics.js";

export const CHARTROOM_SOURCE = "chartroom:source";
export const TABLE_FORMAT = "hydrostatic-table/1";

/**
 * What is asked of a producer: heels 0–180° (the rig aid's own, so
 * large-angle stability reaches past AVS) and 32 immersion steps per
 * attitude. Trims are the producer's choice (its design trim among them),
 * and so is the hull's resolution: the table is the hull's statics engine
 * (naval/hull-form.js), so its upright figures must be the ones the hull's
 * own tool shows. Measured on camber's kinked example at 12 m: at camber's
 * own default (240 sections × 10 girth steps) ∇ is 23.103 m³, exactly its
 * editor's hydrostatics(); at the 96 × 6 this used to ask for, 22.905 m³
 * (−0.9%), and 23.184 m³ at 480 × 20. The default costs ~0.3 s here, once
 * per read of the hull, against ~0.1 s at 96 × 6. That time is spent on the
 * thread that asks, which in the Rig tool and the study is the main thread:
 * the provider's module comes from the host's registry, which this
 * package's worker can't reach, and camber's hydrostaticTable() is
 * synchronous. A provider that returns a promise from its own worker
 * (allowed above) would take it off; nothing here can.
 * The keys are camber's HydrostaticExportOptions; a producer ignores what
 * it doesn't know.
 */
export const TABLE_OPTIONS = Object.freeze({ heelDeg: DEFAULT_HEELS, immersionSteps: 32 });

function list(registry) {
  try {
    return registry?.filter?.(() => true) ?? [];
  } catch {
    return [];
  }
}

/**
 * How a provider claims a datatype: "exact" (it names it), "wildcard"
 * (`supportedDatatypes` is "*" or holds "*"), or null (it doesn't).
 */
export function claimOf(p, datatype) {
  const sd = p?.supportedDatatypes;
  if (datatype != null && Array.isArray(sd) && sd.includes(datatype)) return "exact";
  if (sd === "*" || (Array.isArray(sd) && sd.includes("*"))) return "wildcard";
  return null;
}

/** Does a provider offer a format? Only by saying so: `formats` must list it. */
export const offers = (p, format) => Array.isArray(p?.formats) && p.formats.includes(format);

/**
 * THE RULE: which of several providers' tables a hull reads. No provider is
 * "the" provider, and registration order never decides anything.
 *
 * 1. Candidates: every `chartroom:source` with an id that lists the format
 *    in its `formats` and claims the datatype, by name or by wildcard.
 * 2. Each candidate is asked its `fingerprint(doc)` (cheap) first. One whose
 *    fingerprint names another hull than the mesh's (hull-link.js sameHull
 *    "different") is refused before its table is computed.
 * 3. The rest are ranked: a provider that names the datatype before a
 *    wildcard one (the hull's own package knows its own documents best);
 *    then one whose fingerprint matches the mesh's ("same": its table is in
 *    the mesh's frame) before one that can't say ("unknown": slid onto the
 *    mesh by its LCB); then by id, in code-point order, which is arbitrary
 *    but the same on every peer whatever order the plugins loaded in.
 * 4. Tables are computed in that order; the first that validates is read.
 *    Every candidate's outcome is reported (`offers`), so a reader sees what
 *    was available and why it wasn't read.
 *
 * Ranks are a total order on (claim, fingerprint verdict, id), so the result
 * is a function of the set of providers alone.
 */
export const RULE =
  "every chartroom:source offering the table for this datatype is a candidate; one whose fingerprint names another hull is refused; the rest are tried in order: the datatype named before a wildcard, the mesh's own fingerprint before none, then by id; the first table that checks out is read";

const CLAIM_RANK = { exact: 0, wildcard: 1 };
const PRINT_RANK = { same: 0, unknown: 1 };

/** Compare two ranked candidates ({ claim, verdict, id }): negative when a goes first. */
export function rankCompare(a, b) {
  return CLAIM_RANK[a.claim] - CLAIM_RANK[b.claim] || PRINT_RANK[a.verdict] - PRINT_RANK[b.verdict] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The chartroom:source plugins for a datatype that offer a format (step 1),
 * each with its claim, in id order (the fingerprints, which finish the
 * ranking, need the providers' modules).
 */
export function chartroomProviders(providers, datatype, format = TABLE_FORMAT) {
  const seen = new Set();
  const out = [];
  for (const p of providers ?? []) {
    if (!p || typeof p.id !== "string" || !p.id || seen.has(p.id)) continue;
    const claim = claimOf(p, datatype);
    if (!claim || !offers(p, format)) continue;
    seen.add(p.id);
    out.push({ p, id: p.id, claim });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Do a GLB's fingerprint and a table's describe the same hull? The two write
 * the same hash differently: the GLB's is its scene provider's
 * ("<provider>/<build version>:<hash>"), the chartroom module's is the bare
 * "<hash>" that one ends in. So: equal, or the GLB's ends in ":<hash>".
 * @returns {"same"|"different"|"unknown"} unknown: one of them states none
 */
export function sameHull(glbPrint, tablePrint) {
  if (typeof glbPrint !== "string" || !glbPrint || typeof tablePrint !== "string" || !tablePrint) return "unknown";
  return glbPrint === tablePrint || glbPrint.endsWith(`:${tablePrint}`) ? "same" : "different";
}

const errorText = (v) => `its table doesn't check out: ${v.errors.slice(0, 3).map((e) => e.message).join("; ")}${v.errors.length > 3 ? ` (and ${v.errors.length - 3} more)` : ""}`;

/**
 * The hull's own hydrostatic table, by THE RULE above.
 * @param {{ doc: object, datatype: string|null, meshFingerprint?: string|null, getRegistry?: Function, options?: object }} o
 *   meshFingerprint: what the hull's GLB states (hull-link.js glbFingerprint), or null
 * @returns {Promise<{ ok: true, table: object, fingerprint: string|null, verdict: "same"|"unknown", providerId: string, providerName: string, offers: object[] }
 *                  | { ok: false, absent: boolean, why: string, offers: object[] }>}
 *   absent: no provider offers a table for this datatype (the ordinary case
 *   for anything but a camber hull); otherwise one did, and `why` says what
 *   went wrong with each. offers: every candidate in rank order (refused
 *   ones last), each { id, name, claim, fingerprint, verdict, outcome:
 *   "read" | "not asked" (one before it was read) | "refused" (another hull) | "failed", why? }.
 */
export async function chartroomTableFor({ doc, datatype, meshFingerprint = null, getRegistry, options = TABLE_OPTIONS } = {}) {
  const get = getRegistry ?? (await loadGetRegistry());
  if (!get) return { ok: false, absent: true, why: "no plugin registry", offers: [] };
  let reg = null;
  try {
    reg = get(CHARTROOM_SOURCE);
  } catch {
    reg = null;
  }
  const found = chartroomProviders(list(reg), datatype);
  if (!found.length) return { ok: false, absent: true, why: `no ${CHARTROOM_SOURCE} offers ${TABLE_FORMAT} for “${datatype}” documents`, offers: [] };

  // step 2: every candidate's module and fingerprint, before any table
  const cands = [];
  for (const c of found) {
    const name = c.p.name ?? c.id;
    let mod = null, fingerprint = null, failed = null;
    try {
      mod = (await reg.load?.(c.id))?.module ?? null;
      if (typeof mod?.hydrostaticTable !== "function") failed = "it has no hydrostaticTable()";
    } catch (err) {
      failed = `it didn't load (${err?.message ?? err})`;
    }
    if (typeof mod?.fingerprint === "function") {
      try {
        const f = mod.fingerprint(doc);
        fingerprint = typeof f === "string" && f ? f : null;
      } catch {
        fingerprint = null;
      }
    }
    const verdict = sameHull(meshFingerprint, fingerprint);
    cands.push({ ...c, name, mod, fingerprint, verdict, failed });
  }
  const offersOut = [];
  const report = (c, outcome, why) => offersOut.push({ id: c.id, name: c.name, claim: c.claim, fingerprint: c.fingerprint, verdict: c.verdict, outcome, ...(why ? { why } : {}) });
  const refused = cands.filter((c) => c.verdict === "different");
  const ranked = cands.filter((c) => c.verdict !== "different").sort(rankCompare);

  // step 4: tables in rank order, the first that checks out is read
  let read = null;
  for (const c of ranked) {
    if (read) {
      report(c, "not asked");
      continue;
    }
    if (c.failed) {
      report(c, "failed", c.failed);
      continue;
    }
    try {
      const table = await c.mod.hydrostaticTable(doc, { ...options });
      const v = validateTable(table);
      if (!v.ok) throw new Error(errorText(v));
      read = { c, table };
      report(c, "read");
    } catch (err) {
      report(c, "failed", String(err?.message ?? err));
    }
  }
  for (const c of refused) report(c, "refused", `its table is for another hull than the GLB's (fingerprint ${c.fingerprint}, the GLB's ${meshFingerprint})`);
  if (read) return { ok: true, table: read.table, fingerprint: read.c.fingerprint, verdict: read.c.verdict, providerId: read.c.id, providerName: read.c.name, offers: offersOut };
  return { ok: false, absent: false, why: offersOut.map((o) => `${o.name}: ${o.why}`).join("; "), offers: offersOut };
}
