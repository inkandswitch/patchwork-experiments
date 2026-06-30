// A generic INSPECTOR sketchy:editor — displays the live value of its inlet
// opstream (any shape) as text / pretty JSON. Its `value` inlet is typed "json"
// (accepts anything), so it's the natural target when you wire a non-text port
// like the canvas `pointer`/`camera`/`selection` outlet → a live inspector.
import { isSnapshot, isError } from "./opstreams.js";
import { describeBinary } from "./ops.js";

// escape HTML so values render literally
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// pretty-print + SYNTAX HIGHLIGHT a value as JSON: wrap tokens (keys, strings,
// numbers, booleans, null, punctuation) in <span class="ns-j-*"> for CSS colours.
export function highlightJson(v) {
  let json;
  // swap binary (a frame/buffer) for a short tag — Array.from on a megabyte camera
  // frame would freeze the tab. Small byte arrays under 1KB still expand to an array.
  try { json = JSON.stringify(v, (_k, val) => { if (val instanceof Uint8Array && val.length <= 1024) return Array.from(val); return describeBinary(val) ?? val; }, 2); }
  catch { return esc(String(v)); }
  if (json === undefined) return "";
  // token regex: strings (with optional trailing `:` for keys), literals, numbers
  return esc(json).replace(
    /(&quot;(?:\\.|[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
    (m, str, colon, lit, num) => {
      if (str != null) return colon != null
        ? `<span class="ns-j-key">${str}</span>${colon}`
        : `<span class="ns-j-str">${str}</span>`;
      if (lit != null) return `<span class="ns-j-lit">${lit}</span>`;
      if (num != null) return `<span class="ns-j-num">${num}</span>`;
      return m;
    },
  );
}

export function mountInspector({ element, inlets }) {
  const stream = inlets.value || Object.values(inlets)[0];
  const pre = document.createElement("pre");
  pre.className = "ns-inspector";
  pre.style.cssText =
    "margin:0;padding:8px;box-sizing:border-box;height:100%;overflow:auto;white-space:pre-wrap;word-break:break-word;font:12px ui-monospace,monospace;color:var(--ns-ink,inherit);background:var(--editor-fill,#fff);";
  element.append(pre);

  const render = (v) => {
    if (typeof v === "string") { pre.textContent = v; return; } // a plain string: show as-is
    pre.innerHTML = highlightJson(v);
  };

  const showError = (msg) => { pre.textContent = "⚠ " + msg; pre.style.color = "var(--ns-hot, #ff2284)"; };
  const clearError = () => { pre.style.color = "var(--ns-ink, inherit)"; };

  let off;
  if (stream && stream.connect) off = stream.connect((op) => { if (isError(op)) return showError(op.error); clearError(); render(isSnapshot(op) ? op.value : stream.value); });
  else if (stream) render(stream.value);

  return () => {
    if (off) off();
    pre.remove();
  };
}
