import { z } from 'https://esm.sh/zod@4.3';

const EmbedSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    toolUrl: z.string(),
    embedToolUrl: z.string(),
    width: z.number(),
    height: z.number(),
    embedDocUrl: z.string().default(''),
  })
  .passthrough();

export const schema = {
  init() {
    return {
      x: 0,
      y: 0,
      toolUrl: new URL('./shape.js', import.meta.url).href,
      embedToolUrl: '',
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
