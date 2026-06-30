// A GRID layout for a folder — every doc as a LIVE embed tile in a responsive
// grid. A third lens over the same folder docs (see LAYOUTS.md), and a layout
// switcher so you can jump between canvas / list / grid. Surfaces the canvas
// complement like the list does.
//
// Plain DOM + a `change` listener; self-contained styles.
import { complementSummary, complementBanner, layoutsFor } from "./layouts.js";

const WRAP = "display:flex;flex-direction:column;height:100%;box-sizing:border-box;overflow:auto;padding:8px;gap:8px;color:var(--ns-ink,inherit);";
const SWITCH = "display:flex;gap:4px;";
const SWBTN = "padding:3px 9px;border:1px solid currentColor;border-radius:5px;background:transparent;color:inherit;font:600 11px ui-monospace,monospace;cursor:pointer;";
const SWBTN_ON = SWBTN + "background:var(--ns-ink,#2b2b2b);color:var(--ns-paper,#fff);";
const BANNER = "padding:6px 9px;border:1.5px dashed #ff2284;border-radius:6px;font:600 11px ui-monospace,monospace;color:#ff2284;line-height:1.4;";
const GRID = "display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;";
const TILE = "display:flex;flex-direction:column;height:220px;border:1.5px solid var(--ns-ink,#2b2b2b);border-radius:8px;overflow:hidden;background:var(--editor-fill,#fff);box-shadow:3px 3px 0 var(--ns-shadow);";
const THEAD = "display:flex;align-items:center;gap:6px;padding:3px 8px;font:600 11px ui-monospace,monospace;border-bottom:1px solid color-mix(in srgb,currentColor 25%,transparent);";

export function GridTool(handle, element) {
  const root = document.createElement("div");
  root.style.cssText = WRAP;
  element.append(root);
  let complementHandle = null;
  const repo = element.repo || (typeof window !== "undefined" && window.repo) || (typeof globalThis !== "undefined" && globalThis.repo);

  function render() {
    const doc = handle.doc() || {};
    const docs = doc.docs || [];
    root.replaceChildren();

    // layout switcher
    const layouts = layoutsFor("folder");
    if (layouts.length > 1) {
      const sw = document.createElement("div"); sw.style.cssText = SWITCH;
      for (const l of layouts) {
        const b = document.createElement("button"); b.textContent = l.name;
        b.style.cssText = l.toolId === "sketchy:grid" ? SWBTN_ON : SWBTN;
        b.onclick = () => l.toolId !== "sketchy:grid" && element.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url: handle.url, toolId: l.toolId }, bubbles: true, composed: true }));
        sw.append(b);
      }
      root.append(sw);
    }

    // surface the canvas complement
    const summary = complementSummary(doc, complementHandle && complementHandle.doc());
    if (summary.has) { const banner = document.createElement("div"); banner.style.cssText = BANNER; banner.textContent = complementBanner(summary); root.append(banner); }

    if (!docs.length) { const e = document.createElement("div"); e.style.cssText = "opacity:.5;padding:8px;"; e.textContent = "empty folder"; root.append(e); return; }

    const grid = document.createElement("div"); grid.style.cssText = GRID;
    for (const link of docs) {
      const tile = document.createElement("div"); tile.style.cssText = TILE;
      const head = document.createElement("div"); head.style.cssText = THEAD;
      head.dataset.automergeUrl = link.url; head.dataset.automergePath = "[]"; // tile header is a PORT
      const name = document.createElement("span"); name.textContent = link.name || link.url; name.style.cssText = "flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      const open = document.createElement("button"); open.textContent = "open"; open.style.cssText = "font:600 10px ui-monospace,monospace;padding:1px 6px;border:1px solid currentColor;border-radius:5px;background:transparent;color:inherit;cursor:pointer;";
      open.onclick = (e) => { e.preventDefault(); element.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url: link.url }, bubbles: true, composed: true })); };
      head.append(name, open);
      const body = document.createElement("div"); body.style.cssText = "flex:1;min-height:0;";
      const view = document.createElement("patchwork-view"); view.setAttribute("doc-url", link.url); view.style.cssText = "display:block;width:100%;height:100%;";
      body.append(view); tile.append(head, body); grid.append(tile);
    }
    root.append(grid);
  }

  async function loadComplement() {
    const url = handle.doc() && handle.doc().newspace;
    if (url && repo && (!complementHandle || complementHandle.url !== url)) {
      try { complementHandle = await repo.find(url); complementHandle.on("change", render); } catch (e) { console.warn("[grid] complement", e); }
    }
    render();
  }
  const onChange = () => loadComplement();
  handle.on("change", onChange);
  loadComplement();
  return () => { handle.off("change", onChange); if (complementHandle) complementHandle.off("change", render); root.remove(); };
}
