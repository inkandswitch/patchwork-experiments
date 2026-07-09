// The full-size board face for a bird-card, also shown in the map's hover
// popup: a photo of the bird, its common and scientific names, the sighting
// facts, and a link to eBird to learn more. Solid via `solid-js/html` (no
// JSX); styles are inline so the module needs no separate CSS asset.

import { Show, createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";

export const BirdCardView = (handle, element) => {
  return render(() => BirdCard({ handle }), element);
};

function BirdCard(props) {
  const [doc, setDoc] = createSignal(props.handle.doc());
  const sync = () => setDoc(props.handle.doc());
  props.handle.on("change", sync);
  onCleanup(() => props.handle.off("change", sync));

  const name = () => doc()?.name || doc()?.["@patchwork"]?.title || "Bird";
  const facts = () => {
    const d = doc();
    if (!d) return "";
    const parts = [];
    if (d.howMany && d.howMany > 1) parts.push(`${d.howMany} seen`);
    if (d.locName) parts.push(d.locName);
    if (d.obsDt) parts.push(formatObsDate(d.obsDt));
    return parts.join(" · ");
  };

  return html`<div
    style=${{
      position: "relative",
      display: "flex",
      "flex-direction": "column",
      height: "100%",
      "box-sizing": "border-box",
      "border-radius": "12px",
      background: "linear-gradient(160deg, #ffffff 0%, #f0f9ff 100%)",
      "font-family": "system-ui, -apple-system, sans-serif",
      color: "#0f172a",
      "user-select": "none",
      overflow: "hidden",
    }}
  >
    <${Show}
      when=${() => doc()?.imageUrl}
      fallback=${html`<div
        style=${{
          display: "flex",
          "align-items": "center",
          "justify-content": "center",
          width: "100%",
          "min-height": "120px",
          flex: "1 1 auto",
          "font-size": "48px",
          background: "#e0f2fe",
        }}
      >
        🐦
      </div>`}
    >
      <img
        src=${() => doc()?.imageUrl}
        alt=${name}
        style=${{
          width: "100%",
          flex: "1 1 auto",
          "min-height": "0",
          "object-fit": "cover",
        }}
      />
    <//>

    <div
      style=${{
        display: "flex",
        "flex-direction": "column",
        gap: "3px",
        padding: "12px 14px",
      }}
    >
      <div style=${{ "font-size": "17px", "font-weight": "700" }}>${name}</div>
      <${Show} when=${() => doc()?.sciName}>
        <div
          style=${{
            "font-size": "12px",
            "font-style": "italic",
            color: "#64748b",
          }}
        >
          ${() => doc()?.sciName}
        </div>
      <//>
      <${Show} when=${facts}>
        <div style=${{ "font-size": "12px", color: "#475569" }}>${facts}</div>
      <//>
      <${Show} when=${() => doc()?.learnMoreUrl}>
        <a
          href=${() => doc()?.learnMoreUrl}
          target="_blank"
          rel="noreferrer"
          style=${{
            "margin-top": "4px",
            "font-size": "12px",
            "font-weight": "600",
            color: "#0284c7",
            "text-decoration": "none",
          }}
        >
          Learn more →
        </a>
      <//>
    </div>
  </div>`;
}

// eBird timestamps look like "2017-08-23 22:30" (or just a date). Render a
// short friendly form, falling back to the raw string if it doesn't parse.
function formatObsDate(obsDt) {
  const parsed = new Date(obsDt.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return obsDt;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
