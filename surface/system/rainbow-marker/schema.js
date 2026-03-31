
import { z } from 'https://esm.sh/zod@4.3';
import { getToolUrl } from '../url.js';

const RainbowMarkerSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
  points: z.array(z.tuple([z.number(), z.number(), z.number()])),
});

export const schema = {
  init() {
    return {
      x: 0,
      y: 0,
      toolUrl: getToolUrl('./tool.js', import.meta.url),
      points: [],
    };
  },
  parse(value) {
    return RainbowMarkerSchema.parse(value);
  },
  toJSONSchema() {
    return z.toJSONSchema(RainbowMarkerSchema);
  },
};
