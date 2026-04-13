import { z } from 'https://esm.sh/zod@4.3';

const EmbedSchema = z
  .object({
    embedDocUrl: z.string(),
    embedToolUrl: z.string().optional(),
    title: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
  })
  .passthrough();

export default {
  init() {
    return { embedDocUrl: '' };
  },
  parse(value) {
    return EmbedSchema.parse(value);
  },
};
