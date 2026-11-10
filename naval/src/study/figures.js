// The Figure: the only thing the study shows as a number. Pure (no DOM).
//
//   Figure = { value: number|null, unit, method, cite, envelope, provenance, why?, note?, outOfRange? }
//
//   value       SI (a fraction for "percent"); null when the screen can't say, and `why` says why
//   unit        a dimension of naval/units.js DISPLAY ("length", "area", …): the reader's system picks the unit
//   method      what computed it, in a few words
//   cite        where the method comes from (a paper, a standard, a module of this package)
//   envelope    "inside" | "near" | "far": where the inputs sit against the method's fitted range
//   provenance  "given" (stated in a doc) | "measured" (read off the geometry) | "estimated" (an estimate went in)
//   why         (null values only) why the screen can't say
//   note        (numbers only) what else the hover should say: a flag on the point, a caveat
//   outOfRange  [{ label, value, min, max }]: the parameters outside the range, for the hover
//
// Invariants, held by construction:
// - figure() refuses anything that isn't one (an unknown unit, envelope or
//   provenance; a non-finite value; a null without a reason). A worker's
//   result crosses structuredClone as plain data, so isFigure() is the same
//   check, structural, applied again on the main thread.
// - formatFigure() is the only formatter the study's view uses, and it
//   throws on anything that isn't a Figure: a bare number can't be shown,
//   and a figure outside its envelope can't be shown without its badge
//   (the badge is part of what it returns).
// - gradeRange() is the one envelope rule (below), and combining is "worst
//   wins", so a figure is never shown better graded than its worst input.

import { DISPLAY, formatQuantity } from "../naval/units.js";

export const UNITS = Object.freeze(Object.keys(DISPLAY.metric));
export const ENVELOPES = Object.freeze(["inside", "near", "far"]);
export const PROVENANCES = Object.freeze(["given", "measured", "estimated"]);

/**
 * How far past a range is still "near": this fraction of the range's width.
 * DSYHS's own grading (naval/resistance.js envelopeGrade) uses the same half
 * width, and three or more parameters out is "far" there as here.
 */
export const NEAR_FRACTION = 0.5;
export const FAR_COUNT = 3;

const fin = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v) => typeof v === "string";

function problems(x) {
  const out = [];
  if (!x || typeof x !== "object") return ["not an object"];
  if (!(x.value === null || fin(x.value))) out.push(`value ${String(x.value)} is neither a finite number nor null`);
  if (x.value === null && !(str(x.why) && x.why)) out.push("a null value needs a why");
  if (x.value !== null && x.why != null) out.push("a number has a note, not a why");
  if (x.note != null && !str(x.note)) out.push("note must be text");
  if (!UNITS.includes(x.unit)) out.push(`unknown unit ${JSON.stringify(x.unit)}`);
  if (!(str(x.method) && x.method)) out.push("no method");
  if (!str(x.cite)) out.push("no cite");
  if (!ENVELOPES.includes(x.envelope)) out.push(`unknown envelope ${JSON.stringify(x.envelope)}`);
  if (!PROVENANCES.includes(x.provenance)) out.push(`unknown provenance ${JSON.stringify(x.provenance)}`);
  if (x.outOfRange != null && !Array.isArray(x.outOfRange)) out.push("outOfRange must be a list");
  if (x.envelope === "inside" && Array.isArray(x.outOfRange) && x.outOfRange.length) out.push("inside its envelope but with parameters out of range");
  return out;
}

/** Is this a Figure (structurally: every field, every rule)? */
export const isFigure = (x) => problems(x).length === 0;

/**
 * Make a Figure; throws on anything that isn't one.
 * @param {{ value: number|null, unit: string, method: string, cite: string, envelope?: string, provenance: string, why?: string, note?: string, outOfRange?: object[] }} f
 *   why: given with a value that may be missing, it is kept only if the value is (so a call can always pass it)
 */
export function figure({ value, unit, method, cite, envelope = "inside", provenance, why, note, outOfRange }) {
  const f = { value: fin(value) ? value : null, unit, method, cite, envelope, provenance };
  // `why` is the reason a value may be missing: kept only when it is
  if (f.value === null) f.why = why || (value == null ? null : `not a number (${String(value)})`);
  if (note) f.note = String(note);
  if (Array.isArray(outOfRange) && outOfRange.length) f.outOfRange = outOfRange.map((o) => ({ label: String(o.label), value: fin(o.value) ? o.value : null, min: o.min, max: o.max }));
  const p = problems(f);
  if (p.length) throw new TypeError(`not a Figure: ${p.join("; ")}`);
  return Object.freeze(f);
}

/** A Figure that has crossed structuredClone (a worker's result): checked again, frozen. Throws if it isn't one. */
export function reviveFigure(x) {
  const p = problems(x);
  if (p.length) throw new TypeError(`not a Figure: ${p.join("; ")}`);
  return Object.freeze({ ...x });
}

