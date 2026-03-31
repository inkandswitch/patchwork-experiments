
import { z } from 'https://esm.sh/zod@4.3';
import { getToolUrl } from '../url.js';

const EllipseSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
  width: z.number(),
  height: z.number(),
});

export const schema = {
  init() {
    return { x: 0, y: 0, toolUrl: getToolUrl('./tool.js', import.meta.url), width: 100, height: 100 };
  },
  parse(value) {
    return EllipseSchema.parse(value);
  },
  toJSONSchema() {
    return z.toJSONSchema(EllipseSchema);
  },
};
