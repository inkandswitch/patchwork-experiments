import { z } from "zod";
import { schemaKey, type JsonSchema } from "@embark/schema";

// An ordered list of `{ lat, lon }` places — a path / route. Packages define
// their own schemas and correlate purely by structural identity: this card and
// the route card build the schema from the *same* zod expression, so
// `schemaKey` gives them one shared SchemaMatches slot without a central
// registry.
export const LATLNG_LINE_JSON_SCHEMA = z.toJSONSchema(
  z.array(z.object({ lat: z.number(), lon: z.number() })),
) as unknown as JsonSchema;

export const LATLNG_LINE_KEY = schemaKey(LATLNG_LINE_JSON_SCHEMA);
