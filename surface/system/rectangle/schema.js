import { z } from 'https://esm.sh/zod@4.3';

const RectangleSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
  width: z.number(),
  height: z.number(),
});

export const schema = {
  init() {
    return { x: 0, y: 0, toolUrl: new URL('./shape.js', import.meta.url).href, width: 100, height: 100 };
  },
  parse(value) {
    return RectangleSchema.parse(value);
  },
  toJSONSchema() {
    return z.toJSONSchema(RectangleSchema);
  },
};
