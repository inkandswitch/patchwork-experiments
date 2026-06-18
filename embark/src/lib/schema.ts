import { z } from "zod";

// A selector can only carry JSON, so consumers ship a JSON Schema (zod 4's
// `z.toJSONSchema(mySchema)`) rather than a zod instance. The provider hydrates
// it back into a zod schema here and validates document subtrees with it.
//
// This covers the subset zod 4 emits (object/array/string/number/integer/
// boolean/null, enum, const, anyOf/oneOf/allOf, and `type` arrays); anything
// unrecognized degrades to `z.any()` so hydration never throws.
export type JsonSchema = boolean | { [key: string]: unknown };

export function jsonSchemaToZod(schema: JsonSchema): z.ZodType {
  // JSON Schema booleans: `true` accepts anything, `false` accepts nothing.
  if (schema === true) return z.any();
  if (schema === false) return z.never();
  if (typeof schema !== "object" || schema === null) return z.any();

  if ("const" in schema) return literal(schema.const);
  if (Array.isArray(schema.enum)) return unionOf(schema.enum.map(literal));
  if (Array.isArray(schema.anyOf)) return unionOf(schema.anyOf.map(toZod));
  if (Array.isArray(schema.oneOf)) return unionOf(schema.oneOf.map(toZod));
  if (Array.isArray(schema.allOf)) return intersectionOf(schema.allOf.map(toZod));

  const type = schema.type;
  if (Array.isArray(type)) return unionOf(type.map((t) => fromType(t, schema)));
  if (typeof type === "string") return fromType(type, schema);

  // Untyped but shaped like an object — treat it as one.
  if (schema.properties) return objectFromSchema(schema);
  return z.any();
}

function toZod(schema: unknown): z.ZodType {
  return jsonSchemaToZod(schema as JsonSchema);
}

function fromType(
  type: string,
  schema: { [key: string]: unknown },
): z.ZodType {
  switch (type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "boolean":
      return z.boolean();
    case "null":
      return z.null();
    case "array":
      return z.array(schema.items ? toZod(schema.items) : z.any());
    case "object":
      return objectFromSchema(schema);
    default:
      return z.any();
  }
}

// Objects are kept lenient (zod strips unknown keys but still validates the
// known ones), so a `{ lat, lon }` schema matches a richer `{ name, lat, lon,
// type }` node — exactly the "a sub-part matches" semantics we want.
function objectFromSchema(schema: { [key: string]: unknown }): z.ZodType {
  const properties = (schema.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );
  const shape: Record<string, z.ZodType> = {};
  for (const [key, sub] of Object.entries(properties)) {
    const zSub = jsonSchemaToZod(sub);
    shape[key] = required.has(key) ? zSub : zSub.optional();
  }
  return z.object(shape);
}

function literal(value: unknown): z.ZodType {
  if (value === null) return z.null();
  return z.literal(value as string | number | boolean);
}

function unionOf(options: z.ZodType[]): z.ZodType {
  if (options.length === 0) return z.never();
  if (options.length === 1) return options[0];
  return z.union(options as [z.ZodType, z.ZodType, ...z.ZodType[]]);
}

function intersectionOf(options: z.ZodType[]): z.ZodType {
  if (options.length === 0) return z.any();
  return options.reduce((acc, next) => z.intersection(acc, next));
}
