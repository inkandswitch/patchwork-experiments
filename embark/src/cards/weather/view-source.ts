// The inline renderer for a weather `card`, shipped as a standalone ES module
// source string. The WeatherProvider writes this into a folder doc and the host
// service worker serves it, so the command embed can `import()` it and run its
// default export (see ../../commands/command-embed.ts). It is plain browser JS:
// no bundler, no imports. The provider bakes the forecast into the card's props,
// so this only reads and paints them (and re-paints on change).
export const VIEW_SOURCE = `
export default function view(element, handle) {
  const render = () => {
    const doc = handle.doc() || {};
    const props = doc.props || {};
    element.replaceChildren();

    const card = document.createElement("span");
    card.className = "weather-embed";
    card.style.cssText =
      "display:inline-flex;align-items:center;gap:6px;padding:2px 9px;margin:0 1px;" +
      "border:1px solid #e7e5e4;border-radius:9px;" +
      "background:linear-gradient(160deg,#eff6ff 0%,#fef9c3 100%);" +
      "font:600 13px system-ui,-apple-system,sans-serif;color:#1c1917;" +
      "vertical-align:baseline;white-space:nowrap;";

    const icon = document.createElement("span");
    icon.textContent = props.emoji || "\u26c5";
    icon.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.textContent = props.place || "Weather";

    const temp = document.createElement("span");
    temp.style.cssText = "font-weight:500;color:#57534e;";
    const hi = props.tempMax == null ? "" : Math.round(props.tempMax) + "\u00b0";
    const lo = props.tempMin == null ? "" : Math.round(props.tempMin) + "\u00b0";
    temp.textContent = hi && lo ? hi + " / " + lo : hi || lo || "\u2026";

    card.append(icon, name, temp);
    if (props.summary) card.title = props.summary;
    element.append(card);
  };

  const onChange = () => render();
  handle.on("change", onChange);
  render();
  return function cleanup() {
    handle.off("change", onChange);
    element.replaceChildren();
  };
}
`;
