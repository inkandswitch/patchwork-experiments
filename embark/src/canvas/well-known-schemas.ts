import { z } from "zod";
import { schemaKey, type SchemaQuery } from "./channels";
import type { JsonSchema } from "../lib/schema";

// Schemas that more than one consumer correlates on, kept in one place so they
// share a single `SchemaMatches` key. The schema travels as JSON Schema (the
// channel payload type); the canvas resolver hydrates it back to zod.

// A `{ lat, lon }` pair — the canvas's notion of "a place". The map drops a pin
// on each match; the POI card uses the same matches to bias its search toward
// places the canvas already knows about.
export const LATLNG_JSON_SCHEMA = z.toJSONSchema(
  z.object({ lat: z.number(), lon: z.number() }),
) as unknown as JsonSchema;

export const LATLNG_KEY = schemaKey(LATLNG_JSON_SCHEMA);

// The named query consumers publish into `SchemaQueries` (the name labels the
// section in the context viewer's schema view).
export const LATLNG_QUERY: SchemaQuery = {
  name: "Geo positions",
  schema: LATLNG_JSON_SCHEMA,
};
