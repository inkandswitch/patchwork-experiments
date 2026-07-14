// Generic JSON card behavior, loaded by the shared card shell. The
// page-extractor card mints one of these per extracted record, spreading the
// record's fields at the document root (so `lat`, `long`, `price`, … are
// top-level properties other tools can read); this module shows those
// fields, pretty-printed, hiding the card chrome. Plain-JS bundleless module
// with no imports at all.

// The chrome fields the shell owns, hidden from the rendered JSON. Mirrors
// RESERVED_CARD_FIELDS in src/card.tsx.
const RESERVED_CARD_FIELDS = new Set([
  "@patchwork",
  "src",
  "description",
  "icon",
  "accent",
  "flipped",
]);

export default function card(handle, element) {
  const style = document.createElement("style");
  style.textContent = css;
  const root = document.createElement("pre");
  root.className = "json-card";
  element.append(style, root);

  const render = () => {
    const doc = handle.doc() ?? {};
    const fields = Object.fromEntries(
      Object.entries(doc).filter(([key]) => !RESERVED_CARD_FIELDS.has(key)),
    );
    // Older mints stored the record under `data`; show it the same way.
    const record = "data" in fields ? fields.data : fields;
    root.textContent = JSON.stringify(record, null, 2);
  };
  handle.on("change", render);
  render();

  return () => {
    handle.off("change", render);
    root.remove();
    style.remove();
  };
}

const css = `
@layer package {
  :root,
  :host,
  [theme] {
    --json-card-fg: var(--editor-line, #222);
    --json-card-family-code: var(--editor-family-code, ui-monospace, monospace);
  }
}

.json-card {
  margin: 0;
  height: 100%;
  box-sizing: border-box;
  overflow: auto;
  font-family: var(--json-card-family-code);
  font-size: 0.7rem;
  line-height: 1.5;
  color: var(--json-card-fg);
  white-space: pre-wrap;
  word-break: break-word;
}
`;
