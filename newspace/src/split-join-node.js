// Split / Join — a bidirectional sketchy:window node.
//
//   inlet  in  : text          a string
//   outlet out : json (array)  the string split on a delimiter
//
// Forward:  out = in.split(delim)
// Backward: editing `out` (an array) writes array.join(delim) back into `in`
//           — but only when the `in` inlet is itself editable (has `apply`).
//
// The delimiter is a small persisted UI field (default ",").
import { Source, apply as applyOp } from "./opstreams.js";
import { snapshot, isSnapshot, anySchema, stringSchema } from "./ops.js";

const DEFAULT_DELIM = ",";

// ── pure logic (exported for unit tests) ─────────────────────────────────────

// split a string into an array of pieces on `delim`.
// non-strings → []; an empty string → [""] (String.prototype.split's behaviour,
// which round-trips: joinBy([""], d) === "").
export function splitBy(str, delim) {
  if (typeof str !== "string") return [];
  return str.split(delim);
}

// join an array of pieces back into a string with `delim`.
// non-arrays → ""; each element is coerced to a string.
export function joinBy(arr, delim) {
  if (!Array.isArray(arr)) return "";
  return arr.map((x) => (x == null ? "" : String(x))).join(delim);
}

// ── mount ────────────────────────────────────────────────────────────────────

export function mountSplitJoin({ element, inlets = {}, setOutlet, config = {}, setConfig }) {
  const src = inlets.in;
  let delim = typeof config.delim === "string" ? config.delim : DEFAULT_DELIM;

  const out = new Source(splitBy(src ? src.value : undefined, delim), { schema: anySchema() });
  if (setOutlet) setOutlet("out", out);

  const root = document.createElement("div");
  root.className = "ns-split-join ns-source";
  const label = document.createElement("label");
  label.className = "ns-split-join-label";
  label.textContent = "delimiter";
  const field = document.createElement("input");
  field.type = "text";
  field.className = "ns-text ns-split-join-delim";
  field.value = delim;
  field.placeholder = ",";
  field.spellcheck = false;
  label.append(field);
  root.append(label);
  element.append(root);

  const recompute = () => out.push(splitBy(src ? src.value : undefined, delim));

  // backward: an edit on `out` (the array) joins back into the source string —
  // only when the source itself is editable (presence of `apply` is the affordance).
  if (src && typeof src.apply === "function") {
    out.apply = (op) => {
      const cur = out.value;
      const next = isSnapshot(op) ? op.value : applyOp(cur, op);
      src.apply(snapshot(joinBy(next, delim)));
    };
  }

  field.oninput = () => {
    delim = field.value;
    if (setConfig) setConfig({ delim });
    recompute();
  };

  const off = src && src.connect ? src.connect(recompute) : null;
  recompute();

  return () => {
    if (off) off();
    root.remove();
  };
}

// ── the single plugin object ─────────────────────────────────────────────────

export const plugin = {
  type: "sketchy:window",
  id: "split-join",
  name: "Split / Join",
  icon: "Scissors",
  inlets: [{ name: "in", type: "text", schema: stringSchema() }],
  outlets: [{ name: "out", type: "json", schema: anySchema() }],
  async load() {
    return mountSplitJoin;
  },
};
