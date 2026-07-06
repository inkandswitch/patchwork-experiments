import { solidView } from "@embark/context";
import "./views.css";

// The `json-schema` context view: a schema-channel key (canonical schema JSON,
// see `schemaKey`) drawn as a compact structural face — `{ lat, lon }` for an
// object schema, `[{ lat, lon }]` for an array of them — with the full
// canonical JSON on hover.
export const jsonSchemaView = solidView((props) => {
  const key = String(props.value);
  return (
    <span class="embark-schema-face" title={key}>
      {schemaFace(key)}
    </span>
  );
});

// A short human face for a serialized schema: the shape's property names,
// recursing one level into arrays. Anything unparseable or unrecognized falls
// back to a truncated slice of the key itself.
function schemaFace(key: string): string {
  try {
    return face(JSON.parse(key));
  } catch {
    return clip(key);
  }
}

function face(schema: unknown): string {
  if (schema === null || typeof schema !== "object") return clip(String(schema));
  const node = schema as Record<string, unknown>;
  if (node.properties && typeof node.properties === "object") {
    return `{ ${Object.keys(node.properties).join(", ")} }`;
  }
  if (node.type === "array") {
    return node.items === undefined ? "[…]" : `[${face(node.items)}]`;
  }
  if (node.const !== undefined) return JSON.stringify(node.const);
  if (typeof node.type === "string") return node.type;
  return "schema";
}

function clip(text: string): string {
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}
