// The two scene providers' build params: one table, read by the plugin
// metadata (index.js) and by the builds (streamlineParams, sliceParams), so
// the form, the host's clamping and the code can't disagree. No imports: the
// worker-evaluated entry imports this, and every spec must survive
// structuredClone.
//
// cost: "cheap" for a param that only recolours or re-seeds a few lines,
// "expensive" for one that changes how much work a build does.

export const COLOR_BY = [
  { value: "speed", label: "Speed" },
  { value: "cp", label: "Pressure coefficient (Cp)" },
];
export const BODY_MODEL = [
  { value: "doc", label: "As the flow document says" },
  { value: "waterplane-2d", label: "Waterplane (2D panels)" },
  { value: "slender-body-3d", label: "Slender body (3D line sources)" },
];
export const COLORMAP = [
  { value: "auto", label: "Auto (viridis for speed, cool–warm for Cp)" },
  { value: "viridis", label: "Viridis" },
  { value: "coolwarm", label: "Cool–warm" },
  { value: "turbo", label: "Turbo" },
];

export const STREAMLINE_PARAMS = [
  { key: "seedCount", label: "Seeds per row (0 = document's)", kind: "integer", default: 0, min: 0, max: 40, step: 1, cost: "cheap" },
  { key: "rakeRows", label: "Rake rows", kind: "integer", default: 3, min: 1, max: 8, step: 1, cost: "cheap" },
  { key: "seedHeight", label: "Seed height (m)", kind: "number", default: 0, min: -10, max: 10, step: 0.1, cost: "cheap" },
  { key: "rowSpacing", label: "Row spacing (m, downward)", kind: "number", default: 0.6, min: -5, max: 5, step: 0.05, cost: "cheap" },
  { key: "step", label: "Step (m)", kind: "number", default: 0.1, min: 0.01, max: 1, step: 0.01, log: true, cost: "expensive" },
  { key: "maxSteps", label: "Max steps", kind: "integer", default: 600, min: 10, max: 5000, step: 10, cost: "expensive" },
  { key: "colorBy", label: "Colour by", kind: "enum", default: "speed", options: COLOR_BY, cost: "cheap" },
  { key: "colormap", label: "Colormap", kind: "enum", default: "auto", options: COLORMAP, cost: "cheap" },
  { key: "autoRange", label: "Auto colour range", kind: "boolean", default: true, cost: "cheap" },
  { key: "colorMin", label: "Colour min", kind: "number", default: 0, step: 0.05, cost: "cheap" },
  { key: "colorMax", label: "Colour max", kind: "number", default: 3, step: 0.05, cost: "cheap" },
  { key: "tubes", label: "Stream tubes", kind: "boolean", default: true, cost: "cheap" },
  { key: "tubeRadius", label: "Tube radius (m)", kind: "number", default: 0.05, min: 0.005, max: 0.5, step: 0.005, log: true, cost: "cheap" },
  { key: "hugLines", label: "Lines past a linked body (per side)", kind: "integer", default: 3, min: 0, max: 8, step: 1, cost: "cheap" },
  { key: "bodyModel", label: "Linked body model", kind: "enum", default: "doc", options: BODY_MODEL, cost: "cheap" },
];

export const SLICE_PARAMS = [
  { key: "height", label: "Height (m)", kind: "number", default: 0, min: -10, max: 10, step: 0.05, cost: "cheap" },
  { key: "resolution", label: "Resolution (cells)", kind: "integer", default: 110, min: 8, max: 160, step: 1, cost: "expensive" },
  { key: "colorBy", label: "Colour by", kind: "enum", default: "cp", options: COLOR_BY, cost: "cheap" },
  { key: "colormap", label: "Colormap", kind: "enum", default: "auto", options: COLORMAP, cost: "cheap" },
  { key: "mask", label: "Mask body interiors", kind: "boolean", default: true, cost: "expensive" },
  { key: "autoRange", label: "Auto colour range", kind: "boolean", default: true, cost: "cheap" },
  { key: "colorMin", label: "Colour min", kind: "number", default: -1, step: 0.05, cost: "cheap" },
  { key: "colorMax", label: "Colour max", kind: "number", default: 1, step: 0.05, cost: "cheap" },
  { key: "fade", label: "Fade undisturbed flow", kind: "number", default: 0, min: 0, max: 1, step: 0.05, cost: "cheap" },
  { key: "bodyModel", label: "Linked body model", kind: "enum", default: "doc", options: BODY_MODEL, cost: "cheap" },
];

/** Every spec's default. */
export function paramDefaults(specs) {
  const out = {};
  for (const s of specs) out[s.key] = s.default;
  return out;
}

/** One spec by key. */
export function paramSpec(specs, key) {
  return specs.find((s) => s.key === key);
}

/**
 * The same coercion the scene host applies before build() (scene/src/staleness.js,
 * effectiveParams): defaults filled in, numbers clamped to min/max, integers
 * rounded, enums checked against their options; a value that can't be coerced
 * becomes the default. Repeated here so a build called directly (a test, the
 * editor) gets what the host would hand it. Keys without a spec are dropped.
 */
export function coerceParams(specs, params = {}) {
  const out = {};
  for (const s of specs) {
    const raw = params?.[s.key];
    let v = null;
    if (raw !== undefined) {
      if (s.kind === "number" || s.kind === "integer") {
        let n = raw === null || raw === "" ? NaN : Number(raw);
        if (Number.isFinite(n)) {
          if (s.kind === "integer") n = Math.round(n);
          if (Number.isFinite(s.min)) n = Math.max(s.min, n);
          if (Number.isFinite(s.max)) n = Math.min(s.max, n);
          v = n;
        }
      } else if (s.kind === "boolean") v = !!raw;
      else if (s.kind === "enum") v = s.options.find((o) => String(o.value) === String(raw))?.value ?? null;
      else v = raw;
    }
    out[s.key] = v ?? s.default;
  }
  return out;
}
