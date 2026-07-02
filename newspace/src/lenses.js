// sketchy:lens — a node that SITS ON A WIRE: one inlet stream in, one derived
// stream out. It's the editor lens made placeable — `number → (number→string) →
// codemirror`. A lens is just `transform(source, spec)` (opstreams.js): the
// complement passes through, and the output is read-only (no `apply`) unless the
// lens supplies a write-back, exactly like a stream pinned at heads.
//
// In optics terms: `project` alone is a GETTER (read-only — look, don't set);
// `project` + `unproject` is a LENS (get AND set, bidirectional). Composing our
// optic with a READ-ONLY source collapses a Lens down to a Getter — which is why
// `applyLens` drops `apply` when the source has none. "Read-only is doing an optic":
// it's just projecting down the Lens→Getter hierarchy, surfaced by feature-detecting
// the absence of `apply`.
//
// A lens descriptor (registered in `plugins`, type "sketchy:lens") is:
//   { type:"sketchy:lens", id, name, icon,
//     inlet:  { name, type, schema? },     // accepts: one stream
//     outlet: { name, type, schema? },     // provides: one derived stream
//     project(value) -> derivedValue,      // forward (the GETTER half)
//     unproject(derived, src) -> srcValue, // backward (the SETTER half ⇒ a LENS)
//     map?, apply?, schema? }              // (optional) finer transform spec
//
// `project` is the common case (a pure value cast). For richer lenses pass a full
// transform `spec` via `map`/`apply`. We normalise the descriptor to carry
// `inlets`/`outlets` ARRAYS too, so the wire matcher (firstMatchingInlet, the
// unwired placeholder) treats a lens exactly like an editor.
import { getRegistry } from "@inkandswitch/patchwork-plugins";
import { transform, apply as applyOp } from "./opstreams.js";
import { snapshot, isSnapshot, valuesEqual, anySchema, set } from "./ops.js";
import { toPretty, fromPretty } from "./json-pretty-lens.js";

// ── SKIP: "don't write this source" ──────────────────────────────────────────
// A backward write can DECLINE: an `unproject` (or a fan-in slot, see
// combine-node.js) that yields SKIP leaves its source untouched. `unproject`
// returning `undefined` has always half-meant this; SKIP is the explicit,
// nameable whole — you can put it IN a value (a fan-in slot) where `undefined`
// would just mean "absent".
//
// SKIP is a TAGGED OBJECT, not a symbol: write-backs travel as op
// VALUES, and ops cross MessagePorts as plain JSON / structured clones
// (port-opstream.js) — a symbol dies at that boundary, a tagged object survives.
// Identity is lost in transit, so `isSkip` checks the tag, never `===`.
export const SKIP = Object.freeze({ "sketchy:skip": true });
export const isSkip = (v) => !!v && typeof v === "object" && v["sketchy:skip"] === true;

