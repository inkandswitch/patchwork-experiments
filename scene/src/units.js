// Length units. Everything inside the scene is metres (the GLB convention);
// units only exist at the edges, for display and for numeric entry.

/** metres per unit */
export const UNITS = Object.freeze({ m: 1, cm: 0.01, mm: 0.001, in: 0.0254, ft: 0.3048 });

export const UNIT_OPTIONS = [
  { value: "mm", label: "mm" },
  { value: "cm", label: "cm" },
  { value: "m", label: "m" },
  { value: "in", label: "in" },
  { value: "ft", label: "ft" },
];

export function unitScale(unit) {
  return UNITS[unit] ?? 1;
}

export function toUnits(meters, unit) {
  return meters / unitScale(unit);
}

export function fromUnits(value, unit) {
  return value * unitScale(unit);
}

/** Round to a sensible number of significant digits for display. */
export function roundForDisplay(value, digits = 4) {
  if (!Number.isFinite(value)) return value;
  if (value === 0) return 0;
  const mag = Math.floor(Math.log10(Math.abs(value)));
  const decimals = Math.max(0, Math.min(6, digits - 1 - mag));
  return Number(value.toFixed(decimals));
}

/** "12.5 mm" */
export function formatLength(meters, unit, digits = 4) {
  const v = roundForDisplay(toUnits(meters, unit), digits);
  return `${Number.isFinite(v) ? v : "–"} ${unit in UNITS ? unit : "m"}`;
}

/** The 1-2-5 step ≥ x (x > 0). */
export function niceStep(x) {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const f = x / p;
  const m = f <= 1 + 1e-9 ? 1 : f <= 2 + 1e-9 ? 2 : f <= 5 + 1e-9 ? 5 : 10;
  return m * p;
}

/**
 * Pick a grid for a scene whose largest horizontal half-extent from the origin
 * is `extentMeters`: a step that is a round number in the display unit, and a
 * size that covers the extent with some margin.
 * @returns {{ step: number, size: number, divisions: number, stepInUnits: number }}
 *   step/size in metres
 */
export function gridFor(extentMeters, unit, targetLines = 10) {
  const extent = extentMeters > 0 && Number.isFinite(extentMeters) ? extentMeters : 1;
  const extentU = toUnits(extent, unit);
  const stepInUnits = niceStep((extentU * 2) / targetLines);
  const half = Math.ceil((extentU * 1.2) / stepInUnits) * stepInUnits;
  const divisions = Math.max(2, Math.round((half * 2) / stepInUnits));
  return {
    stepInUnits,
    step: fromUnits(stepInUnits, unit),
    size: fromUnits(stepInUnits * divisions, unit),
    divisions,
  };
}

/** STL / source-file units → metres factor, for provider params. */
export const SOURCE_UNIT_OPTIONS = [
  { value: "mm", label: "Millimetres" },
  { value: "cm", label: "Centimetres" },
  { value: "m", label: "Metres" },
  { value: "in", label: "Inches" },
];
