// The inline renderer for a route `card`, shipped as a standalone ES module
// source string. The RouteProvider writes this into a folder doc and the host
// service worker serves it, so the unified token renderer can `import()` it and
// run its default export (see ../../mention/extension.ts). It is plain browser
// JS: no bundler, no imports. The route is baked into the card's props, so this
// only reads and paints them. It draws a soft chip reading
// "<emoji> <from> → <to> · <km> · <duration>", sized to the editor's line height
// so it never grows the line, where <from>/<to> are pills that resolve the
// linked place documents' live titles (via `element.repo`) and open them.
export const VIEW_SOURCE = `
export default function view(element, handle) {
  var repo = element && element.repo;
  var offs = [];
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

  function formatKm(km) {
    if (typeof km !== "number" || !isFinite(km)) return "";
    return (km < 10 ? km.toFixed(1) : Math.round(km)) + " km";
  }

  function formatDuration(seconds) {
    if (typeof seconds !== "number" || !isFinite(seconds)) return "";
    var total = Math.round(seconds / 60);
    var h = Math.floor(total / 60);
    var m = total % 60;
    return h > 0 ? h + " h " + m + " m" : m + " m";
  }

  // Each place is a real mention pill: reuse the editor's \`.cm-mention\` class
  // (mention.css is always present here, since this face only runs inside the
  // unified token renderer) so it tracks the mention token's look — hover and
  // dark mode — automatically.
  function makePill(text) {
    var pill = document.createElement("span");
    pill.className = "cm-mention";
    pill.textContent = text || "somewhere";
    return pill;
  }

  // Wire a pill to its linked place document: live title + click-to-open. The
  // returned cleanup detaches the change listener.
  function bindPlace(pill, placeId, myGen) {
    if (!repo || typeof placeId !== "string" || !placeId) {
      pill.style.cursor = "default";
      return function () {};
    }
    pill.addEventListener("click", function (event) {
      event.preventDefault();
      window.location.hash = "doc=" + encodeURIComponent(placeId);
    });
    var off = function () {};
    Promise.resolve(repo.find("automerge:" + placeId)).then(function (h) {
      if (myGen !== gen) return;
      var paint = function () {
        var t = titleOf(h.doc());
        if (t) pill.textContent = t;
      };
      paint();
      var onChange = function () { paint(); };
      h.on("change", onChange);
      off = function () { h.off("change", onChange); };
      offs.push(off);
    }).catch(function () {});
    return function () { off(); };
  }

  function render() {
    var myGen = ++gen;
    for (var i = 0; i < offs.length; i++) offs[i]();
    offs = [];

    var doc = handle.doc() || {};
    var props = doc.props || {};
    element.replaceChildren();

    var card = document.createElement("span");
    card.className = "route-embed";
    // Height is pinned to the editor's line box (24.8px) so the embed never
    // grows the line it sits on; vertical padding would, so there is none.
    card.style.cssText =
      "display:inline-flex;align-items:center;gap:6px;padding:0 10px;margin:0;" +
      "box-sizing:border-box;height:24.8px;" +
      "border:1px solid rgba(0,0,0,0.12);border-radius:12px;background:#ffffff;" +
      "box-shadow:0 1px 2px rgba(0,0,0,0.06);" +
      "font-family:system-ui,-apple-system,sans-serif;font-size:14px;font-weight:600;" +
      "line-height:1;color:#111827;vertical-align:middle;white-space:nowrap;";

    var icon = document.createElement("span");
    icon.textContent = props.emoji || "\ud83d\uddfa\ufe0f";
    icon.style.cssText = "font-size:15px;line-height:1;";

    var from = makePill(props.from);
    bindPlace(from, props.fromId, myGen);

    var arrow = document.createElement("span");
    arrow.textContent = "\u2192";
    arrow.style.color = "#6b7280";

    var to = makePill(props.to);
    bindPlace(to, props.toId, myGen);

    var meta = document.createElement("span");
    meta.style.cssText = "color:#6b7280;font-weight:600;";
    var bits = [formatKm(props.distanceKm), formatDuration(props.durationS)].filter(Boolean);
    meta.textContent = bits.length ? " \u00b7 " + bits.join(" \u00b7 ") : "";

    card.append(icon, from, arrow, to, meta);
    if (props.mode) card.title = props.mode + " route";
    element.append(card);
  }

  var onChange = function () { render(); };
  handle.on("change", onChange);
  render();
  return function cleanup() {
    gen++;
    handle.off("change", onChange);
    for (var i = 0; i < offs.length; i++) offs[i]();
    offs = [];
    element.replaceChildren();
  };
}
`;
