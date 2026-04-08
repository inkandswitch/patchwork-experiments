import { z } from 'https://esm.sh/zod@4.3';

const SlotSchema = z
  .object({
    viewUrl: z.string(),
  })
  .passthrough()
  .nullable();

const TraySchema = z.object({
  slots: z.array(SlotSchema),
});

export default {
  namespace: 'tray',
  init() {
    return { slots: [null, null, null, null] };
  },
  parse(value) {
    return TraySchema.parse(value);
  },
};
