// A file-open `sketchy:editor`: a button that opens a local file via the File
// System Access API, then edits it in CodeMirror with a Save button (the file
// opstream carries a `save()` capability, unlike automerge). It has NO inlets — it
// SOURCES content from the OS — and exposes the file's opstream on a `text` outlet
// so it can be wired into other nodes.
import { codemirrorEditor } from "./editor.js";
import { openLocalFile } from "../fs-opstream.js";

const BTN = "font:600 12px ui-monospace,monospace;padding:3px 8px;cursor:pointer;border:1.5px solid currentColor;border-radius:6px;background:transparent;";

export function mountFileEditor({ element, outlets }) {
  let editor = null;
  const root = document.createElement("div");
  root.style.cssText = "display:flex;flex-direction:column;height:100%;width:100%;";

  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:6px;align-items:center;padding:4px;flex:0 0 auto;";
  const openBtn = document.createElement("button");
  openBtn.textContent = "Open file…";
  openBtn.style.cssText = BTN;
  const saveBtn = document.createElement("button");
  saveBtn.textContent = "Save";
  saveBtn.style.cssText = BTN;
  saveBtn.disabled = true;
  const nameEl = document.createElement("span");
  nameEl.style.cssText = "font:12px ui-monospace,monospace;opacity:.7;";
  bar.append(openBtn, saveBtn, nameEl);

  const host = document.createElement("div");
  host.style.cssText = "flex:1 1 auto;min-height:0;overflow:auto;";
  root.append(bar, host);
  element.append(root);

  openBtn.onclick = async () => {
    let stream;
    try {
      stream = await openLocalFile();
    } catch (e) {
      nameEl.textContent = e.message;
      return;
    }
    if (!stream) return; // cancelled
    if (editor) editor.destroy();
    host.replaceChildren();
    editor = codemirrorEditor(stream, { parent: host });
    if (outlets) outlets.text = stream; // expose for downstream wiring
    nameEl.textContent = stream.complement.name || "";
    const save = stream.complement.save;
    saveBtn.disabled = typeof save !== "function";
    saveBtn.onclick = () => save && save();
  };

  return () => {
    if (editor) editor.destroy();
    root.remove();
  };
}
