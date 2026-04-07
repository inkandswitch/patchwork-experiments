
import { z } from 'https://esm.sh/zod@4.3';
import { getViewUrl } from '../url.js';

const EllipseSchema = z.object({
  x: z.number(),
  y: z.number(),
  viewUrl: z.string(),
  width: z.number(),
  height: z.number(),
});

export default {
  init() {
    return { x: 0, y: 0, viewUrl: getViewUrl('./tool.json', import.meta.url), width: 100, height: 100 };
  },
  parse(value) {
    return EllipseSchema.parse(value);
  },
  toJSONSchema() {
    return z.toJSONSchema(EllipseSchema);
  },
};
