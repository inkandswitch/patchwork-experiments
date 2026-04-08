import { z } from 'https://esm.sh/zod@4.3';
import { getViewUrl } from '../url.js';

const ChildSchema = z
  .object({
    viewUrl: z.string(),
  })
  .passthrough();

const StackSchema = z.object({
  children: z.array(ChildSchema),
});

export default {
  namespace: 'stack',
  init() {
    return {
      children: [
        { viewUrl: getViewUrl('../paper/tool.json', import.meta.url) },
        { viewUrl: getViewUrl('../dock-layout/tool.json', import.meta.url) },
      ],
    };
  },
  parse(value) {
    return StackSchema.parse(value);
  },
};
