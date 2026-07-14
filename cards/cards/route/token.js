// The inline token face for a route-card: a compact chip reading
// "<emoji> <from> → <to> · <km> · <duration>", sized to the editor's line box so
// it never grows the line. <from>/<to> are mention-style pills that resolve the
// linked poi-cards' live titles (via `element.repo`) and open them on click.
// Plain DOM with inline styles; the `(handle, element)` signature is the
// standard tool contract the token renderer and `<patchwork-view>` both call.

import { parseAutomergeUrl } from "@automerge/automerge-repo";

export const RouteCardToken = (handle, element) => {
  const repo = element.repo;
  let offs = [];
  let gen = 0;

  const paint = () => {
    const myGen = ++gen;
    for (const off of offs) off();
    offs = [];

    const doc = handle.doc() || {};
    element.replaceChildren();

    const ends =
      typeof doc["@patchwork"]?.title === "string"
        ? placesFromTitle(doc["@patchwork"].title)
        : { from: "", to: "" };

    const chip = document.createElement("span");
    chip.style.cssText =
      "display:inline-flex;align-items:center;gap:6px;padding:0 10px;margin:0;" +
      "box-sizing:border-box;height:24.8px;" +
      "border:1px solid rgba(0,0,0,0.12);border-radius:12px;background:#ffffff;" +
      "box-shadow:0 1px 2px rgba(0,0,0,0.06);" +
      "font-family:system-ui,-apple-system,sans-serif;font-size:14px;font-weight:600;" +
      "line-height:1;color:#111827;vertical-align:middle;white-space:nowrap;";

    const icon = document.createElement("span");
    icon.textContent = doc.emoji || "🗺️";
    icon.style.cssText = "font-size:15px;line-height:1;";

    const from = makePill(ends.from || "somewhere");
    bindPlace(from, doc.from, myGen);

    const arrow = document.createElement("span");
    arrow.textContent = "→";
    arrow.style.color = "#6b7280";

    const to = makePill(ends.to || "somewhere");
    bindPlace(to, doc.to, myGen);

    const meta = document.createElement("span");
    meta.style.cssText = "color:#6b7280;font-weight:600;";
    const bits = [formatKm(doc.distanceKm), formatDuration(doc.duration)].filter(
      Boolean,
    );
    meta.textContent = bits.length ? " · " + bits.join(" · ") : "";

    chip.append(icon, from, arrow, to, meta);
    if (doc.mode) chip.title = doc.mode + " route";
    element.append(chip);
  };

  // Wire a pill to its linked place doc: live title + click-to-open.
  function bindPlace(pill, placeUrl, myGen) {
    if (!repo || typeof placeUrl !== "string" || !placeUrl) {
      pill.style.cursor = "default";
      return;
    }
    const documentId = documentIdOf(placeUrl);
    if (documentId) {
      pill.addEventListener("click", (event) => {
        event.preventDefault();
        window.location.hash = "doc=" + encodeURIComponent(documentId);
      });
    }
    repo
      .find(placeUrl)
      .then((h) => {
        if (myGen !== gen) return;
        const paintTitle = () => {
          const t = titleOf(h.doc());
          if (t) pill.textContent = t;
        };
        paintTitle();
        const onChange = () => paintTitle();
        h.on("change", onChange);
        offs.push(() => h.off("change", onChange));
      })
      .catch(() => {});
  }

  const onChange = () => paint();
  handle.on("change", onChange);
  paint();
  return () => {
    gen++;
    handle.off("change", onChange);
    for (const off of offs) off();
    offs = [];
    element.replaceChildren();
  };
};

// Reuse the editor's `.cm-mention` class so each pill tracks the mention token's
// look (hover, dark mode) automatically when this face runs inline.
function makePill(text) {
  const pill = document.createElement("span");
  pill.className = "cm-mention";
  pill.textContent = text;
  return pill;
}

function titleOf(doc) {
  const d = doc || {};
  const pw = d["@patchwork"] || {};
  const candidates = [pw.title, d.name, d.title];
  for (const c of candidates) {
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
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? h + " h " + m + " m" : m + " m";
}

function placesFromTitle(title) {
  const match = /^[^:]*:\s*(.+?)\s*→\s*(.+)$/.exec(title);
  if (!match) return { from: "", to: "" };
  return { from: match[1], to: match[2] };
}

// The bare documentId of an `automerge:` url, for the `#doc=<id>` hash route.
function documentIdOf(url) {
  try {
    return parseAutomergeUrl(url).documentId;
  } catch {
    return null;
  }
}
