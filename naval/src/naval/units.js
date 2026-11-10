// Quantities as a designer types and reads them. The doc stores SI only
// (metres, square metres, kilograms, cubic metres, degrees); a unit system is
// a per-viewer display choice. A field accepts any unit of the right
// dimension, whatever the display system: "41 ft", "12.5 m", "35' 6\"",
// "7.06 m²", "10,200 lb", "4.2 t". A bare number is read in the unit the
// field is showing.
//
// Pure: no DOM. Factors are the exact international definitions
// (1 ft = 0.3048 m, 1 in = 0.0254 m, 1 lb = 0.45359237 kg).

export const FT = 0.3048;
export const INCH = 0.0254;
export const LB = 0.45359237;
/** The long ton (2240 lb) the D/L ratio is written in. */
export const LONG_TON = 2240 * LB;
/** Sea water, kg/m³. 64 lb/ft³ (the ft-form SA/D's divisor) is 1025.18 kg/m³. */
export const RHO_SEA = 1025;
export const KNOT = 1852 / 3600;

/** @typedef {"length"|"area"|"mass"|"volume"|"angle"|"ratio"|"percent"|"speed"|"force"|"moment"|"lengthRad"|"massPerLength"} Dim */

/** Pound-force, N (lb × standard gravity). */
export const LBF = LB * 9.80665;
/** @typedef {"metric"|"imperial"} UnitSystem */

// unit token (lower-cased, spaces removed) → [dimension, SI per unit]
const UNITS = {
  m: ["length", 1],
  metre: ["length", 1],
  metres: ["length", 1],
  meter: ["length", 1],
  meters: ["length", 1],
  cm: ["length", 0.01],
  mm: ["length", 0.001],
  ft: ["length", FT],
  foot: ["length", FT],
  feet: ["length", FT],
  "'": ["length", FT],
  in: ["length", INCH],
  inch: ["length", INCH],
  inches: ["length", INCH],
  '"': ["length", INCH],
  "''": ["length", INCH],
  yd: ["length", 0.9144],

  "m²": ["area", 1],
  m2: ["area", 1],
  "m^2": ["area", 1],
  sqm: ["area", 1],
  "ft²": ["area", FT * FT],
  ft2: ["area", FT * FT],
  "ft^2": ["area", FT * FT],
  sqft: ["area", FT * FT],
  "sq.ft": ["area", FT * FT],
  "sq.ft.": ["area", FT * FT],

  kg: ["mass", 1],
  kgs: ["mass", 1],
  t: ["mass", 1000],
  tonne: ["mass", 1000],
  tonnes: ["mass", 1000],
  lb: ["mass", LB],
  lbs: ["mass", LB],
  longton: ["mass", LONG_TON],
  longtons: ["mass", LONG_TON],

  "m³": ["volume", 1],
  m3: ["volume", 1],
  "m^3": ["volume", 1],
  "ft³": ["volume", FT ** 3],
  ft3: ["volume", FT ** 3],
  "ft^3": ["volume", FT ** 3],
  l: ["volume", 0.001],
  litre: ["volume", 0.001],
  litres: ["volume", 0.001],
  liter: ["volume", 0.001],
  liters: ["volume", 0.001],

  "°": ["angle", 1],
  deg: ["angle", 1],
  degree: ["angle", 1],
  degrees: ["angle", 1],
  rad: ["angle", 180 / Math.PI],

  "%": ["percent", 0.01],
  kn: ["speed", KNOT],
  kt: ["speed", KNOT],
  kts: ["speed", KNOT],
  knots: ["speed", KNOT],
  "m/s": ["speed", 1],

  n: ["force", 1],
  lbf: ["force", LBF],
  "kg/m": ["massPerLength", 1],
  "lb/ft": ["massPerLength", LB / FT],
  "n·m": ["moment", 1],
  nm: ["moment", 1],
  "kn·m": ["moment", 1000],
  knm: ["moment", 1000],
  "ft·lbf": ["moment", FT * LBF],
  ftlbf: ["moment", FT * LBF],
  "ft·lb": ["moment", FT * LBF],
};

/** What each dimension is shown in, per system: [label, SI per unit]. */
export const DISPLAY = {
  metric: {
    length: ["m", 1],
    area: ["m²", 1],
    mass: ["kg", 1],
    volume: ["m³", 1],
    angle: ["°", 1],
    ratio: ["", 1],
    percent: ["%", 0.01],
    speed: ["kn", KNOT],
    lengthRad: ["m·rad", 1],
    force: ["kN", 1000],
    moment: ["kN·m", 1000],
    massPerLength: ["kg/m", 1],
  },
  imperial: {
    length: ["ft", FT],
    area: ["ft²", FT * FT],
    mass: ["lb", LB],
    volume: ["ft³", FT ** 3],
    angle: ["°", 1],
    ratio: ["", 1],
    percent: ["%", 0.01],
    speed: ["kn", KNOT],
    lengthRad: ["ft·rad", FT],
    force: ["lbf", LBF],
    moment: ["ft·lbf", FT * LBF],
    massPerLength: ["lb/ft", LB / FT],
  },
};

