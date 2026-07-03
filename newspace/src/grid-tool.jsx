// unregistered 2026-07-02 pending the container-types rethink (see TODO)
// A GRID layout for a folder — every doc as a LIVE embed tile in a responsive
// grid. A third lens over the same folder docs (see LAYOUTS.md), and a layout
// switcher so you can jump between canvas / list / grid. Surfaces the canvas
// complement like the list does.
//
// Plain DOM + a `change` listener; self-contained styles.
import { complementSummary, complementBanner } from "./layouts.js";
import { layoutSwitcher } from "./layout-switch.js";
import { layoutDocUrl } from "./brush/constants.js";
import { log } from "./log.js";

const WRAP = "display:flex;flex-direction:column;height:100%;box-sizing:border-box;overflow:auto;padding:8px;gap:8px;color:var(--ns-ink,inherit);";
const BANNER = "padding:6px 9px;border:1.5px dashed #ff2284;border-radius:6px;font:600 11px ui-monospace,monospace;color:#ff2284;line-height:1.4;";
const GRID = "display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;";
const TILE = "display:flex;flex-direction:column;height:220px;border:1.5px solid var(--ns-ink,#2b2b2b);border-radius:8px;overflow:hidden;background:var(--editor-fill,#fff);box-shadow:3px 3px 0 var(--ns-shadow);";
const THEAD = "display:flex;align-items:center;gap:6px;padding:3px 8px;font:600 11px ui-monospace,monospace;border-bottom:1px solid color-mix(in srgb,currentColor 25%,transparent);";

export function GridTool(handle, element) {
  const root = document.createElement("div");
  root.style.cssText = WRAP;
  element.append(root);
  let complementHandle = null;
  let disposed = false;
  let complementLoad = 0; // ticket — a stale in-flight find must not attach
  const repo = element.repo || (typeof window !== "undefined" && window.repo) || (typeof globalThis !== "undefined" && globalThis.repo);

  // static chrome, built ONCE — render only updates it in place
  const sw = layoutSwitcher(element, handle.url, "sketchy:grid");
  if (sw) root.append(sw);
  const banner = document.createElement("div"); banner.style.cssText = BANNER; banner.style.display = "none";
  const empty = document.createElement("div"); empty.style.cssText = "opacity:.5;padding:8px;display:none;"; empty.textContent = "empty folder";
  const grid = document.createElement("div"); grid.style.cssText = GRID;
  root.append(banner, empty, grid);

  // tiles are KEYED by doc url and REUSED across renders (patchwork-tool.js's rule):
  // rebuilding a <patchwork-view> on every change event remounts the embedded tool —
  // someone drawing on the canvas must not blow away your focus/scroll in a tile.
  const tiles = new Map(); // url -> tile element (with ._name for in-place rename)
  function makeTile(link) {
    const tile = document.createElement("div"); tile.style.cssText = TILE;
    const head = document.createElement("div"); head.style.cssText = THEAD;
    head.dataset.automergeUrl = link.url; head.dataset.automergePath = "[]"; // tile header is a PORT
    const name = document.createElement("span"); name.style.cssText = "flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    const open = document.createElement("button"); open.textContent = "open"; open.style.cssText = "font:600 10px ui-monospace,monospace;padding:1px 6px;border:1px solid currentColor;border-radius:5px;background:transparent;color:inherit;cursor:pointer;";
    open.onclick = (e) => { e.preventDefault(); element.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url: link.url }, bubbles: true, composed: true })); };
    head.append(name, open);
    const body = document.createElement("div"); body.style.cssText = "flex:1;min-height:0;";
    const view = document.createElement("patchwork-view"); view.setAttribute("doc-url", link.url); view.style.cssText = "display:block;width:100%;height:100%;";
    body.append(view); tile.append(head, body);
    tile._name = name;
    return tile;
  }

  function render() {
    const doc = handle.doc() || {};
    const docs = doc.docs || [];

    // surface the canvas complement
    const summary = complementSummary(doc, complementHandle && complementHandle.doc());
    banner.style.display = summary.has ? "" : "none";
    banner.textContent = summary.has ? complementBanner(summary) : "";
    empty.style.display = docs.length ? "none" : "";

    // keyed reconcile: reuse, rename, reorder; only add/remove what changed
    const seen = new Set();
    docs.forEach((link, i) => {
      let tile = tiles.get(link.url);
      if (!tile) { tile = makeTile(link); tiles.set(link.url, tile); }
      tile._name.textContent = link.name || link.url;
      seen.add(link.url);
      if (grid.children[i] !== tile) grid.insertBefore(tile, grid.children[i] || null);
    });
    for (const [url, tile] of tiles) if (!seen.has(url)) { tiles.delete(url); tile.remove(); }
  }

  async function loadComplement() {
    const url = layoutDocUrl(handle.doc(), "canvas"); // @layouts.canvas / .sketch / .newspace
    if (url && repo && (!complementHandle || complementHandle.url !== url)) {
      const ticket = ++complementLoad;
      try {
        const h = await repo.find(url);
        if (disposed || ticket !== complementLoad) return; // unmounted / superseded while pending
        if (complementHandle) complementHandle.off("change", render); // never leak the old listener
        complementHandle = h;
        complementHandle.on("change", render);
      } catch (e) { log.warn("grid: complement", e); }
    }
    render();
  }
  const onChange = () => loadComplement();
  handle.on("change", onChange);
  loadComplement();
  return () => { disposed = true; handle.off("change", onChange); if (complementHandle) complementHandle.off("change", render); root.remove(); };
}
