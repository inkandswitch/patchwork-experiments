
import { z } from 'https://esm.sh/zod@4.3';
import { getViewUrl } from '../url.js';

const EraserTrailSchema = z.object({
  x: z.number(),
  y: z.number(),
  viewUrl: z.string(),
  points: z.array(z.tuple([z.number(), z.number()])),
  createdAt: z.number(),
});

export default {
  init() {
    return {
      x: 0,
      y: 0,
      viewUrl: getViewUrl('./tool.json', import.meta.url),
      points: [],
      createdAt: Date.now(),
    };
  },
  parse(value) {
    return EraserTrailSchema.parse(value);
  },
};