const RANK = { inside: 0, near: 1, far: 2 };
/** The worst of some envelope levels ("inside" for none). */
export const worstEnvelope = (...levels) => levels.flat().reduce((w, l) => (RANK[l] > RANK[w] ? l : w), "inside");

const PRANK = { given: 0, measured: 1, estimated: 2 };
/** A figure computed from inputs: estimated if any input was, else measured if any was, else given. */
export const combineProvenance = (...ps) => ps.flat().reduce((w, p) => (PRANK[p] > PRANK[w] ? p : w), "given");

/**
 * One parameter against a closed range [min, max] (min < max; either end
 * may be infinite, for a one-sided range):
 * inside   min ≤ v ≤ max
 * near     outside by at most NEAR_FRACTION·scale (scale: the range's width;
 *          a one-sided range states its own, e.g. the bound's magnitude)
 * far      further, or not a number (an input the screen can't place is never "inside")
 */
export function gradeRange(value, min, max, scale = max - min) {
  if (!fin(value)) return "far";
  if (value >= min && value <= max) return "inside";
  if (!(scale > 0 && Number.isFinite(scale))) throw new RangeError(`a range [${min}, ${max}] needs a finite positive scale to grade "near"`);
  const past = value < min ? min - value : value - max;
  return past <= NEAR_FRACTION * scale ? "near" : "far";
}

/**
 * Several parameters, each against its range: the worst single grade, and
 * "far" once FAR_COUNT or more are outside at all (each a little out adds up).
 * @param {{ label: string, value: number, min: number, max: number, scale?: number }[]} params
 * @returns {{ envelope: "inside"|"near"|"far", outOfRange: { label, value, min, max }[] }}
 */
export function gradeParams(params) {
  const graded = params.map((p) => ({ ...p, level: gradeRange(p.value, p.min, p.max, p.scale) }));
  const out = graded.filter((g) => g.level !== "inside");
  const level = out.length >= FAR_COUNT ? "far" : worstEnvelope(out.map((g) => g.level));
  return { envelope: level, outOfRange: out.map(({ label, value, min, max }) => ({ label, value, min, max })) };
}

const PROV_MARK = { given: "", measured: "", estimated: "est." };

/**
 * A Figure as text, with its badge and its hover. The study view formats
 * nothing else. Throws on anything that isn't a Figure.
 * @param {object} f a Figure
 * @param {"metric"|"imperial"} [system]
 * @param {{ digits?: number, signed?: boolean }} [opts] signed: a difference (+/−)
 * @returns {{ text: string, badge: "inside"|"near"|"far", provenance: string, mark: string, title: string }}
 */
export function formatFigure(f, system = "metric", opts = {}) {
  const p = problems(f);
  if (p.length) throw new TypeError(`the study formats Figures only (${p.join("; ")})`);
  let text = f.value === null ? "—" : formatQuantity(f.value, f.unit, system, { digits: opts.digits });
  // one minus sign for values and differences alike (a true minus), and none on what rounds to zero
  const digits = /^-?[\d.,]+/.exec(text)?.[0] ?? "";
  const zero = digits !== "" && !/[1-9]/.test(digits);
  text = text.replace(/^-/, zero ? "" : "−");
  if (opts.signed && f.value !== null && f.value > 0 && !zero) text = `+${text}`;
  const lines = [`${f.method}.`, `Source: ${f.cite || "—"}`, `Envelope: ${f.envelope}${f.envelope === "inside" ? "" : " its method's fitted range"}.`, `Provenance: ${f.provenance}.`];
  for (const o of f.outOfRange ?? []) lines.push(`  ${o.label} ${fin(o.value) ? +o.value.toPrecision(4) : "unknown"} (fitted ${o.min}–${o.max})`);
  if (f.why) lines.push(`Not screened: ${f.why}`);
  if (f.note) lines.push(f.note);
  return { text, badge: f.envelope, provenance: f.provenance, mark: PROV_MARK[f.provenance], title: lines.join("\n") };
}

/**
 * A figure less the baseline's (same row, so the same unit: a different unit
 * is a programming error and throws). Graded and sourced as the worse of
 * the two; null-valued, with why, when either can't say.
 */
export function deltaFigure(f, base) {
  if (!isFigure(f) || !isFigure(base)) throw new TypeError("deltaFigure takes two Figures");
  if (f.unit !== base.unit) throw new TypeError(`can't difference ${f.unit} and ${base.unit}`);
  const both = f.value !== null && base.value !== null;
  return figure({
    value: both ? f.value - base.value : null,
    unit: f.unit,
    method: `difference from the baseline (${f.method})`,
    cite: f.cite,
    envelope: worstEnvelope(f.envelope, base.envelope),
    provenance: combineProvenance(f.provenance, base.provenance),
    why: both ? undefined : f.value === null ? `this subject: ${f.why}` : `the baseline: ${base.why}`,
  });
}
