// The inline token face for a weather-card: a compact chip reading
// "<emoji> Weather in <place> <hi> / <lo>", sized to the editor's line box so it
// never grows the line it sits on. <place> is a mention-style pill that resolves
// the linked poi-card's live title (via `element.repo`) and opens it on click.
// Plain DOM with inline styles; the `(handle, element)` signature is the
// standard tool contract the token renderer and `<patchwork-view>` both call.

import { parseAutomergeUrl } from "@automerge/automerge-repo";

export const WeatherCardToken = (handle, element) => {
  const repo = element.repo;
  let placeOff = null;
  let gen = 0;

  const paint = () => {
    const myGen = ++gen;
    if (placeOff) {
      placeOff();
      placeOff = null;
    }

    const doc = handle.doc() || {};
    element.replaceChildren();

    const chip = document.createElement("span");
    chip.style.cssText =
      "display:inline-flex;align-items:center;gap:8px;padding:0 10px;margin:0;" +
      "box-sizing:border-box;height:24.8px;" +
      "border:1px solid rgba(0,0,0,0.12);border-radius:12px;background:#ffffff;" +
      "box-shadow:0 1px 2px rgba(0,0,0,0.06);" +
      "font-family:system-ui,-apple-system,sans-serif;font-size:14px;font-weight:600;" +
      "line-height:1;color:#111827;vertical-align:middle;white-space:nowrap;";

    const icon = document.createElement("span");
    icon.textContent = doc.emoji || "⛅";
    icon.style.cssText = "font-size:15px;line-height:1;";

    const lead = document.createElement("span");
    lead.appendChild(document.createTextNode("Weather "));
    const inWord = document.createElement("span");
    inWord.textContent = "in";
    inWord.style.color = "#6b7280";
    lead.appendChild(inWord);

    const titleHint =
      typeof doc["@patchwork"]?.title === "string"
        ? placeFromTitle(doc["@patchwork"].title)
        : "";
    const place = makePill(titleHint || "somewhere");
    const placeUrl = doc.place;
    if (repo && typeof placeUrl === "string" && placeUrl) {
      const documentId = documentIdOf(placeUrl);
      if (documentId) {
        place.addEventListener("click", (event) => {
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
            if (t) place.textContent = t;
          };
          paintTitle();
          const onPlaceChange = () => paintTitle();
          h.on("change", onPlaceChange);
          placeOff = () => h.off("change", onPlaceChange);
        })
        .catch(() => {});
    } else {
      place.style.cursor = "default";
    }

    const temp = document.createElement("span");
    temp.style.cssText = "font-weight:600;color:#111827;letter-spacing:0.01em;";
    const hi = doc.tempMax == null ? "" : Math.round(doc.tempMax) + "°";
    const lo = doc.tempMin == null ? "" : Math.round(doc.tempMin) + "°";
    temp.textContent = hi && lo ? hi + " / " + lo : hi || lo || "…";

    chip.append(icon, lead, place, temp);
    if (doc.summary) chip.title = doc.summary;
    element.append(chip);
  };

  const onChange = () => paint();
  handle.on("change", onChange);
  paint();
  return () => {
    gen++;
    handle.off("change", onChange);
    if (placeOff) {
      placeOff();
      placeOff = null;
    }
    element.replaceChildren();
  };
};

// Reuse the editor's `.cm-mention` class so the pill tracks the mention token's
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

function placeFromTitle(title) {
  const match = /^weather in\s+(.+)$/i.exec(title);
  return match ? match[1] : title;
}

// The bare documentId of an `automerge:` url, for the `#doc=<id>` hash route.
function documentIdOf(url) {
  try {
    return parseAutomergeUrl(url).documentId;
  } catch {
    return null;
  }
}
