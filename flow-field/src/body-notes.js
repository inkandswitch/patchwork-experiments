// The build notes' account of a linked body: which model, how fine, and which
// path the section came by (a slice of a scene render, an exact section, or a
// slice of a provider's mesh).
// Pure.

import { normalizeBodySpec, BODY_MODEL_LABELS } from "./body.js";

/**
 * "" when the doc has no body link; otherwise "; body: …".
 * @param {object} field   the compiled flow (field.body when a body applies)
 * @param {object} [result] acquireSection's result, for the path (or the reason there is no body)
 */
export function bodyNote(doc, field, result) {
  const spec = normalizeBodySpec(doc?.body);
  if (!spec) return "";
  const body = field?.body;
  if (!body && result?.pending) return `; ${result.error}, so the flow is drawn without it`;
  if (!body) return `; linked body not applied: ${result && !result.ok ? result.error : "its section isn't available"}`;
  const via = !result?.ok
    ? ""
    : result.path === "render"
      ? `, from a slice of the scene render “${result.providerName}”`
      : result.path === "exact"
        ? `, from the exact section from ${result.providerName}`
        : `, from a mesh slice of ${result.providerName}'s build (default params)`;
  if (body.failed) return `; linked body not applied: ${body.failed}${via}`;
  const at = `z = ${(body.z0 ?? 0).toFixed(2)} m`;
  const warn = (body.info?.warnings ?? []).map((w) => `; ${w}`).join("");
  if (body.empty) return `; linked body: the section has no loops at ${at}${via}, so no body${warn}`;
  const label = BODY_MODEL_LABELS[body.model] ?? body.model;
  const size =
    body.model === "waterplane-2d" ? `${body.info.panels} source panels` : `${body.info.segments} line-source segments`;
  const dead = (body.info.closures ?? []).some((c) => c?.aft?.deadWater || c?.fore?.deadWater) ? ", transom closed with dead water" : "";
  return `; body: ${label}, ${size} on ${body.info.loops} loop${body.info.loops === 1 ? "" : "s"} at ${at}${via}${dead}${warn}`;
}
