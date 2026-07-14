// The full-size board face for a route-card: a read-only trip card. The
// endpoint names are resolved live from the linked poi-cards. Solid via
// `solid-js/html` (no JSX); styles are inline so the module needs no separate
// CSS asset.

import { Show, createEffect, createSignal, onCleanup } from "solid-js";
import { render } from "solid-js/web";
import html from "solid-js/html";

export const RouteCardView = (handle, element) => {
  return render(() => RouteCard({ handle, repo: element.repo }), element);
};

function RouteCard(props) {
  const [doc, setDoc] = createSignal(props.handle.doc());
  const sync = () => setDoc(props.handle.doc());
  props.handle.on("change", sync);
  onCleanup(() => props.handle.off("change", sync));

  const from = useLinkedDoc(props.repo, () => doc()?.from);
  const to = useLinkedDoc(props.repo, () => doc()?.to);

  const ends = () => placesFromTitle(doc()?.["@patchwork"]?.title);
  const fromName = () =>
    from()?.name || from()?.["@patchwork"]?.title || ends().from || "from";
  const toName = () =>
    to()?.name || to()?.["@patchwork"]?.title || ends().to || "to";
  const meta = () => {
    const d = doc();
    return [formatKm(d?.distanceKm), formatDuration(d?.duration)]
      .filter(Boolean)
      .join(" · ");
  };

  return html`<div
    style=${{
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
      background: "linear-gradient(160deg, #ecfeff 0%, #d1fae5 100%)",
      "font-family": "system-ui, -apple-system, sans-serif",
      color: "#1c1917",
      "user-select": "none",
      overflow: "hidden",
    }}
  >
    <div style=${{ "font-size": "32px", "line-height": "1" }}>
      ${() => doc()?.emoji || "🗺️"}
    </div>
    <div
      style=${{
        display: "flex",
        "align-items": "center",
        gap: "8px",
        "font-size": "18px",
        "font-weight": "700",
        "text-align": "center",
        "flex-wrap": "wrap",
        "justify-content": "center",
      }}
    >
      <span>${fromName}</span>
      <span style=${{ color: "#0d9488" }}>→</span>
      <span>${toName}</span>
    </div>
    <${Show} when=${meta}>
      <div style=${{ "font-size": "14px", color: "#57534e" }}>${meta}</div>
    <//>
  </div>`;
}

// A signal for a linked document, resolved live (the link may arrive or change
// after mount, and the linked doc's contents can change too).
function useLinkedDoc(repo, url) {
  const [value, setValue] = createSignal(undefined);
  createEffect(() => {
    const target = url();
    if (!target) {
      setValue(undefined);
      return;
    }
    let cancelled = false;
    let off;
    void Promise.resolve(repo.find(target))
      .then((h) => {
        if (cancelled) return;
        const update = () => setValue(h.doc());
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
  return value;
}

// "504 km" / "3.2 km" (one decimal under 10 km), or "" for an unknown distance.
function formatKm(km) {
  if (typeof km !== "number" || !Number.isFinite(km)) return "";
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

// Seconds as "5 h 12 m" / "12 m", or "" for an unknown duration.
function formatDuration(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "";
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} m` : `${m} m`;
}

// Pull the two place labels out of a "<mode>: <from> → <to>" title; used only as
// a fallback before the linked place docs resolve (or when links are missing).
function placesFromTitle(title) {
  if (!title) return { from: "", to: "" };
  const match = /^[^:]*:\s*(.+?)\s*→\s*(.+)$/.exec(title);
  if (!match) return { from: "", to: "" };
  return { from: match[1], to: match[2] };
}
