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
import { snapshot, isSnapshot, valuesEqual } from "./ops.js";

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
      // idempotent: skip a write that wouldn't change the source (breaks feedback loops)
      if (back !== undefined && typeof source.apply === "function" && !valuesEqual(back, source.value)) source.apply(snapshot(back));
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
