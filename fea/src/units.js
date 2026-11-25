// Quantities: one value with its unit, as it was given.
//
// A force is `{ value: 2, unit: "kN" }`, never 2000 and never a bare number.
// Nothing stores a quantity converted: SI is computed where the physics needs
// it (`toSI`), and choosing another unit in a form converts the value so the
// quantity stays what it was (`convert`). The analysis itself runs in SI
// throughout (m, N, Pa, kg, s), the scene's metres included, so nothing is
// scaled between a part and its results.

/** Each dimension: its SI unit, what one of each unit is in SI, and the ladder `pretty` picks from. */
export const DIMENSIONS = Object.freeze({
  length: { si: "m", units: { m: 1, cm: 0.01, mm: 1e-3, "µm": 1e-6, in: 0.0254, ft: 0.3048 }, ladder: ["µm", "mm", "m"] },
  area: { si: "m²", units: { "m²": 1, "cm²": 1e-4, "mm²": 1e-6, "in²": 0.00064516 }, ladder: ["mm²", "cm²", "m²"] },
  volume: { si: "m³", units: { "m³": 1, L: 1e-3, "cm³": 1e-6, "mm³": 1e-9, "in³": 0.000016387064 }, ladder: ["mm³", "cm³", "L", "m³"] },
  force: { si: "N", units: { N: 1, kN: 1e3, MN: 1e6, lbf: 4.4482216152605, kgf: 9.80665 }, ladder: ["N", "kN", "MN"] },
  pressure: { si: "Pa", units: { Pa: 1, kPa: 1e3, MPa: 1e6, GPa: 1e9, bar: 1e5, psi: 6894.757293168, ksi: 6894757.293168 }, ladder: ["Pa", "kPa", "MPa", "GPa"] },
  density: { si: "kg/m³", units: { "kg/m³": 1, "g/cm³": 1000, "lb/in³": 27679.904710203 }, ladder: ["kg/m³"] },
  mass: { si: "kg", units: { kg: 1, g: 1e-3, t: 1000, lb: 0.45359237 }, ladder: ["g", "kg", "t"] },
  acceleration: { si: "m/s²", units: { "m/s²": 1, g: 9.80665 }, ladder: ["m/s²"] },
  frequency: { si: "Hz", units: { Hz: 1, kHz: 1e3 }, ladder: ["Hz", "kHz"] },
  energy: { si: "J", units: { J: 1, mJ: 1e-3, kJ: 1e3 }, ladder: ["mJ", "J", "kJ"] },
});

/** Other ways people write a unit. Looked up after an exact match, before a caseless one. */
const ALIASES = Object.freeze({
  um: "µm", "μm": "µm", micron: "µm", microns: "µm", inch: "in", inches: "in", '"': "in", feet: "ft", foot: "ft",
  m2: "m²", cm2: "cm²", mm2: "mm²", in2: "in²", m3: "m³", cm3: "cm³", mm3: "mm³", in3: "in³", l: "L", cc: "cm³",
  lb: "lbf", lbs: "lbf", "N/m2": "Pa", "N/m²": "Pa", "N/mm2": "MPa", "N/mm²": "MPa",
  "kg/m3": "kg/m³", "kg/m^3": "kg/m³", "g/cm3": "g/cm³", "g/cc": "g/cm³", "g/cm^3": "g/cm³", "lb/in3": "lb/in³",
  tonne: "t", tonnes: "t", "m/s2": "m/s²", "m/s^2": "m/s²", G: "g", hz: "Hz",
});

const dim = (name) => {
  const d = DIMENSIONS[name];
  if (!d) throw new Error(`no dimension "${name}"`);
  return d;
};

/** The units of a dimension, for a form's menu. */
export const unitsOf = (dimension) => Object.keys(dim(dimension).units);

/** The unit a piece of text names in this dimension, or null. */
export function unitNamed(text, dimension) {
  const d = dim(dimension);
  const s = String(text ?? "").trim();
  if (s in d.units) return s;
  // "lb" is a mass where a mass is asked for, a force elsewhere
  if (s in ALIASES && ALIASES[s] in d.units) return ALIASES[s];
  // "mN", "mPa": a small m before a capital is milli-, written properly. Not a slip for mega-.
  if (/^m[A-Z]/.test(s)) return null;
  const lower = s.toLowerCase();
  const caseless = Object.keys(d.units).filter((u) => u.toLowerCase() === lower);
  if (caseless.length === 1) return caseless[0];
  const alias = Object.keys(ALIASES).filter((a) => a.toLowerCase() === lower && ALIASES[a] in d.units);
  return alias.length === 1 ? ALIASES[alias[0]] : null;
}

