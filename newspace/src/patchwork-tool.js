// A `patchwork-tool` surface: an EMPTY tool with no doc attached until you wire one
// in. Its `doc` inlet takes any automerge opstream; we read the doc's url from the
// stream's complement and render a live <patchwork-view> for it. So:
//   automerge source ──doc──▶ patchwork-tool
// or drag a doc from the sidebar (which wires the url straight in).
//
// The url lives in the complement (automergeOpstream sets `complement.url`); the
// VALUE is the doc itself, but a tool wants the url to mount a view, not the JSON.

// pull the automerge url out of a wired stream's complement (a few aliases)
export function docUrlOf(stream) {
  const c = (stream && stream.complement) || {};
  return c.url || c.docUrl || c.automergeUrl || null;
}

// mount contract: ({ element, inlets, config, setConfig }) => cleanup
//   inlets.doc — an automerge opstream (its complement carries the url)
// A small TOOL-ID field lets you pick which tool renders the doc (blank = host default);
// the view rebuilds reactively when the wired doc changes (wire-after-place works).
export function mountPatchworkTool({ element, inlets, config = {}, setConfig }) {
  let toolId = typeof config.toolId === "string" ? config.toolId : "";

  const root = document.createElement("div");
  root.style.cssText = "display:flex;flex-direction:column;height:100%;box-sizing:border-box;";
  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;gap:4px;padding:2px 2px 3px;";
  const field = document.createElement("input");
  field.className = "ns-text";
  field.placeholder = "tool id (blank = default)";
  field.value = toolId;
  field.style.cssText = "flex:1;min-width:0;font:10px ui-monospace,monospace;";
  bar.append(field);
  const host = document.createElement("div");
  host.style.cssText = "flex:1;min-height:0;position:relative;";
  root.append(bar, host);
  element.append(root);

  // REBUILD the <patchwork-view> only when the DOC (url) or tool-id changes. On a value/op
  // change to the SAME doc we must NOT recreate the view — the embedded tool is bound to the
  // live handle and updates itself from ops. Rebuilding on every op re-renders the inner tool
  // from scratch (the bug: a template-doc feeding a Tool flickered on every input).
  let curUrl = null;
  const rebuild = () => {
    const url = docUrlOf(inlets.doc);
    curUrl = url;
    host.replaceChildren();
    if (!url) {
      const ph = document.createElement("div");
      ph.className = "ns-editor-placeholder";
      ph.textContent = "wire a doc (an automerge source / a doc from the sidebar)";
      host.append(ph);
      return;
    }
    const pv = document.createElement("patchwork-view");
    pv.setAttribute("doc-url", url);
    if (toolId) pv.setAttribute("tool-id", toolId);
    pv.style.cssText = "display:block;width:100%;height:100%;";
    host.append(pv);
  };
  field.oninput = () => { toolId = field.value.trim(); if (setConfig) setConfig({ toolId }); rebuild(); };
  // only rebuild on a URL change; same doc → leave the live view alone (it gets the ops itself)
  const off = inlets.doc && inlets.doc.connect ? inlets.doc.connect(() => { if (docUrlOf(inlets.doc) !== curUrl) rebuild(); }) : null;
  rebuild();
  return () => { if (off) off(); root.remove(); };
}
