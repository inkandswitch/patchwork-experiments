
import { z } from 'https://esm.sh/zod@4.3';
const EraserTrailSchema = z.object({
  x: z.number(),
  y: z.number(),
  points: z.array(z.tuple([z.number(), z.number()])),
  createdAt: z.number(),
});

export default {
  init() {
    return {
      x: 0,
      y: 0,
      points: [],
      createdAt: Date.now(),
    };
  },
  parse(value) {
    return EraserTrailSchema.parse(value);
  },
};
