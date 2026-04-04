import { z } from 'https://esm.sh/zod@4.3';
import { getViewUrl } from '../url.js';

const PartsBinSchema = z.object({
  x: z.number(),
  y: z.number(),
  viewUrl: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
});

export const schema = {
  init() {
    return {
      x: 0,
      y: 0,
      viewUrl: getViewUrl('./tool.json', import.meta.url),
      width: 280,
      height: 800,
    };
  },
  parse(value) {
    return PartsBinSchema.parse(value);
  },
};
