import { z } from 'https://esm.sh/zod@4.3';
import { getViewUrl } from '../url.js';

const EmbedSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    viewUrl: z.string(),
    embedViewUrl: z.string(),
    width: z.number(),
    height: z.number(),
    embedDocUrl: z.string().default(''),
  })
  .passthrough();

export default {
  init() {
    return {
      x: 0,
      y: 0,
      viewUrl: getViewUrl('./tool.json', import.meta.url),
      embedViewUrl: '',
      width: 200,
      height: 150,
      embedDocUrl: '',
    };
  },
  parse(value) {
    return EmbedSchema.parse(value);
  },
  toJSONSchema() {
    return z.toJSONSchema(EmbedSchema);
  },
};
