// A jq-ish JSON narrowing node — the "lens with UI" the design points at: it has
// an inlet (any JSON), a TEXT FIELD for a path expression, and an outlet (the
// narrowed value). Because it has its own UI state (the path), it's a
// `sketchy:editor` (a node), not a bare `sketchy:lens` — which is exactly the
// observation that a visible/stateful lens IS a node.
//
// The path grammar is a small subset of jq: a leading `.`, then `.key`,
// `["key"]`, `[0]`, chained. `.` alone is identity. Unknown paths → undefined.
import { apply as applyOp } from "./opstreams.js";
import { snapshot, isSnapshot, valuesEqual, describeBinary, fmtNum, previewReplacer } from "./ops.js";

// parse a path expression into a list of steps (strings = keys, numbers = indices)
export function parsePath(expr) {
  const s = (expr || "").trim();
  if (s === "" || s === ".") return [];
  const steps = [];
  let i = 0;
  if (s[i] === ".") i++; // optional leading dot
  while (i < s.length) {
    const start = i;
    const ch = s[i];
    if (ch === ".") { i++; continue; }
    if (ch === "[") {
      // quote-aware scan for the closing ] — a quoted key may CONTAIN a ] (["a]b"])
      let end = -1, quote = null;
      for (let k = i + 1; k < s.length; k++) {
        const c = s[k];
        if (quote) { if (c === quote) quote = null; }
        else if (c === '"' || c === "'") quote = c;
        else if (c === "]") { end = k; break; }
      }
      if (end < 0) throw new Error("unclosed [");
      let tok = s.slice(i + 1, end).trim();
      if ((tok[0] === '"' && tok.at(-1) === '"') || (tok[0] === "'" && tok.at(-1) === "'")) {
        steps.push(tok.slice(1, -1));
      } else if (/^-?\d+$/.test(tok)) {
        steps.push(Number(tok));
      } else {
        steps.push(tok);
      }
      i = end + 1;
      continue;
    }
    // a bareword key up to the next . or [
    let j = i;
    while (j < s.length && s[j] !== "." && s[j] !== "[") j++;
    steps.push(s.slice(i, j));
    i = j;
    if (i === start) i++; // anti-stall: never let `i` fail to advance (no freeze)
  }
  return steps;
}

// evaluate a parsed/text path against a value
export function evalPath(value, expr) {
  const steps = Array.isArray(expr) ? expr : parsePath(expr);
  let cur = value;
  for (const step of steps) {
    if (cur == null) return undefined;
    if (typeof step === "number" && Array.isArray(cur)) cur = cur.at(step);
    else cur = cur[step];
  }
  return cur;
}

// A BIDIRECTIONAL json-path lens over `src`, where the path is read live from
// `getExpr()` (so the UI field can change it). It's a real optic: the value is the
// narrowed view (lazy — computed on read, never eagerly stringified), and `apply`
// writes the edited value BACK into the source at the path (present only when the
// source is editable — otherwise it's a read-only Getter). `emit()` re-notifies
// consumers when the path changes. This is why `File→JSONPath ".x"→Code` is saveable:
// edits flow back through the path to the source (and on to its save()).
export function jsonPathStream(src, getExpr) {
  const listeners = new Set();
  const read = () => { try { return evalPath(src ? src.value : undefined, getExpr()); } catch { return undefined; } };
  const emit = () => { const s = snapshot(read()); for (const cb of [...listeners]) cb(s); };
  let offSrc = null;
  const out = {
    get value() { return read(); },
    get complement() { return (src && src.complement) || {}; }, // passthrough (carries save())
    connect(cb) {
      if (!listeners.size && src && src.connect) offSrc = src.connect(() => emit());
      listeners.add(cb);
      cb(snapshot(read()));
      return () => { listeners.delete(cb); if (!listeners.size && offSrc) { offSrc(); offSrc = null; } };
    },
    emit,
  };
  if (src && typeof src.apply === "function") {
    out.apply = (op) => {
      const cur = read();
      const next = isSnapshot(op) ? op.value : applyOp(cur, op);
      if (valuesEqual(next, cur)) return; // no change → don't write back (breaks cycles)
      src.apply(writeOp(parsePath(getExpr()), next));
    };
  }
  return out;
}

