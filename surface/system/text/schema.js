import { z } from 'https://esm.sh/zod@4.3';
import { getViewUrl } from '../url.js';

const TextSchema = z.object({
  x: z.number(),
  y: z.number(),
  viewUrl: z.string(),
  text: z.string(),
});

export const schema = {
  init() {
    return { x: 0, y: 0, viewUrl: getViewUrl('./tool.json', import.meta.url), text: '' };
  },
  parse(value) {
    return TextSchema.parse(value);
  },
  toJSONSchema() {
    return z.toJSONSchema(TextSchema);
  },
};
