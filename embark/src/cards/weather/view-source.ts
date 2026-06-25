// The inline renderer for a weather `card`, shipped as a standalone ES module
// source string. The WeatherProvider writes this into a folder doc and the host
// service worker serves it, so the unified token renderer can `import()` it and
// run its default export (see ../../mention/extension.ts). It is plain browser
// JS: no bundler, no imports. The forecast is baked into the card's props, so
// this only reads and paints them. It draws a soft chip reading
// "<emoji> Weather in <place> <hi> / <lo>", sized to the editor's line height so
// it never grows the line, where <place> is a pill that resolves the linked
// place document's live title (via `element.repo`) and opens it on click.
export const VIEW_SOURCE = `
export default function view(element, handle) {
  var repo = element && element.repo;
  var placeOff = null;
  var gen = 0;

  function titleOf(doc) {
    doc = doc || {};
    var pw = doc["@patchwork"] || {};
    var props = doc.props || {};
    var place = doc.place || {};
    var candidates = [pw.title, props.name, place.name, doc.content, doc.title, doc.name];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (typeof c === "string" && c.trim()) return c;
    }
    return "";
  }

  // The place is rendered as a real mention pill: reuse the editor's
  // \`.cm-mention\` class (mention.css is always present here, since this face
  // only runs inside the unified token renderer) so it tracks the mention
  // token's look — including hover and dark mode — automatically.
  function makePill(text) {
    var pill = document.createElement("span");
    pill.className = "cm-mention";
    pill.textContent = text;
    return pill;
  }

  function render() {
    var myGen = ++gen;
    if (placeOff) { placeOff(); placeOff = null; }

    var doc = handle.doc() || {};
    var props = doc.props || {};
    element.replaceChildren();

    var card = document.createElement("span");
    card.className = "weather-embed";
    // Height is pinned to the editor's line box (24.8px) so the embed never
    // grows the line it sits on; vertical padding would, so there is none.
    card.style.cssText =
      "display:inline-flex;align-items:center;gap:8px;padding:0 10px;margin:0;" +
      "box-sizing:border-box;height:24.8px;" +
      "border:1px solid rgba(0,0,0,0.12);border-radius:12px;background:#ffffff;" +
      "box-shadow:0 1px 2px rgba(0,0,0,0.06);" +
      "font-family:system-ui,-apple-system,sans-serif;font-size:14px;font-weight:600;" +
      "line-height:1;color:#111827;vertical-align:middle;white-space:nowrap;";

    var icon = document.createElement("span");
    icon.textContent = props.emoji || "\u2601\ufe0f";
    icon.style.cssText = "font-size:15px;line-height:1;";

    // "Weather" stays dark; "in" is muted so the place reads as the subject.
    var lead = document.createElement("span");
    lead.appendChild(document.createTextNode("Weather "));
    var inWord = document.createElement("span");
    inWord.textContent = "in";
    inWord.style.color = "#6b7280";
    lead.appendChild(inWord);

    var place = makePill(props.place || "somewhere");
    var placeId = props.placeId;
    if (repo && typeof placeId === "string" && placeId) {
      place.addEventListener("click", function (event) {
        event.preventDefault();
        window.location.hash = "doc=" + encodeURIComponent(placeId);
      });
      Promise.resolve(repo.find("automerge:" + placeId)).then(function (h) {
        if (myGen !== gen) return;
        var paintTitle = function () {
          var t = titleOf(h.doc());
          if (t) place.textContent = t;
        };
        paintTitle();
        var onPlaceChange = function () { paintTitle(); };
        h.on("change", onPlaceChange);
        placeOff = function () { h.off("change", onPlaceChange); };
      }).catch(function () {});
    } else {
      // No linked place to open: keep the pill's look but drop the affordance.
      place.style.cursor = "default";
    }

    var temp = document.createElement("span");
    temp.style.cssText = "font-weight:600;color:#111827;letter-spacing:0.01em;";
    var hi = props.tempMax == null ? "" : Math.round(props.tempMax) + "\u00b0";
    var lo = props.tempMin == null ? "" : Math.round(props.tempMin) + "\u00b0";
    temp.textContent = hi && lo ? hi + " / " + lo : hi || lo || "\u2026";

    card.append(icon, lead, place, temp);
    if (props.summary) card.title = props.summary;
    element.append(card);
  }

  var onChange = function () { render(); };
  handle.on("change", onChange);
  render();
  return function cleanup() {
    gen++;
    handle.off("change", onChange);
    if (placeOff) { placeOff(); placeOff = null; }
    element.replaceChildren();
  };
}
`;
