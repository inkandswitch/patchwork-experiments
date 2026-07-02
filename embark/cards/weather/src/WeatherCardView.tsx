import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { Show } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import type { WeatherCardDoc } from "./datatype";

// The full-size board face for a weather-card: a read-only forecast card. The
// place name is resolved live from the linked poi-card. Inline styles so the
// lazily loaded chunk needs no separate CSS asset.
export const WeatherCardView: ToolRender = (handle, element) => {
  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <WeatherCard handle={handle as DocHandle<WeatherCardDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
};

function WeatherCard(props: { handle: DocHandle<WeatherCardDoc> }) {
  const [doc] = useDocument<WeatherCardDoc>(() => props.handle.url);
  const [place] = useDocument<{
    name?: string;
    "@patchwork"?: { title?: string };
  }>(() => doc()?.place);

  const placeName = () =>
    place()?.name ||
    place()?.["@patchwork"]?.title ||
    placeFromTitle(doc()?.["@patchwork"]?.title) ||
    "somewhere";
  const temps = () => {
    const d = doc();
    const hi = typeof d?.tempMax === "number" && !Number.isNaN(d.tempMax)
      ? `${Math.round(d.tempMax)}°`
      : "";
    const lo = typeof d?.tempMin === "number" && !Number.isNaN(d.tempMin)
      ? `${Math.round(d.tempMin)}°`
      : "";
    return hi && lo ? `${hi} / ${lo}` : hi || lo || "…";
  };

  return (
    <div
      style={{
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
      <div style={{ "font-size": "44px", "line-height": "1" }}>
        {doc()?.emoji || "⛅"}
      </div>
      <div style={{ "font-size": "13px", color: "#57534e" }}>
        Weather in
      </div>
      <div
        style={{
          "font-size": "22px",
          "font-weight": "700",
          "text-align": "center",
          "line-height": "1.2",
        }}
      >
        {placeName()}
      </div>
      <div style={{ "font-size": "20px", "font-weight": "600" }}>
        {temps()}
      </div>
      <Show when={doc()?.summary}>
        <div style={{ "font-size": "13px", color: "#57534e" }}>
          {doc()?.summary}
        </div>
      </Show>
      <Show when={doc()?.date}>
        <div
          style={{
            "font-size": "11px",
            "letter-spacing": "0.04em",
            "text-transform": "uppercase",
            color: "#a8a29e",
          }}
        >
          {doc()?.date}
        </div>
      </Show>
    </div>
  );
}

// "Weather in Berlin" → "Berlin"; any other title is returned unchanged. Used
// only as a fallback label before the linked place doc resolves (or when the
// card carries no place link).
function placeFromTitle(title: string | undefined): string {
  if (!title) return "";
  const match = /^weather in\s+(.+)$/i.exec(title);
  return match ? match[1] : title;
}