// mount contract: ({ element, inlets, setOutlet }) => cleanup
//   inlets.json — opstream (any JSON)
//   outlet `value` — the BIDIRECTIONAL narrowed view (write-back at the path)
export function mountJsonPath({ element, inlets, outlets, setOutlet, config = {}, setConfig }) {
  const src = inlets.json;
  let expr = typeof config.expr === "string" ? config.expr : "."; // persisted path
  const out = jsonPathStream(src, () => expr);
  if (setOutlet) setOutlet("value", out); else if (outlets) outlets.value = out;

  const root = document.createElement("div");
  root.className = "ns-jsonpath";
  const field = document.createElement("input");
  field.className = "ns-text ns-jsonpath-expr";
  field.placeholder = ". | .key | [0] | .a.b[2]";
  field.value = expr;
  const result = document.createElement("pre");
  result.className = "ns-jsonpath-result";
  root.append(field, result);
  element.append(root);

  const refreshUI = () => { try { result.textContent = preview(evalPath(src ? src.value : undefined, expr)); } catch (e) { result.textContent = `⚠ ${e.message}`; } };
  field.oninput = () => { expr = field.value; out.emit(); refreshUI(); if (setConfig) setConfig({ expr }); }; // re-narrow + redraw + persist

  const off = src && src.connect ? src.connect(refreshUI) : null;
  refreshUI();

  return () => { if (off) off(); root.remove(); };
}

// a BOUNDED, cheap preview — never stringify a whole multi-MB value (a file's text)
// with indentation on every keystroke; that's what froze the page.
const PREVIEW_MAX = 2000;
function preview(v) {
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v.length > PREVIEW_MAX ? v.slice(0, PREVIEW_MAX) + "…" : v;
  if (typeof v === "number") return String(fmtNum(v)); // round floats for the readout (data is untouched)
  const d = describeBinary(v); if (d) return d; // never stringify a frame/buffer
  let s;
  try { s = JSON.stringify(v, previewReplacer); } catch { return String(v); }
  if (s == null) return String(v);
  return s.length > PREVIEW_MAX ? s.slice(0, PREVIEW_MAX) + "…" : s;
}

// ── json-set: the WRITE counterpart of json-path ─────────────────────────────
// Wire a value in (`value`) and a target opstream in (`into`), give a path, and it
// writes the value to that field of the target. The op model is {path, range,
// value} where the LAST step is the `range` (key) and the rest is the `path`.

// pure: a write op that assigns `value` at the parsed path steps. Empty path
// (identity ".") replaces the whole value (a snapshot).
export function writeOp(steps, value) {
  if (!steps.length) return snapshot(value);
  return { path: steps.slice(0, -1), range: steps[steps.length - 1], value };
}

// mount contract: ({ element, inlets }) => cleanup
//   inlets.value — opstream of the value to write
//   inlets.into  — the TARGET opstream (must be editable: have `apply`)
export function mountJsonSet({ element, inlets }) {
  const value = inlets.value, into = inlets.into;
  let expr = "";

  const root = document.createElement("div");
  root.className = "ns-jsonpath ns-jsonset";
  const field = document.createElement("input");
  field.className = "ns-text ns-jsonpath-expr";
  field.placeholder = "field to write — . (whole doc) | .width | .a.b[0]";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:6px;align-items:center;";
  const btn = document.createElement("button");
  btn.className = "ns-source-enable";
  btn.textContent = "write";
  const status = document.createElement("div");
  status.className = "ns-jsonpath-result";
  row.append(field, btn);
  root.append(row, status);
  element.append(root);

  const write = () => {
    if (!into || typeof into.apply !== "function") { status.textContent = "⚠ target is read-only (wire an editable doc into ‘into’)"; return; }
    if (!expr.trim()) { status.textContent = "set a path, e.g. .width — or . for the whole doc"; return; }
    let steps; try { steps = parsePath(expr); } catch (e) { status.textContent = `⚠ ${e.message}`; return; } // `.` → [] → whole-doc replace
    const v = value ? value.value : undefined;
    // IDEMPOTENT: if the target field already equals the value, don't write — else
    // every emit re-writes, the source re-emits, and the graph loops forever (freeze).
    let cur; try { cur = evalPath(into.value, steps); } catch { cur = undefined; }
    if (valuesEqual(cur, v)) { status.textContent = `= ${preview(v)} @ ${expr}`; return; }
    into.apply(writeOp(steps, v));
    status.textContent = `wrote ${preview(v)} → ${expr}`;
  };
  field.oninput = () => { expr = field.value; };
  field.onkeydown = (e) => { if (e.key === "Enter") write(); };
  btn.onclick = write;
  // live: re-write whenever the incoming value changes (once a path is set)
  const off = value && value.connect ? value.connect(() => { if (expr.trim()) write(); }) : null;

  return () => { if (off) off(); root.remove(); };
}
