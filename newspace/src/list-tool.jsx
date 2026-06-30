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
import { complementSummary, complementBanner, layoutsFor } from "./layouts.js";

const SWITCH = "display:flex;gap:4px;margin:2px 4px 8px;";
const SWBTN = "padding:3px 9px;border:1px solid currentColor;border-radius:5px;background:transparent;color:inherit;font:600 11px ui-monospace,monospace;cursor:pointer;";
const SWBTN_ON = SWBTN + "background:var(--ns-ink,#2b2b2b);color:var(--ns-paper,#fff);";

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
  const repo = element.repo || (typeof window !== "undefined" && window.repo) || (typeof globalThis !== "undefined" && globalThis.repo);

  function render() {
    const doc = handle.doc() || {};
    const docs = doc.docs || [];
    const summary = complementSummary(doc, complementHandle && complementHandle.doc());
    const positioned = summary.positioned;

    root.replaceChildren();

    // layout switcher — re-open this folder through another lens (same docs)
    const layouts = layoutsFor("folder");
    if (layouts.length > 1) {
      const sw = document.createElement("div");
      sw.style.cssText = SWITCH;
      for (const l of layouts) {
        const b = document.createElement("button");
        b.textContent = l.name;
        b.style.cssText = l.toolId === "sketchy:list" ? SWBTN_ON : SWBTN;
        b.onclick = () => {
          if (l.toolId === "sketchy:list") return;
          element.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url: handle.url, toolId: l.toolId }, bubbles: true, composed: true }));
        };
        sw.append(b);
      }
      root.append(sw);
    }

    // surface the complement: what this list ISN'T showing
    if (summary.has) {
      const banner = document.createElement("div");
      banner.style.cssText = BANNER;
      banner.textContent = complementBanner(summary);
      root.append(banner);
    }

    for (const link of docs) {
      const row = document.createElement("label");
      row.style.cssText = ROW;
      row.dataset.automergeUrl = link.url; // a PORT: wire the whole doc from the list
      row.dataset.automergePath = "[]";
      const name = document.createElement("span"); name.style.cssText = NAME; name.textContent = link.name || link.url;
      const type = document.createElement("span"); type.style.cssText = TYPE; type.textContent = link.type || "";
      const tag = document.createElement("span"); tag.style.cssText = TAG; tag.textContent = positioned.has(link.url) ? "on canvas" : "";
      const open = document.createElement("button"); open.style.cssText = OPEN; open.textContent = "open";
      open.onclick = (e) => { e.preventDefault(); element.dispatchEvent(new CustomEvent("patchwork:open-document", { detail: { url: link.url }, bubbles: true, composed: true })); };
      row.append(name, type, tag, open);
      root.append(row);
    }
    if (!docs.length) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:8px;opacity:.5;";
      empty.textContent = "empty folder";
      root.append(empty);
    }
  }

  // load the canvas complement doc (folder.newspace) so we can surface it
  async function loadComplement() {
    const url = handle.doc() && handle.doc().newspace;
    if (url && repo && (!complementHandle || complementHandle.url !== url)) {
      try {
        complementHandle = await repo.find(url);
        complementHandle.on("change", render);
      } catch (e) {
        console.warn("[list] complement load failed", e);
      }
    }
    render();
  }

  const onChange = () => loadComplement();
  handle.on("change", onChange);
  loadComplement();

  return () => {
    handle.off("change", onChange);
    if (complementHandle) complementHandle.off("change", render);
    root.remove();
  };
}
