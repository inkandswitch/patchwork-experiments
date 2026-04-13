
import { z } from 'https://esm.sh/zod@4.3';
const EllipseSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

export default {
  init() {
    return { x: 0, y: 0, width: 100, height: 100 };
  },
  parse(value) {
    return EllipseSchema.parse(value);
  },
  toJSONSchema() {
    return z.toJSONSchema(EllipseSchema);
  },
};
