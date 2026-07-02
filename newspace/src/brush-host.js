// The formalized `sketchy:brush` IMPERATIVE contract.
//
// A brush MODULE is { id, name, icon, schema?, params?, stroke?, behavior?, use? }.
// The imperative contract is:
//
//   use(host) -> { down(ctx), move(ctx), up(ctx), cursor? }
//
// where `host` (the BrushHost) is a STABLE object the canvas builds once, exposing exactly
// what a brush needs — the live context Sources, coordinate transforms, the layout (read
// items + emit ops), the ephemeral overlay, resolved params, and snap geometry — and `ctx`
// is the per-phase gesture context (host fields + p/start/event/state/pressure).
//
// This is a SUPERSET of the legacy `behavior = {down,move,up}` hook (adapted automatically),
// and the seed for pulling pen/shapes/eraser/text/wire out of the host into real brushes.
//
// Three shapes a brush can take, resolved here:
//   • use(host)  — the new imperative contract            → its handlers
//   • behavior   — the legacy imperative hook             → adapted as-is
//   • neither    — a passive STROKE brush (just `stroke`) → null; the host strokes for it
//     (the built-in pen handlers in pen-brush.js)
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { log } from "./log.js";

// The registered brush plugins, deduped by id. Canonical registry: `sketchy:brush`.
// The legacy `newspace:` lookup is a one-release deprecation fallback for external
// registrants (optimization-plan-3 Phase 1) — delete it next release.
export function listRegistryBrushes() {
  const all = [], seen = new Set();
  const take = (name) => {
    const found = [];
    try {
      const r = getRegistry(name);
      const list = r ? (typeof r.filter === "function" ? r.filter(() => true) : Array.isArray(r) ? r : []) : [];
      for (const b of list) if (b && b.id && !seen.has(b.id)) { seen.add(b.id); all.push(b); found.push(b); }
    } catch {}
    return found;
  };
  take("sketchy:brush");
  const legacy = take("newspace:brush");
  if (legacy.length) log.warn(`deprecated newspace:brush registration (${legacy.map((b) => b.id).join(", ")}) — register as sketchy:brush`);
  return all;
}

// Resolve a brush module's gesture handlers given the stable host. Returns null for a
// passive stroke brush (the caller falls back to the built-in pen).
export function resolveBrushHandlers(mod, host) {
  if (!mod) return null;
  if (typeof mod.use === "function") return mod.use(host) || null;
  if (mod.behavior) return mod.behavior;
  return null;
}

// Does this brush OWN its gesture (imperative), vs. being a passive stroke the host draws?
export function brushIsImperative(mod) {
  return !!(mod && (typeof mod.use === "function" || mod.behavior));
}

// Param ROWS for any descriptor that declares params — a brush OR a node/surface. From its
// REAL schema (`paramsSchema(...).fields`) when present, else its explicit `params` array.
// One accessor so neither the brush panel nor `paramsAsInlets` ever has to branch.
export function paramDefs(descriptor) {
  if (!descriptor) return [];
  const s = descriptor.schema;
  if (s && Array.isArray(s.fields)) return s.fields;
  return descriptor.params || [];
}
export const brushParamDefs = paramDefs; // brush-side alias (same logic)

// A param's DEFAULT value declared by the brush: schema default → legacy `stroke[key]` →
// undefined. (The live resolved value layers the per-viewer edited config on top of this.)
export function brushParamDefault(mod, key) {
  if (!mod) return undefined;
  const d = mod.schema && mod.schema.defaults;
  if (d && key in d) return d[key];
  if (mod.stroke && key in mod.stroke) return mod.stroke[key];
  return undefined;
}
