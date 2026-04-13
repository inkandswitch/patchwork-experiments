import { z } from 'https://esm.sh/zod@4.3';
const TextSchema = z.object({
  x: z.number(),
  y: z.number(),
  text: z.string(),
});

export const editorExtensionsSchema = {
  methods: ['addExtension', 'removeExtension'],
};

export default {
  init() {
    return { x: 0, y: 0, text: '' };
  },
  parse(value) {
    return TextSchema.parse(value);
  },
  toJSONSchema() {
    return z.toJSONSchema(TextSchema);
  },
};
