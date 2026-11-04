// Handles: a provider's build parameter that is a position along an axis of
// the object (a flow slice's height, say), shown as something to drag. Pure;
// the viewport draws them and turns the pointer into a value.
//
// A `scene:source` plugin declares them beside its params (worker-safe):
//   handles: [{ param: "height", axis: [0, 1, 0], label?: "Height" }]
// `param` names a number / integer ParamSpec; `axis` is a direction in the
// object's own (GLB) frame. The handle sits on the line through the middle of
// the object's geometry along that axis, at `value` units from where that
// line crosses the origin's plane — so a value of 0.5 on +Y is half a unit up.

const finite3 = (v) => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((x) => Number.isFinite(Number(x)));

/**
 * The handles a provider declares, for the params it has, with their ranges.
 * @param {{ handles?: any[], params?: any[] }} provider  plugin metadata
 * @param {object} params  the render doc's params
 * @returns {{ key, label, axis: number[], value: number, min: number | null, max: number | null, step: number | null, integer: boolean }[]}
 */
export function handleSpecs(provider, params = {}) {
  const out = [];
  for (const h of Array.isArray(provider?.handles) ? provider.handles : []) {
    const spec = (provider.params ?? []).find((p) => p?.key === h?.param);
    if (!spec || (spec.kind !== "number" && spec.kind !== "integer") || !finite3(h.axis)) continue;
    const axis = h.axis.slice(0, 3).map(Number);
    const len = Math.hypot(...axis);
    if (!(len > 0)) continue;
    const v = Number(params?.[spec.key] ?? spec.default);
    out.push({
      key: spec.key,
      label: h.label ?? spec.label ?? spec.key,
      axis: axis.map((x) => x / len),
      value: Number.isFinite(v) ? v : 0,
      min: Number.isFinite(spec.min) ? spec.min : null,
      max: Number.isFinite(spec.max) ? spec.max : null,
      step: Number.isFinite(spec.step) ? spec.step : null,
      integer: spec.kind === "integer",
    });
  }
  return out;
}

/** Where the handle's line starts, in the object's frame: the middle of its geometry, moved along the axis to the origin's plane. */
export function handleBase(center, axis) {
  const d = center[0] * axis[0] + center[1] * axis[1] + center[2] * axis[2];
  return [center[0] - d * axis[0], center[1] - d * axis[1], center[2] - d * axis[2]];
}

/**
 * The parameter along the line base + s·dir nearest the ray origin + t·ray
 * (both in world space): where on the axis the pointer is pointing. null when
 * the ray runs along the line.
 */
export function closestOnLine(base, dir, origin, ray) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const w = [origin[0] - base[0], origin[1] - base[1], origin[2] - base[2]];
  const a = dot(dir, dir);
  const b = dot(dir, ray);
  const c = dot(ray, ray);
  const d = dot(dir, w);
  const e = dot(ray, w);
  const den = a * c - b * b;
  if (Math.abs(den) < 1e-12 * a * c) return null;
  return (c * d - b * e) / den;
}

/** A dragged value, held to the param's range and step. */
export function clampValue(spec, v) {
  let x = v;
  if (spec.min != null) x = Math.max(spec.min, x);
  if (spec.max != null) x = Math.min(spec.max, x);
  if (spec.integer) x = Math.round(x);
  else if (spec.step) x = Math.round(x / spec.step) * spec.step;
  return +x.toPrecision(12);
}
