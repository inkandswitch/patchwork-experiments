import { z } from "zod";
import { schemaKey, type JsonSchema } from "@embark/schema";

// The map's geo schemas, defined locally (packages own their schemas) and built
// from the same zod expressions the POI card and place resolver use, so
// `schemaKey` gives all consumers one shared SchemaQueries/SchemaMatches slot
// per shape without a central registry.

// A `{ lat, lon }` pair — "a place". The map drops a pin on each match; the POI
// card biases its search toward places the canvas already knows about.
export const LATLNG_JSON_SCHEMA = z.toJSONSchema(
  z.object({ lat: z.number(), lon: z.number() }),
) as unknown as JsonSchema;

export const LATLNG_KEY = schemaKey(LATLNG_JSON_SCHEMA);

// An ordered list of places — a path / route. The map draws each match as a
// polyline and renders markers only for its start and end.
export const LATLNG_LINE_JSON_SCHEMA = z.toJSONSchema(
  z.array(z.object({ lat: z.number(), lon: z.number() })),
) as unknown as JsonSchema;

export const LATLNG_LINE_KEY = schemaKey(LATLNG_LINE_JSON_SCHEMA);
