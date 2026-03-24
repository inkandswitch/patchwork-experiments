import { z } from 'https://esm.sh/zod@4.3';

const LineSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
  points: z.array(z.tuple([z.number(), z.number(), z.number()])),
});

export const schema = {
  init() {
    return { x: 0, y: 0, toolUrl: new URL('./shape.js', import.meta.url).href, points: [] };
  },
  parse(value) {
    return LineSchema.parse(value);
  },
  toJSONSchema() {
    return z.toJSONSchema(LineSchema);
  },
};
