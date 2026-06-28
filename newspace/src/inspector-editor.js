// A generic INSPECTOR sketchy:editor — displays the live value of its inlet
// opstream (any shape) as text / pretty JSON. Its `value` inlet is typed "json"
// (accepts anything), so it's the natural target when you wire a non-text port
// like the canvas `pointer`/`camera`/`selection` outlet → a live inspector.
import { isSnapshot } from "./opstreams.js";

export function mountInspector({ element, inlets }) {
  const stream = inlets.value || Object.values(inlets)[0];
  const pre = document.createElement("pre");
  pre.className = "ns-inspector";
  pre.style.cssText =
    "margin:0;padding:8px;box-sizing:border-box;height:100%;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px ui-monospace,monospace;color:var(--ns-ink,inherit);background:var(--editor-fill,#fff);";
  element.append(pre);

  const fmt = (v) => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    try {
      return JSON.stringify(v, (_k, val) => (val instanceof Uint8Array ? Array.from(val) : val), 2);
    } catch {
      return String(v);
    }
  };
  const render = (v) => (pre.textContent = fmt(v));

  let off;
  if (stream && stream.connect) off = stream.connect((op) => render(isSnapshot(op) ? op.value : stream.value));
  else if (stream) render(stream.value);

  return () => {
    if (off) off();
    pre.remove();
  };
}
