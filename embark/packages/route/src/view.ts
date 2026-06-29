// The inline face for a route `card`, a real source module built alongside the
// provider into this package's pushwork-synced `dist` (it used to live as a baked
// JS string written into a folder doc at runtime). The provider pins it via
// `new URL("./view.js", moduleUrl)` and bakes that onto each minted card's
// `viewUrl`, so the unified token renderer (`renderEmbedView`) imports and runs
// it. Dependency-free plain DOM (no bundler imports) so the built module loads
// straight as ESM. The route is baked into the card's props, so this only reads
// and paints them: a soft chip reading "<emoji> <from> -> <to> . <km> .
// <duration>", sized to the editor's line height so it never grows the line,
// where <from>/<to> are pills that resolve the linked place documents' live
// titles (via `element.repo`) and open them on click.

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
  let offs: Array<() => void> = [];
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

  function formatKm(km: unknown): string {
    if (typeof km !== "number" || !isFinite(km)) return "";
    return (km < 10 ? km.toFixed(1) : Math.round(km)) + " km";
  }

  function formatDuration(seconds: unknown): string {
    if (typeof seconds !== "number" || !isFinite(seconds)) return "";
    const total = Math.round(seconds / 60);
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? h + " h " + m + " m" : m + " m";
  }

  // Each place is a real mention pill: reuse the editor's `.cm-mention` class so
  // it tracks the mention token's look — hover and dark mode — automatically.
  function makePill(text: unknown): HTMLSpanElement {
    const pill = document.createElement("span");
    pill.className = "cm-mention";
    pill.textContent = (text as string) || "somewhere";
    return pill;
  }

  // Wire a pill to its linked place document: live title + click-to-open.
  function bindPlace(pill: HTMLSpanElement, placeId: unknown, myGen: number) {
    if (!repo || typeof placeId !== "string" || !placeId) {
      pill.style.cursor = "default";
      return;
    }
    pill.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.hash = "doc=" + encodeURIComponent(placeId);
    });
    Promise.resolve(repo.find("automerge:" + placeId))
      .then((h) => {
        if (myGen !== gen) return;
        const paint = () => {
          const t = titleOf(h.doc());
          if (t) pill.textContent = t;
        };
        paint();
        const onChange = () => paint();
        h.on("change", onChange);
        offs.push(() => h.off("change", onChange));
      })
      .catch(() => {});
  }

  function render() {
    const myGen = ++gen;
    for (const off of offs) off();
    offs = [];

    const doc = (handle.doc() || {}) as Record<string, unknown>;
    const props = (doc.props || {}) as Record<string, unknown>;
    element.replaceChildren();

    const card = document.createElement("span");
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

    const icon = document.createElement("span");
    icon.textContent = (props.emoji as string) || "\ud83d\uddfa\ufe0f";
    icon.style.cssText = "font-size:15px;line-height:1;";

    const from = makePill(props.from);
    bindPlace(from, props.fromId, myGen);

    const arrow = document.createElement("span");
    arrow.textContent = "\u2192";
    arrow.style.color = "#6b7280";

    const to = makePill(props.to);
    bindPlace(to, props.toId, myGen);

    const meta = document.createElement("span");
    meta.style.cssText = "color:#6b7280;font-weight:600;";
    const bits = [
      formatKm(props.distanceKm),
      formatDuration(props.durationS),
    ].filter(Boolean);
    meta.textContent = bits.length ? " \u00b7 " + bits.join(" \u00b7 ") : "";

    card.append(icon, from, arrow, to, meta);
    if (props.mode) card.title = (props.mode as string) + " route";
    element.append(card);
  }

  const onChange = () => render();
  handle.on("change", onChange);
  render();
  return function cleanup() {
    gen++;
    handle.off("change", onChange);
    for (const off of offs) off();
    offs = [];
    element.replaceChildren();
  };
}
