
import { z } from 'https://esm.sh/zod@4.3';
import { getToolUrl } from '../url.js';

const CounterSchema = z.object({
  count: z.number(),
});

export const schema = {
  init() {
    return { count: 0 };
  },
  parse(value) {
    return CounterSchema.parse(value);
  },
};
