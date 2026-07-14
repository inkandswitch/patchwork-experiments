// Structural JSON-Schema matching, part of the schema vocabulary this package
// owns (alongside ./channels.js). A selector can only carry JSON, so consumers
// publish JSON Schemas; this module answers "does this value satisfy that
// schema?" without any schema library. It covers the subset zod 4's
// `z.toJSONSchema` emits — object/array/string/number/integer/boolean/null,
// enum, const, anyOf/oneOf/allOf, and `type` arrays — and anything
// unrecognized degrades to "matches", so a rogue schema never throws mid-pass.
//
// Objects are matched leniently (declared properties are validated, unknown
// keys are ignored), so a `{ lat, lon }` schema matches a richer
// `{ name, lat, lon, type }` node — exactly the "a sub-part matches" semantics
// schema matching wants.

/** @typedef {import("./channels.js").JsonSchema} JsonSchema */

/**
 * Whether `value` satisfies `schema`.
 * @param {JsonSchema} schema
 * @param {unknown} value
 * @returns {boolean}
 */
export function jsonSchemaMatches(schema, value) {
  // JSON Schema booleans: `true` accepts anything, `false` accepts nothing.
  if (schema === true) return true;
  if (schema === false) return false;
  if (typeof schema !== "object" || schema === null) return true;

  if ("const" in schema) return value === schema.const;
  if (Array.isArray(schema.enum)) return schema.enum.includes(value);
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.some((sub) => jsonSchemaMatches(sub, value));
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.some((sub) => jsonSchemaMatches(sub, value));
  }
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.every((sub) => jsonSchemaMatches(sub, value));
  }

  const type = schema.type;
  if (Array.isArray(type)) {
    return type.some((t) => matchesType(t, schema, value));
  }
  if (typeof type === "string") return matchesType(type, schema, value);

  // Untyped but shaped like an object — treat it as one.
  if (schema.properties) return matchesObject(schema, value);
  return true;
}

function matchesType(type, schema, value) {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && !Number.isNaN(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    case "array":
      return (
        Array.isArray(value) &&
        (schema.items === undefined ||
          value.every((item) => jsonSchemaMatches(schema.items, item)))
      );
    case "object":
      return matchesObject(schema, value);
    default:
      return true; // unrecognized type — degrade to "matches"
  }
}

function matchesObject(schema, value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  const properties = schema.properties ?? {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  for (const [key, sub] of Object.entries(properties)) {
    if (!(key in record)) {
      if (required.has(key)) return false;
      continue;
    }
    if (!jsonSchemaMatches(sub, record[key])) return false;
  }
  return true;
}
