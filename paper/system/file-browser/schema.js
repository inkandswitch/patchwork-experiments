
import { z } from 'https://esm.sh/zod@4.3';
import { getViewUrl } from '../url.js';

const FileBrowserSchema = z.object({
  x: z.number(),
  y: z.number(),
  viewUrl: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  currentPath: z.string().optional(),
});

export default {
  init() {
    return {
      x: 0,
      y: 0,
      viewUrl: getViewUrl('./tool.json', import.meta.url),
      width: 380,
      height: 450,
      currentPath: '',
    };
  },
  parse(value) {
    return FileBrowserSchema.parse(value);
  },
};
