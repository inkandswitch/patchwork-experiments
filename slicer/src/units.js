// What unit and up axis a model is in, and turning it into print space
// (Z up, millimetres). Pure.
//
// In order of authority:
//   1. a scene render is Y-up metres by contract (scene/README.md, "GLB conventions");
//   2. a GLB that says `asset.extras.units` (the kit encoder writes "m") is in that unit, Y up;
//   3. an STL is in the `stlUnit` setting (default mm), `stlUp` up (default Z);
//   4. a GLB that doesn't say uses the `glbUnit` setting, Y up;
//   5. only when that is "auto": glTF says metres, but a model more than 2 units
//      across can't be a printable thing in metres, so it is read as millimetres.
//      This is the only guess, and it is flagged so the UI can show it.

export const MM_PER = Object.freeze({ mm: 1, cm: 10, m: 1000, in: 25.4 });

export const UNIT_NAMES = Object.freeze({ mm: "millimetres", cm: "centimetres", m: "metres", in: "inches" });

/** Largest axis-aligned extent of a triangle soup (9 floats per triangle), in its own units. */
export function maxExtent(tris) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < tris.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = tris[i + k];
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  let m = 0;
  for (let k = 0; k < 3; k++) if (hi[k] > lo[k]) m = Math.max(m, hi[k] - lo[k]);
  return m;
}

const normUnit = (u) => {
  const s = String(u ?? "").trim().toLowerCase();
  if (s in MM_PER) return s;
  const long = { millimetres: "mm", millimeters: "mm", centimetres: "cm", centimeters: "cm", metres: "m", meters: "m", inch: "in", inches: "in" };
  return long[s] ?? null;
};

/**
 * @param {object} o
 * @param {"render"|"glb"|"stl"} o.kind
 * @param {string|null} [o.fileUnits]  a GLB's asset.extras.units
 * @param {object} o.settings          normalized settings (stlUnit, stlUp, glbUnit)
 * @param {number} [o.extent]          max extent in file units (only read for a guess)
 * @returns {{ unit: "mm"|"cm"|"m"|"in", up: "y"|"z", source: "render"|"file"|"setting"|"guess", guessed: boolean, label: string }}
 */
export function resolveUnits({ kind, fileUnits = null, settings = {}, extent = 0 }) {
  const done = (unit, up, source) => ({ unit, up, source, guessed: source === "guess", label: unitLabel(unit, source) });
  if (kind === "render") return done("m", "y", "render");
  if (kind === "stl") return done(normUnit(settings.stlUnit) ?? "mm", settings.stlUp === "y" ? "y" : "z", "setting");
  const fromFile = normUnit(fileUnits);
  if (fromFile) return done(fromFile, "y", "file");
  const set = normUnit(settings.glbUnit);
  if (set) return done(set, "y", "setting");
  return done(extent > 2 ? "mm" : "m", "y", "guess");
}

export function unitLabel(unit, source) {
  const why = { render: "scene render", file: "from the file", setting: "setting", guess: "guessed from size" }[source] ?? source;
  return `${UNIT_NAMES[unit] ?? unit} (${why})`;
}

/**
 * Model space → print space: Z up, millimetres, times `scale`.
 * Y-up (glTF) maps (x, y, z) → (x, −z, y), keeping it right-handed.
 */
export function toPrintSpace(tris, unit, up = "y", scale = 1) {
  const f = (MM_PER[unit] ?? 1) * (Number.isFinite(scale) && scale > 0 ? scale : 1);
  const out = new Float32Array(tris.length);
  const yUp = String(up).toLowerCase() === "y";
  for (let i = 0; i < tris.length; i += 3) {
    const x = tris[i], y = tris[i + 1], z = tris[i + 2];
    if (yUp) {
      out[i] = x * f;
      out[i + 1] = -z * f;
      out[i + 2] = y * f;
    } else {
      out[i] = x * f;
      out[i + 1] = y * f;
      out[i + 2] = z * f;
    }
  }
  return out;
}

/** The largest scale ≤ 1-ish that fits `sizeMm` (at scale 1) on the bed, with a margin. */
export function fitScale(sizeMm, bed, margin = 0.95) {
  const [x, y, z] = sizeMm;
  const r = Math.min(bed.bedX / (x || 1), bed.bedY / (y || 1), bed.bedZ / (z || 1)) * margin;
  if (!Number.isFinite(r) || r <= 0) return 1;
  // round down to 3 significant digits so the number reads well in the form
  const mag = Math.pow(10, Math.floor(Math.log10(r)) - 2);
  return Number((Math.floor(r / mag) * mag).toPrecision(3));
}