// registered lens descriptors (defensive: no host registry ⇒ [])
export function listLenses() {
  try {
    const r = getRegistry("sketchy:lens");
    if (!r) return [];
    if (typeof r.filter === "function") return r.filter(() => true);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

// editor-shaped view of a lens descriptor (so EditorItem / the wire matcher can
// treat lenses and editors uniformly: one required inlet, one outlet).
export function lensDescriptor(d) {
  if (!d) return d;
  const inlet = d.inlet || { name: "in", type: "json" };
  const outlet = d.outlet || { name: "out", type: "json" };
  return {
    ...d,
    lens: true,
    inlets: d.inlets || [{ ...inlet, required: inlet.required !== false }],
    outlets: d.outlets || [outlet],
  };
}

// every lens, normalised to the editor-shaped descriptor
export function listLensDescriptors() {
  return listLenses().map(lensDescriptor);
}

// the transform spec a lens applies to its inlet stream. A lens is BIDIRECTIONAL
// when it can write edits back: either an explicit `apply`, or — the easy case —
// an `unproject(viewValue, sourceValue) -> sourceValue` inverse, from which we
// derive `apply` (recompute the edited view value, invert it, write the source).
export function lensSpec(d) {
  const project = d.project || ((v) => v);
  const spec = {
    value: project,
    map: d.map,
    apply: d.apply,
    schema: d.schema || (d.outlet && d.outlet.schema),
    complement: d.complement,
  };
  if (!spec.apply && d.unproject) {
    spec.apply = (op, source) => {
      const cur = project(source.value);
      const next = isSnapshot(op) ? op.value : applyOp(cur, op); // the edited view value
      const back = d.unproject(next, source.value);
      // DECLINED: SKIP (or undefined, the historical half of it) ⇒ don't write this source
      if (back === undefined || isSkip(back)) return;
      // idempotent: skip a write that wouldn't change the source (breaks feedback loops)
      if (typeof source.apply === "function" && !valuesEqual(back, source.value)) source.apply(snapshot(back));
    };
  }
  return spec;
}

// apply a lens to an inlet opstream → its derived outlet opstream. Bidirectionality
// is feature-detected: a write-back lens over a READ-ONLY source (no `apply`) is
// itself read-only — we drop the apply so a downstream editor presents read-only,
// rather than silently dropping edits.
export function applyLens(descriptor, source) {
  if (!source) return null;
  const spec = lensSpec(descriptor);
  if (spec.apply && typeof source.apply !== "function") spec.apply = undefined;
  return transform(source, spec);
}

// ── map-over-list: lift an ELEMENT lens over a LIST ──────────────────────────
// `mapLens(inner, meta)` composes a lens that applies `inner` to each element of
// a list. READ: project element-wise (a non-list projects to []). WRITE
// (index-aligned, like recase):
//   • same length — only elements whose view CHANGED are unprojected, each
//     written as a targeted `{range: i}` assign back to element i (untouched
//     elements are never rewritten). An element whose unproject declines
//     (undefined / SKIP) leaves its source element untouched.
//   • length changed (insert/delete) — the source list is REBUILT index-aligned
//     and written as ONE whole-list snapshot: surviving indices unproject against
//     their old element (declined ⇒ the old element is kept), APPENDED elements
//     unproject against undefined (declined ⇒ dropped — an element the lens can't
//     invert can't be inserted), and a shorter view TRUNCATES the source.
// An inner lens without `unproject` yields a Getter (read-only), like any other
// projection-only lens.
export function mapLens(inner, meta = {}) {
  const projectEl = inner.project || ((v) => v);
  const unprojectEl = inner.unproject;
  const project = (list) => (Array.isArray(list) ? list.map((el) => projectEl(el)) : []);
  const d = {
    type: "sketchy:lens",
    id: meta.id || `map-${inner.id || "lens"}`,
    name: meta.name || `map: ${inner.name || inner.id || "lens"}`,
    icon: meta.icon || inner.icon || "List",
    inlet: { name: "in", type: "json", schema: anySchema() },
    outlet: { name: "out", type: "json", schema: anySchema() },
    project,
  };
  if (unprojectEl) {
    d.apply = (op, source) => {
      if (typeof source.apply !== "function") return; // applyLens drops this anyway
      const src = Array.isArray(source.value) ? source.value : [];
      const cur = project(src);
      const next = isSnapshot(op) ? op.value : applyOp(cur, op);
      if (!Array.isArray(next)) return; // the view must stay a list
      if (next.length === src.length) {
        // element-wise: route each changed element through the inner lens to element i
        for (let i = 0; i < next.length; i++) {
          if (valuesEqual(next[i], cur[i])) continue;
          const back = unprojectEl(next[i], src[i]);
          if (back === undefined || isSkip(back) || valuesEqual(back, src[i])) continue;
          source.apply(set([], i, back));
        }
        return;
      }
      // insert/delete: rebuild the whole source list, index-aligned
      const rebuilt = [];
      for (let i = 0; i < next.length; i++) {
        const old = i < src.length ? src[i] : undefined;
        if (i < src.length && valuesEqual(next[i], cur[i])) { rebuilt.push(old); continue; }
        const back = unprojectEl(next[i], old);
        if (back === undefined || isSkip(back)) { if (i < src.length) rebuilt.push(old); continue; }
        rebuilt.push(back);
      }
      if (!valuesEqual(rebuilt, src)) source.apply(snapshot(rebuilt));
    };
  }
  return d;
}

// shipped map-over-list variants, composed with EXISTING element lenses
// (register these in index.jsx's `plugins`, next to jsonPrettyLens):
// pretty JSON per element — list of JSON values ⇄ list of pretty strings
export const mapPrettyLens = mapLens(
  { id: "json-pretty", name: "pretty JSON", icon: "Braces", project: toPretty, unproject: fromPretty },
  { id: "map-pretty", name: "map: pretty JSON" },
);
// number → string per element (an invalid number declines, keeping that element)
export const mapNumberToStringLens = mapLens(
  {
    id: "number-to-string", name: "number → string", icon: "Type",
    project: (v) => (v == null ? "" : String(v)),
    unproject: (str) => { const n = Number(str); return Number.isFinite(n) ? n : undefined; },
  },
  { id: "map-number-to-string", name: "map: number → string" },
);
