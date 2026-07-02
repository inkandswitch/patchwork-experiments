import type { DocHandle } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { Show } from "solid-js";
import { render } from "solid-js/web";
import { RepoContext, useDocument } from "solid-automerge";
import type { PoiCardDoc } from "./datatype";

// The full-size board face for a poi-card: a read-only place card showing the
// name, its kind, and its coordinates. Styles are inline so the tool's lazily
// loaded chunk needs no separate CSS asset.
export const PoiCardView: ToolRender = (handle, element) => {
  return render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PoiCard handle={handle as DocHandle<PoiCardDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
};

function PoiCard(props: { handle: DocHandle<PoiCardDoc> }) {
  const [doc] = useDocument<PoiCardDoc>(() => props.handle.url);
  const name = () => doc()?.name || doc()?.["@patchwork"]?.title || "Place";
  const kind = () => doc()?.type;
  const coords = () => {
    const d = doc();
    if (!d || typeof d.lat !== "number" || typeof d.lon !== "number") return "";
    return `${d.lat.toFixed(4)}, ${d.lon.toFixed(4)}`;
  };

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        "justify-content": "center",
        gap: "10px",
        height: "100%",
        "box-sizing": "border-box",
        padding: "20px",
        "border-radius": "12px",
        background: "linear-gradient(160deg, #ffffff 0%, #f0fdf4 100%)",
        "font-family": "system-ui, -apple-system, sans-serif",
        color: "#1c1917",
        "user-select": "none",
        overflow: "hidden",
      }}
    >
      <div style={{ "font-size": "32px", "line-height": "1" }}>📍</div>
      <div
        style={{
          "font-size": "20px",
          "font-weight": "700",
          "text-align": "center",
          "line-height": "1.2",
        }}
      >
        {name()}
      </div>
      <Show when={kind()}>
        <div
          style={{
            "font-size": "12px",
            "letter-spacing": "0.04em",
            "text-transform": "uppercase",
            color: "#16a34a",
            "font-weight": "600",
          }}
        >
          {kind()}
        </div>
      </Show>
      <Show when={coords()}>
        <div
          style={{
            "font-family": "ui-monospace, SFMono-Regular, Menlo, monospace",
            "font-size": "12px",
            color: "#78716c",
          }}
        >
          {coords()}
        </div>
      </Show>
    </div>
  );
}
