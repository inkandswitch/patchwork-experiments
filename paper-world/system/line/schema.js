import { z } from 'https://esm.sh/zod@4.3';
const LineSchema = z.object({
  x: z.number(),
  y: z.number(),
  points: z.array(z.tuple([z.number(), z.number(), z.number()])),
  color: z.string().optional(),
});

export default {
  init() {
    return { x: 0, y: 0, points: [] };
  },
  parse(value) {
    return LineSchema.parse(value);
  },
  toJSONSchema() {
    return z.toJSONSchema(LineSchema);
  },
};
