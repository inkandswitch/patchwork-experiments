// A simple form `patchwork:tool`: one text input per top-level doc field, each
// two-way bound to its path. Each input is a PORT — it carries `data-automerge-url`
// + `data-automerge-path`, which the wire brush reads to build an
// `automergeOpstream(handle, {path})` and connect it to an editor.
//
// (Plain DOM + a `change` listener — the house default for a tool with little
// reactive surface.)

const SKIP = new Set(["@patchwork"]);
const ROW = "display:flex;gap:8px;align-items:center;margin:4px 6px;";
const LABEL = "font:600 12px ui-monospace,monospace;min-width:80px;opacity:.75;";
const INPUT =
  "flex:1;font:13px ui-monospace,monospace;padding:3px 6px;border:1.5px solid currentColor;border-radius:6px;background:transparent;color:inherit;";

function fieldKeys(doc) {
  return Object.keys(doc || {}).filter(
    (k) => !SKIP.has(k) && (typeof doc[k] === "string" || typeof doc[k] === "number")
  );
}

export function FormTool(handle, element) {
  const root = document.createElement("div");
  root.style.cssText = "display:flex;flex-direction:column;padding:6px 2px;";
  element.append(root);
  const inputs = new Map();

  function build() {
    root.replaceChildren();
    inputs.clear();
    const doc = handle.doc();
    for (const key of fieldKeys(doc)) {
      const row = document.createElement("label");
      row.style.cssText = ROW;
      // a draggable GRIP — HTML5 DnD so you can wire this field to an editor even
      // across the embedded-tool (iframe) boundary that pointer events don't cross.
      const grip = document.createElement("span");
      grip.textContent = "⠿";
      grip.title = "drag to wire this field";
      grip.draggable = true; // HTML5 DnD — the ONE mechanism that crosses an iframe
      grip.style.cssText = "cursor:grab;opacity:.45;user-select:none;font-size:14px;";
      const port = { kind: "automerge", url: handle.url, path: [key] };
      // HTML5 DnD: crosses iframe boundaries (the canvas onDrop reads it)
      grip.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("application/sketchy-port", JSON.stringify(port));
        e.dataTransfer.setData("text/plain", JSON.stringify(port)); // some hosts only forward known types
        e.dataTransfer.effectAllowed = "copy";
      });
      // ALSO composed custom events (for shadow-DOM / same-doc embeds, with a live
      // wire line). preventDefault is skipped so the native drag can still start.
      grip.addEventListener("pointerdown", (e) => {
        e.stopPropagation();
        grip.dispatchEvent(new CustomEvent("sketchy:wire-from", { bubbles: true, composed: true, detail: { port, clientX: e.clientX, clientY: e.clientY } }));
        const move = (ev) => grip.dispatchEvent(new CustomEvent("sketchy:wire-move", { bubbles: true, composed: true, detail: { clientX: ev.clientX, clientY: ev.clientY } }));
        const up = (ev) => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
          grip.dispatchEvent(new CustomEvent("sketchy:wire-drop", { bubbles: true, composed: true, detail: { port, clientX: ev.clientX, clientY: ev.clientY } }));
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      });
      const span = document.createElement("span");
      span.textContent = key;
      span.style.cssText = LABEL;
      const input = document.createElement("input");
      input.type = "text";
      input.value = String(doc[key] ?? "");
      input.style.cssText = INPUT;
      // PORT markers for the wire brush → automergeOpstream(handle, { path })
      input.dataset.automergeUrl = handle.url;
      input.dataset.automergePath = JSON.stringify([key]);
      input.oninput = () => {
        const v = input.value;
        handle.change((d) => {
          if (typeof d[key] === "number") {
            const n = Number(v);
            if (!Number.isNaN(n)) d[key] = n;
          } else {
            d[key] = v;
          }
        });
      };
      inputs.set(key, input);
      row.append(grip, span, input);
      root.append(row);
    }
  }
  build();

  const onChange = () => {
    const doc = handle.doc();
    const current = fieldKeys(doc);
    const same = inputs.size === current.length && current.every((k) => inputs.has(k));
    if (!same) return build(); // field set changed → rebuild
    for (const key of current) {
      const input = inputs.get(key);
      if (document.activeElement !== input) input.value = String(doc[key] ?? "");
    }
  };
  handle.on("change", onChange);

  return () => {
    handle.off("change", onChange);
    root.remove();
  };
}
