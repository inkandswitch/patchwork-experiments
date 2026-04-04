
import { z } from 'https://esm.sh/zod@4.3';
import { getViewUrl } from '../url.js';

const InspectorSchema = z.object({
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
      width: 400,
      height: 500,
    };
  },
  parse(value) {
    return InspectorSchema.parse(value);
  },
};
