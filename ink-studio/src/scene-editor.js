// An ink object's Open, in a scene: its source over the scene's view, docked on
// the left, while the world itself stays in its place and rebuilds there as
// the code changes (extension.js). The same editor as the tool's (editor.js),
// on a hosted handle (hosted.js), so each edit is a step of the scene's undo.

import { createEditor } from "./editor.js";

const PANEL = "position:absolute;top:0;left:0;bottom:0;width:min(46%,560px);display:flex;flex-direction:column;" +
  "background:#fff;color:#111;font:12px/1.4 system-ui,sans-serif;pointer-events:auto;box-shadow:0 0 12px rgb(0 0 0 / 15%);z-index:2;";
const BAR = "display:flex;gap:8px;align-items:center;padding:6px 8px;border-bottom:1px solid #ddd;background:#f6f6f6;";
const BUTTON = "font:inherit;background:#fff;color:#111;border:1px solid #ccc;border-radius:4px;padding:2px 8px;cursor:pointer;";
const STATUS = "padding:6px 8px;border-top:1px solid #eee;font:11px/1.5 ui-monospace,monospace;white-space:pre-wrap;max-height:30%;overflow:auto;";

/**
 * @param {{ overlay: HTMLElement, handle: object, name: string, onClose: () => void }} o
 *   handle: the doc's handle, already hosted
 * @returns {{ status({ splats, building, error }): void, close(): void }}
 */
export function createSceneEditor({ overlay, handle, name, onClose }) {
  const panel = document.createElement("div");
  panel.className = "ink-scene-editor";
  panel.style.cssText = PANEL;
  panel.innerHTML = `
    <div style="${BAR}">
      <strong style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"></strong>
      <select aria-label="File" style="${BUTTON}"></select>
      <button type="button" style="${BUTTON}" title="Close the editor (Esc)">Close</button>
    </div>
    <div class="editor" style="flex:1;min-height:0;overflow:auto"></div>
    <div class="status" style="${STATUS}"></div>`;
  overlay.append(panel);
  // keys typed here are the editor's, not the scene's
  panel.dataset.stageEmbed = "";
  const title = panel.querySelector("strong"), files = panel.querySelector("select"), statusEl = panel.querySelector(".status");
  title.textContent = name;
  panel.querySelector("button").onclick = () => onClose();
  const host = panel.querySelector(".editor");

  let editor = null, editing = null;
  function list() {
    const doc = handle.doc();
    const names = Object.keys(doc?.files ?? {}).sort((a, b) => (a === doc.main ? -1 : b === doc.main ? 1 : a.localeCompare(b)));
    files.innerHTML = "";
    for (const n of names) files.append(new Option(n, n, false, n === editing));
    files.hidden = names.length < 2;
    return names;
  }
  function open(file) {
    editor?.destroy();
    editor = null;
    editing = file;
    host.innerHTML = "";
    if (file) {
      editor = createEditor(host, handle, file);
      editor.view.dom.style.height = "100%";
    } else host.textContent = "A built-in demo: its source is the toolkit's own, with nothing to edit here.";
    list();
  }
  files.onchange = () => open(files.value);
  const doc = handle.doc();
  open(doc?.kind === "builtin" ? null : doc?.main ?? list()[0] ?? null);

  let closed = false;
  return {
    status({ splats = null, building = false, error = null } = {}) {
      statusEl.style.color = error ? "#b3261e" : "#555";
      statusEl.textContent = error ? `${error}\n(the last good build stays in the scene)` : building ? "Building…" : splats != null ? `${splats.toLocaleString()} splats` : "";
    },
    close() {
      if (closed) return;
      closed = true;
      editor?.destroy();
      panel.remove();
    },
  };
}
