
import { z } from 'https://esm.sh/zod@4.3';
import { getViewUrl } from '../url.js';

const CounterSchema = z.object({
  count: z.number(),
});

export default {
  init() {
    return { count: 0 };
  },
  parse(value) {
    return CounterSchema.parse(value);
  },
};