const NUMBER = String.raw`[-+]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:e[-+]?\d+)?`;
const QTY = new RegExp(String.raw`^(${NUMBER})\s*(.*)$`, "i");
// 35' 6"  ·  35'6  ·  35 ft 6 in
const FEET_INCHES = new RegExp(String.raw`^(${NUMBER})\s*(?:'|ft|feet|foot)\s*(${NUMBER})\s*(?:"|''|in|inch|inches)?$`, "i");

const toNumber = (s) => (s && /\d/.test(s) ? Number(s.replace(/,/g, "")) : NaN);

/**
 * Read a typed quantity into SI.
 * @param {string} text
 * @param {Dim} dim what the field holds
 * @param {UnitSystem} [system] the system the field is displayed in; a bare number is read in it
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
export function parseQuantity(text, dim, system = "metric") {
  const s = String(text ?? "").trim();
  if (!s) return { ok: false, error: "empty" };
  if (dim === "length") {
    const fi = FEET_INCHES.exec(s);
    if (fi) {
      const ft = toNumber(fi[1]);
      const inch = toNumber(fi[2]);
      if (Number.isFinite(ft) && Number.isFinite(inch)) {
        const sign = ft < 0 || Object.is(ft, -0) ? -1 : 1;
        return { ok: true, value: ft * FT + sign * inch * INCH };
      }
    }
  }
  const m = QTY.exec(s);
  const n = m ? toNumber(m[1]) : NaN;
  if (!Number.isFinite(n)) return { ok: false, error: `"${s}" is not a number` };
  const unitText = m[2].trim();
  if (!unitText) return { ok: true, value: n * DISPLAY[system][dim][1] };
  const key = unitText.toLowerCase().replace(/\s+/g, "");
  const unit = UNITS[key] ?? UNITS[unitText];
  if (!unit) return { ok: false, error: `"${unitText}" is not a unit` };
  if (unit[0] !== dim) return { ok: false, error: `"${unitText}" is ${article(unit[0])} ${unit[0]}; this is ${article(dim)} ${dim}` };
  return { ok: true, value: n * unit[1] };
}

const article = (w) => (/^[aeiou]/.test(w) ? "an" : "a");

/** Decimal places for a value shown in a unit: enough to edit with, no more. */
function decimals(dim, shown) {
  const a = Math.abs(shown);
  if (dim === "mass") return a >= 100 ? 0 : 1;
  if (dim === "angle" || dim === "percent" || dim === "speed") return 1;
  if (dim === "ratio") return a >= 100 ? 1 : a >= 10 ? 2 : 3;
  if (a >= 1000) return 0;
  if (a >= 100) return 1;
  if (a >= 1) return 2;
  return 3;
}

/**
 * SI → the number shown in a system, and its label.
 * @param {number} si
 * @param {Dim} dim
 * @param {UnitSystem} system
 */
export function toDisplay(si, dim, system = "metric") {
  const [label, factor] = DISPLAY[system][dim];
  return { value: si / factor, label };
}

/**
 * SI → text, "12.50 m" / "41.00 ft" / "4,200 lb". Non-finite → "—".
 * @param {number|null|undefined} si
 * @param {Dim} dim
 * @param {UnitSystem} [system]
 * @param {{ digits?: number, unit?: boolean }} [opts]
 */
export function formatQuantity(si, dim, system = "metric", opts = {}) {
  if (si == null || !Number.isFinite(si)) return "—";
  const { value, label } = toDisplay(si, dim, system);
  const d = opts.digits ?? decimals(dim, value);
  const text = value.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  if (opts.unit === false || !label) return text;
  return label === "°" || label === "%" ? `${text}${label}` : `${text} ${label}`;
}

/**
 * A quantity inside a sentence (a warning), kept in SI so the reader's unit
 * system can format it: formatText() turns each into "1.23 m" or "4.04 ft".
 * @param {number} si @param {string} dim formatQuantity's @param {number} [digits]
 */
export const qty = (si, dim, digits) => `⟦${dim}:${si}${digits != null ? `:${digits}` : ""}⟧`;

/** A sentence with qty() tokens, in a unit system. */
export const formatText = (text, system = "metric") =>
  String(text).replace(/⟦(\w+):([^:⟧]+)(?::(\d+))?⟧/g, (_, dim, v, d) => formatQuantity(Number(v), dim, system, d != null ? { digits: Number(d) } : {}));
