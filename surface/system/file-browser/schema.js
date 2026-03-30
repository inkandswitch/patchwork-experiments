
import { z } from 'https://esm.sh/zod@4.3';
import { getToolUrl } from '../url.js';

const FileBrowserSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
  width: z.number().optional(),
  height: z.number().optional(),
  currentPath: z.string().optional(),
});

export const schema = {
  init() {
    return {
      x: 0,
      y: 0,
      toolUrl: getToolUrl('./tool.js', import.meta.url),
      width: 380,
      height: 450,
      currentPath: '',
    };
  },
  parse(value) {
    return FileBrowserSchema.parse(value);
  },
};
