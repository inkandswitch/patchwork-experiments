// The inline face for a weather `card`, a real source module built alongside the
// provider into this package's pushwork-synced `dist` (it used to live as a baked
// JS string written into a folder doc at runtime). The provider pins it via
// `new URL("./view.js", import.meta.url)` and bakes that onto each minted card's
// `viewUrl`, so the unified token renderer (`renderEmbedView`) imports and runs
// it. Dependency-free plain DOM (no bundler imports) so the built module loads
// straight as ESM. The forecast is baked into the card's props, so this only
// reads and paints them. It draws a soft chip reading
// "<emoji> Weather in <place> <hi> / <lo>", sized to the editor's line height so
// it never grows the line, where <place> is a pill that resolves the linked
// place document's live title (via `element.repo`) and opens it on click.

type DocLike = {
  doc: () => Record<string, unknown> | undefined;
  on: (event: "change", cb: () => void) => void;
  off: (event: "change", cb: () => void) => void;
};

type RepoLike = {
  find: (url: string) => DocLike | Promise<DocLike>;
};

type ElementLike = HTMLElement & { repo?: RepoLike };

export default function view(element: ElementLike, handle: DocLike) {
  const repo = element && element.repo;
  let placeOff: (() => void) | null = null;
  let gen = 0;

  function titleOf(doc: Record<string, unknown> | undefined): string {
    const d = (doc || {}) as Record<string, unknown>;
    const pw = (d["@patchwork"] || {}) as Record<string, unknown>;
    const props = (d.props || {}) as Record<string, unknown>;
    const place = (d.place || {}) as Record<string, unknown>;
    const candidates = [
      pw.title,
      props.name,
      place.name,
      d.content,
      d.title,
      d.name,
    ];
    for (const c of candidates) {
      if (typeof c === "string" && c.trim()) return c;
    }
    return "";
  }

  // The place is rendered as a real mention pill: reuse the editor's
  // `.cm-mention` class so it tracks the mention token's look (including hover
  // and dark mode) when this face runs inside the editor's token renderer.
  function makePill(text: string): HTMLSpanElement {
    const pill = document.createElement("span");
    pill.className = "cm-mention";
    pill.textContent = text;
    return pill;
  }

  function render() {
    const myGen = ++gen;
    if (placeOff) {
      placeOff();
      placeOff = null;
    }

    const doc = (handle.doc() || {}) as Record<string, unknown>;
    const props = (doc.props || {}) as Record<string, unknown>;
    element.replaceChildren();

    const card = document.createElement("span");
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

    const icon = document.createElement("span");
    icon.textContent = (props.emoji as string) || "\u2601\ufe0f";
    icon.style.cssText = "font-size:15px;line-height:1;";

    // "Weather" stays dark; "in" is muted so the place reads as the subject.
    const lead = document.createElement("span");
    lead.appendChild(document.createTextNode("Weather "));
    const inWord = document.createElement("span");
    inWord.textContent = "in";
    inWord.style.color = "#6b7280";
    lead.appendChild(inWord);

    const place = makePill((props.place as string) || "somewhere");
    const placeId = props.placeId;
    if (repo && typeof placeId === "string" && placeId) {
      place.addEventListener("click", (event) => {
        event.preventDefault();
        window.location.hash = "doc=" + encodeURIComponent(placeId);
      });
      Promise.resolve(repo.find("automerge:" + placeId))
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
      // No linked place to open: keep the pill's look but drop the affordance.
      place.style.cursor = "default";
    }

    const temp = document.createElement("span");
    temp.style.cssText = "font-weight:600;color:#111827;letter-spacing:0.01em;";
    const hi =
      props.tempMax == null
        ? ""
        : Math.round(props.tempMax as number) + "\u00b0";
    const lo =
      props.tempMin == null
        ? ""
        : Math.round(props.tempMin as number) + "\u00b0";
    temp.textContent = hi && lo ? hi + " / " + lo : hi || lo || "\u2026";

    card.append(icon, lead, place, temp);
    if (props.summary) card.title = props.summary as string;
    element.append(card);
  }

  const onChange = () => render();
  handle.on("change", onChange);
  render();
  return function cleanup() {
    gen++;
    handle.off("change", onChange);
    if (placeOff) {
      placeOff();
      placeOff = null;
    }
    element.replaceChildren();
  };
}
