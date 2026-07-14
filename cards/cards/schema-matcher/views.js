// The `json-schema` context view: a schema-channel key (canonical schema JSON,
// see `schemaKey` in ./channels.js) drawn as a compact structural face —
// `{ lat, lon }` for an object schema, `[{ lat, lon }]` for an array of them —
// with the full canonical JSON on hover.
//
// Loaded lazily through this package's `json-schema-context-view` plugin.

/** @type {(element: HTMLElement, value: unknown) => () => void} */
export const jsonSchemaView = (element, value) => {
  injectStyles();
  const key = String(value);
  const chip = document.createElement("span");
  chip.className = "embark-schema-face";
  chip.title = key;
  chip.textContent = schemaFace(key);
  element.appendChild(chip);
  return () => chip.remove();
};

// A short human face for a serialized schema: the shape's property names,
// recursing one level into arrays. Anything unparseable or unrecognized falls
// back to a truncated slice of the key itself.
function schemaFace(key) {
  try {
    return face(JSON.parse(key));
  } catch {
    return clip(key);
  }
}

function face(schema) {
  if (schema === null || typeof schema !== "object") return clip(String(schema));
  if (schema.properties && typeof schema.properties === "object") {
    return `{ ${Object.keys(schema.properties).join(", ")} }`;
  }
  if (schema.type === "array") {
    return schema.items === undefined ? "[…]" : `[${face(schema.items)}]`;
  }
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (typeof schema.type === "string") return schema.type;
  return "schema";
}

function clip(text) {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

// --- Styles --------------------------------------------------------------------

const STYLE_ID = "embark-schema-view-css";

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
.embark-schema-face {
  padding: 2px 8px;
  border: 1px solid #cbd2da;
  border-radius: 8px;
  font-size: 11px;
  color: #6b7280;
  background: #f7f8fa;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  white-space: nowrap;
}
`;
