import { z } from 'https://esm.sh/zod@4.3';

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
      children: [],
    };
  },
  parse(value) {
    return StackSchema.parse(value);
  },
};
