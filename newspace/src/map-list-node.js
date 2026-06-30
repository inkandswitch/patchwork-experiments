// Map list — a sketchy:window node that maps every element of an input array
// through a JS element-expression you write, emitting the mapped array.
//
//   inlet  in  : json   (an array)
//   outlet out : json   (the mapped array)
//
// The textarea holds an arrow expression `(x, i) => …` (the same compile-with-eval
// trick as js-node), default `(x) => x` (identity). Persisted in config.code.
// Non-array input passes through harmlessly as an empty array (nothing to map).
import { Source } from "./opstreams.js";
import { anySchema } from "./ops.js";

const DEFAULT = "(x) => x";

// ── pure logic (exported for unit tests; no DOM, no rendering) ────────────────

// compile a mapper source string into `{ fn, error }`. `fn` is the per-element
// function `(x, i) => y`; on a syntax/eval error `fn` is null and `error` is the
// message — never throws.
export function compileMapper(code) {
  const src = typeof code === "string" && code.trim() ? code : DEFAULT;
  try {
    const v = (0, eval)("(" + src + ")"); // eslint-disable-line no-eval
    if (typeof v !== "function") return { fn: null, error: "want a function (x, i) => …" };
    return { fn: v, error: null };
  } catch (e) {
    return { fn: null, error: e.message };
  }
}

// map an array through `fn`. Non-array input → `[]` (pass through / document the
// empty case). A throw inside `fn` is caught per-call and yields `undefined` for
// that element, so one bad element never breaks the whole map.
export function applyMapper(arr, fn) {
  if (!Array.isArray(arr) || typeof fn !== "function") return [];
  return arr.map((x, i) => {
    try { return fn(x, i); } catch { return undefined; }
  });
}

// ── mount (the sketchy:window render contract) ───────────────────────────────

export function mountMapList({ element, inlets = {}, setOutlet, config = {}, setConfig }) {
  const src = inlets.in;
  const out = new Source([]);
  if (setOutlet) setOutlet("out", out);

  let code = typeof config.code === "string" ? config.code : DEFAULT;
  let fn = null;

  const root = document.createElement("div"); root.className = "ns-maplist ns-source";
  const ta = document.createElement("textarea");
  ta.className = "ns-text ns-maplist-src"; ta.spellcheck = false; ta.rows = 3; ta.value = code;
  ta.placeholder = "(x, i) => x";
  const status = document.createElement("div"); status.className = "ns-source-status";
  root.append(ta, status); element.append(root);

  const compile = () => {
    const { fn: f, error } = compileMapper(code);
    fn = f;
    status.textContent = error ? `⚠ ${error}` : "ready";
  };
  const recompute = () => {
    if (!fn) return;
    out.push(applyMapper(src ? src.value : undefined, fn));
  };

  compile();
  ta.oninput = () => { code = ta.value; if (setConfig) setConfig({ code }); compile(); recompute(); };
  const off = src && src.connect ? src.connect(recompute) : null;
  recompute();

  return () => { if (off) off(); root.remove(); };
}

// ── the single plugin descriptor ─────────────────────────────────────────────

export const plugin = {
  type: "sketchy:window",
  id: "map-list",
  name: "Map list",
  icon: "List",
  inlets: [{ name: "in", type: "json", schema: anySchema(), required: true }], // accepts: an array
  outlets: [{ name: "out", type: "json", schema: anySchema() }], // provides: the mapped array
  async load() { return mountMapList; },
};
