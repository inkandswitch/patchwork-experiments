// The full-size board face for a weather-card: a read-only forecast card. The
// place name is resolved live from the linked poi-card. Solid via
// `solid-js/html` (no JSX); styles are inline so the module needs no separate
// CSS asset.

import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";

export const WeatherCardView = (handle, element) => {
  return render(() => WeatherCard({ handle, repo: element.repo }), element);
};

function WeatherCard(props) {
  const [doc, setDoc] = createSignal(props.handle.doc());
  const sync = () => setDoc(props.handle.doc());
  props.handle.on("change", sync);
  onCleanup(() => props.handle.off("change", sync));

  // The linked place doc, resolved live (it may arrive or change after mount).
  const [place, setPlace] = createSignal(undefined);
  createEffect(() => {
    const url = doc()?.place;
    if (!url) {
      setPlace(undefined);
      return;
    }
    let cancelled = false;
    let off;
    void Promise.resolve(props.repo.find(url))
      .then((h) => {
        if (cancelled) return;
        const update = () => setPlace(h.doc());
        update();
        h.on("change", update);
        off = () => h.off("change", update);
      })
      .catch(() => {});
    onCleanup(() => {
      cancelled = true;
      off?.();
    });
  });

  const placeName = () =>
    place()?.name ||
    place()?.["@patchwork"]?.title ||
    placeFromTitle(doc()?.["@patchwork"]?.title) ||
    "somewhere";
  const temps = () => {
    const d = doc();
    const hi =
      typeof d?.tempMax === "number" && !Number.isNaN(d.tempMax)
        ? `${Math.round(d.tempMax)}°`
        : "";
    const lo =
      typeof d?.tempMin === "number" && !Number.isNaN(d.tempMin)
        ? `${Math.round(d.tempMin)}°`
        : "";
    return hi && lo ? `${hi} / ${lo}` : hi || lo || "…";
  };

  return html`<div
    style=${{
      position: "relative",
      display: "flex",
      "flex-direction": "column",
      "align-items": "center",
      "justify-content": "center",
      gap: "8px",
      height: "100%",
      "box-sizing": "border-box",
      padding: "20px",
      "border-radius": "12px",
      background: "linear-gradient(160deg, #eff6ff 0%, #fef9c3 100%)",
      "font-family": "system-ui, -apple-system, sans-serif",
      color: "#1c1917",
      "user-select": "none",
      overflow: "hidden",
    }}
  >
    <div style=${{ "font-size": "44px", "line-height": "1" }}>
      ${() => doc()?.emoji || "⛅"}
    </div>
    <div style=${{ "font-size": "13px", color: "#57534e" }}>Weather in</div>
    <div
      style=${{
        "font-size": "22px",
        "font-weight": "700",
        "text-align": "center",
        "line-height": "1.2",
      }}
    >
      ${placeName}
    </div>
    <div style=${{ "font-size": "20px", "font-weight": "600" }}>${temps}</div>
    <${Show} when=${() => doc()?.summary}>
      <div style=${{ "font-size": "13px", color: "#57534e" }}>
        ${() => doc()?.summary}
      </div>
    <//>
    <${Show} when=${() => doc()?.date}>
      <div
        style=${{
          "font-size": "11px",
          "letter-spacing": "0.04em",
          "text-transform": "uppercase",
          color: "#a8a29e",
        }}
      >
        ${() => doc()?.date}
      </div>
    <//>
  </div>`;
}

// "Weather in Berlin" → "Berlin"; any other title is returned unchanged. Used
// only as a fallback label before the linked place doc resolves (or when the
// card carries no place link).
function placeFromTitle(title) {
  if (!title) return "";
  const match = /^weather in\s+(.+)$/i.exec(title);
  return match ? match[1] : title;
}
