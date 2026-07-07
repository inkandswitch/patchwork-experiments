import { z } from "zod";
import { schemaKey, type JsonSchema } from "@embark/schema";

// A `{ lat, lon }` pair — this card's notion of "a place". Packages define
// their own schemas and correlate purely by structural identity: this card,
// the POI card, and the place resolver all build the schema from the *same*
// zod expression, so `schemaKey` gives them one shared SchemaMatches slot
// without a central registry.
export const LATLNG_JSON_SCHEMA = z.toJSONSchema(
  z.object({ lat: z.number(), lon: z.number() }),
) as unknown as JsonSchema;

export const LATLNG_KEY = schemaKey(LATLNG_JSON_SCHEMA);
