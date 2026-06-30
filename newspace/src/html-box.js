// A little HTML box: sets its innerHTML to whatever its `html` inlet carries. A
// sink (no outlet). The last HTML is cached in the doc so a refresh still shows it
// even if the upstream source isn't producing yet. It's your own canvas, so
// arbitrary markup is fine.
export function mountHtml({ element, inlets = {}, config = {}, setConfig }) {
  const box = document.createElement("div");
  box.className = "ns-htmlbox";
  element.append(box);
  const s = inlets.html;
  const cached = typeof config.html === "string" ? config.html : "";
  const render = () => {
    const v = s ? s.value : undefined;
    const html = typeof v === "string" ? v : v == null ? cached : String(v);
    box.innerHTML = html;
    if (s && setConfig && html !== config.html) setConfig({ html }); // cache live input
  };
  const off = s && s.connect ? s.connect(render) : null;
  if (!s) box.innerHTML = cached; // unwired ⇒ show the cached content
  else render();
  return () => { if (off) off(); box.remove(); };
}