/** Is this a quantity of this dimension: a finite value with one of its units? */
export function isQuantity(q, dimension) {
  return !!q && typeof q === "object" && Number.isFinite(q.value) && typeof q.unit === "string" && q.unit in dim(dimension).units;
}

/** A quantity in SI, or NaN if it isn't one of this dimension. */
export function toSI(q, dimension) {
  return isQuantity(q, dimension) ? q.value * dim(dimension).units[q.unit] : NaN;
}

/** An SI number as a quantity in `unit`. */
export function fromSI(x, unit, dimension) {
  const k = dim(dimension).units[unit];
  if (!k) throw new Error(`${unit} isn't a unit of ${dimension}`);
  return { value: x / k, unit };
}

/** The same quantity in another unit (the value is rounded to 12 digits, so 1 in → 25.4 mm exactly). */
export function convert(q, unit, dimension) {
  if (!isQuantity(q, dimension)) return null;
  if (q.unit === unit) return { value: q.value, unit };
  const out = fromSI(toSI(q, dimension), unit, dimension);
  return { value: Number(out.value.toPrecision(12)), unit };
}

/**
 * A quantity from what a person or another tool gives: `{ value, unit }`, or
 * text ("2 kN", "2.5e3N", "70 GPa"). A bare number is refused: nothing reads
 * a number without its unit.
 * @returns {{ value: number, unit: string } | null}
 */
export function parseQuantity(input, dimension) {
  if (input && typeof input === "object") {
    const unit = unitNamed(input.unit, dimension);
    // (empty text is no number: Number("") is 0)
    const value = typeof input.value === "string" ? (input.value.trim() === "" ? NaN : Number(input.value)) : input.value;
    return unit && Number.isFinite(value) ? { value, unit } : null;
  }
  if (typeof input !== "string") return null;
  const m = input.trim().match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*(.+)$/);
  if (!m) return null;
  const unit = unitNamed(m[2], dimension);
  const value = Number(m[1]);
  return unit && Number.isFinite(value) ? { value, unit } : null;
}

/**
 * A number to `sig` significant digits, without an exponent where a person
 * wouldn't write one (1230, never 1.23e3). It is rounded first and written
 * second, so a number that rounds to 1,000,000 is written as 1,000,000 is.
 */
export function num(x, sig = 3) {
  if (!Number.isFinite(x)) return "–";
  const r = Number(x.toPrecision(sig));
  if (r === 0) return "0";
  const a = Math.abs(r);
  let out;
  if (a >= 1e6 || a < 1e-4) {
    const [m, e] = r.toExponential(sig - 1).split("e");
    out = `${Number(m)}×10${superscript(Number(e))}`;
  } else out = String(r);
  return out.replace(/^-/, "−");
}

const SUPER = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
const superscript = (n) => String(n).replace(/[-\d]/g, (c) => SUPER[c]);

/** "2 kN". */
export function format(q, sig = 4) {
  return q && Number.isFinite(q.value) ? `${num(q.value, sig)} ${q.unit}` : "–";
}

/**
 * An SI number as a quantity people read: the largest unit of the
 * dimension's ladder in which it is at least 1 (0.00012 m is 120 µm,
 * 2.5e8 Pa is 250 MPa). `unit` forces one.
 */
export function pretty(x, dimension, { unit = null, sig = 3 } = {}) {
  if (!Number.isFinite(x)) return "–";
  const d = dim(dimension);
  let u = unit;
  if (!u) {
    u = d.ladder[0];
    for (const c of d.ladder) if (Math.abs(x) >= d.units[c] * 0.9995) u = c;
  }
  return `${num(x / d.units[u], sig)} ${u}`;
}

/** The unit `pretty` would pick for a number of this size: for a legend, or a column of values that should share one. */
export function prettyUnit(x, dimension) {
  const d = dim(dimension);
  let u = d.ladder[0];
  if (Number.isFinite(x)) for (const c of d.ladder) if (Math.abs(x) >= d.units[c] * 0.9995) u = c;
  return u;
}
