// A little HTML box: renders whatever its `html` inlet carries. A sink (no
// outlet). The last HTML is cached in the doc so a refresh still shows it even
// if the upstream source isn't producing yet. The HTML arrives over the wire
// from the SHARED doc (any collaborator can write it), so it renders in a fully
// sandboxed iframe — no scripts, no same-origin — where it's inert markup.
export function mountHtml({ element, inlets = {}, config = {}, setConfig }) {
  const box = document.createElement("div");
  box.className = "ns-htmlbox";
  element.append(box);
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", ""); // all restrictions: no allow-scripts, no allow-same-origin
  frame.style.cssText = "display:block;width:100%;height:100%;border:0;background:transparent;";
  box.append(frame);
  const s = inlets.html;
  const cached = typeof config.html === "string" ? config.html : "";
  let written = cached; // last value we persisted — compare against THIS, not the frozen mount-time config
  const render = () => {
    const v = s ? s.value : undefined;
    const html = typeof v === "string" ? v : v == null ? cached : String(v);
    frame.srcdoc = html;
    if (s && setConfig && html !== written) { written = html; setConfig({ html }); } // cache live input
  };
  const off = s && s.connect ? s.connect(render) : null;
  if (!s) frame.srcdoc = cached; // unwired ⇒ show the cached content
  else render();
  return () => { if (off) off(); box.remove(); };
}
