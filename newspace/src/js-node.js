// A JS transform box: write JavaScript to transform `in` → `out`. The code is an
// expression evaluating to either:
//   • a function           (x) => y            — a one-way transform (a Getter), or
//   • an object  { get, set }                  — bidirectional (set writes back to `in`)
// Defaults to passthrough `(x) => x`. Persisted in the doc. (Uses eval — fine on your
// own canvas; the sandbox boundary is the future isolation story.)
import { Source, apply as applyOp } from "./opstreams.js";
import { snapshot, isSnapshot } from "./ops.js";

const DEFAULT = "(x) => x";

export function mountJs({ element, inlets = {}, setOutlet, config = {}, setConfig }) {
  const src = inlets.in;
  const out = new Source(undefined);
  if (setOutlet) setOutlet("out", out);
  let code = typeof config.code === "string" ? config.code : DEFAULT;
  let spec = null; // { get, set }

  const root = document.createElement("div"); root.className = "ns-js ns-source";
  const ta = document.createElement("textarea"); ta.className = "ns-text ns-js-src"; ta.spellcheck = false; ta.rows = 4; ta.value = code;
  ta.placeholder = "(x) => x   ·   or { get:(x)=>y, set:(y,x)=>x }";
  const status = document.createElement("div"); status.className = "ns-source-status";
  root.append(ta, status); element.append(root);

  const compile = () => {
    try {
      const v = (0, eval)("(" + code + ")"); // eslint-disable-line no-eval
      if (typeof v === "function") spec = { get: v, set: null };
      else if (v && typeof v.get === "function") spec = { get: v.get, set: typeof v.set === "function" ? v.set : null };
      else { spec = null; status.textContent = "⚠ want a function or { get, set }"; out.pushError("want a function or { get, set }"); return; }
      status.textContent = spec.set ? "⇄ ready" : "ready";
    } catch (e) { spec = null; status.textContent = `⚠ ${e.message}`; out.pushError(e); }
  };
  const recompute = () => { if (!spec) return; try { out.push(spec.get(src ? src.value : undefined)); } catch (e) { status.textContent = `⚠ ${e.message}`; out.pushError(e); } };

  compile();
  // bidi: if the code provides `set` and the source is editable, writing `out` writes
  // back through `set` to `in`. (apply presence sampled now — re-mount to change it.)
  if (spec && spec.set && src && typeof src.apply === "function") {
    out.apply = (op) => {
      const cur = out.value;
      const next = isSnapshot(op) ? op.value : applyOp(cur, op);
      try { const back = spec.set(next, src ? src.value : undefined); if (back !== undefined) src.apply(snapshot(back)); }
      catch (e) { status.textContent = `⚠ ${e.message}`; }
    };
  }

  ta.oninput = () => { code = ta.value; if (setConfig) setConfig({ code }); compile(); recompute(); };
  const off = src && src.connect ? src.connect(recompute) : null;
  recompute();
  return () => { if (off) off(); root.remove(); };
}
