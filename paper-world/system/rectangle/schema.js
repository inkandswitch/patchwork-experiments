import { z } from 'https://esm.sh/zod@4.3';
const RectangleSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  color: z.string().optional(),
});

export default {
  init() {
    return { x: 0, y: 0, width: 100, height: 100 };
  },
  parse(value) {
    return RectangleSchema.parse(value);
  },
  toJSONSchema() {
    return z.toJSONSchema(RectangleSchema);
  },
};
