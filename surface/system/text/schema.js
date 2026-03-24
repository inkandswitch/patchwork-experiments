import { z } from 'https://esm.sh/zod@4.3';

const TextSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
  text: z.string(),
});

export const schema = {
  init() {
    return { x: 0, y: 0, toolUrl: new URL('./shape.js', import.meta.url).href, text: '' };
  },
  parse(value) {
    return TextSchema.parse(value);
  },
  toJSONSchema() {
    return z.toJSONSchema(TextSchema);
  },
};
