// A LIST layout for a folder — the second layout, demonstrating the thesis in
// LAYOUTS.md: the folder's `docs` are the shared document; this lens renders them as
// rows and DROPS the canvas's positional complement. Because that complement is
// explicit + retained, the list SURFACES it ("you're not seeing the canvas layout"),
// so you always know what this view is hiding.
//
// Each row is also a PORT (data-automerge-url) — so with the wire tool you can grab a
// doc straight from the list and wire it into an editor.
//
// Plain DOM + a `change` listener (the house default), self-contained styles.
import { complementSummary, complementBanner } from "./layouts.js";
import { layoutSwitcher } from "./layout-switch.js";
import { layoutDocUrl } from "./brush/constants.js";
import { log } from "./log.js";

const WRAP = "display:flex;flex-direction:column;gap:2px;padding:6px;font:13px ui-sans-serif,system-ui,sans-serif;color:var(--ns-ink,inherit);";
const BANNER = "margin:2px 4px 8px;padding:6px 9px;border:1.5px dashed #ff2284;border-radius:6px;font:600 11px ui-monospace,monospace;color:#ff2284;line-height:1.4;";
const ROW = "display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:6px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);";
const NAME = "flex:1;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
const TYPE = "font:11px ui-monospace,monospace;opacity:.55;";
const TAG = "font:10px ui-monospace,monospace;color:#ff2284;";
const OPEN = "font:600 11px ui-monospace,monospace;padding:2px 8px;border:1.5px solid currentColor;border-radius:6px;background:transparent;color:inherit;cursor:pointer;";

export function ListTool(handle, element) {
  const root = document.createElement("div");
  root.style.cssText = WRAP;
  element.append(root);

  let complementHandle = null;
  let disposed = false;
  let complementLoad = 0; // ticket — a stale in-flight find must not attach
  const repo = element.repo || (typeof window !== "undefined" && window.repo) || (typeof globalThis !== "undefined" && globalThis.repo);

  // static chrome, built ONCE — render only updates it in place
  // layout switcher — re-open this folder through another lens (same docs)
  const sw = layoutSwitcher(element, handle.url, "sketchy:list");
  if (sw) { sw.style.margin = "2px 4px 8px"; root.append(sw); }
  const banner = document.createElement("div"); banner.style.cssText = BANNER; banner.style.display = "none";
  const empty = document.createElement("div"); empty.style.cssText = "padding:8px;opacity:.5;display:none;"; empty.textContent = "empty folder";
  const list = document.createElement("div"); list.style.cssText = "display:flex;flex-direction:column;gap:2px;";
  root.append(banner, empty, list);

  // rows are KEYED by doc url and REUSED across renders (the patchwork-tool.js rule) —
  // a canvas edit elsewhere must not rebuild every row out from under you
  const rows = new Map(); // url -> row element (with ._name/._type/._tag for in-place updates)
  function makeRow(link) {
    const row = document.createElement("label");
    row.style.cssText = ROW;
    row.dataset.automergeUrl = link.url; // a PORT: wire the whole doc from the list
    row.dataset.automergePath = "[]";
    const name = document.createElement("span"); name.style.cssText = NAME;
    const type = document.createElement("span"); type.style.cssText = TYPE;
    const tag = document.createElement("span"); tag.style.cssText = TAG;
    const open = document.createElement("button"); open.style.cssText = OPEN; open.textContent = "open";
    open.onclick = (e) => { e.preventDefault(); element.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url: link.url }, bubbles: true, composed: true })); };
    row.append(name, type, tag, open);
    row._name = name; row._type = type; row._tag = tag;
    return row;
  }

  function render() {
    const doc = handle.doc() || {};
    const docs = doc.docs || [];
    const summary = complementSummary(doc, complementHandle && complementHandle.doc());
    const positioned = summary.positioned;

    // surface the complement: what this list ISN'T showing
    banner.style.display = summary.has ? "" : "none";
    banner.textContent = summary.has ? complementBanner(summary) : "";
    empty.style.display = docs.length ? "none" : "";

    // keyed reconcile: reuse, retitle, reorder; only add/remove what changed
    const seen = new Set();
    docs.forEach((link, i) => {
      let row = rows.get(link.url);
      if (!row) { row = makeRow(link); rows.set(link.url, row); }
      row._name.textContent = link.name || link.url;
      row._type.textContent = link.type || "";
      row._tag.textContent = positioned.has(link.url) ? "on canvas" : "";
      seen.add(link.url);
      if (list.children[i] !== row) list.insertBefore(row, list.children[i] || null);
    });
    for (const [url, row] of rows) if (!seen.has(url)) { rows.delete(url); row.remove(); }
  }

  // load the canvas complement doc so we can surface it
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
      } catch (e) {
        log.warn("list: complement load failed", e);
      }
    }
    render();
  }

  const onChange = () => loadComplement();
  handle.on("change", onChange);
  loadComplement();

  return () => {
    disposed = true;
    handle.off("change", onChange);
    if (complementHandle) complementHandle.off("change", render);
    root.remove();
  };
}
