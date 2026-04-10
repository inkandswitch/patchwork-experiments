import { z } from 'https://esm.sh/zod@4.3';

const POSITIONS = [
  'top-left',
  'top-center',
  'top-right',
  'middle-left',
  'middle-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

const ItemSchema = z
  .object({
    viewUrl: z.string(),
  })
  .passthrough();

const SlotSchema = z.array(ItemSchema).nullable();

const DockLayoutSchema = z.object({
  'top-left': SlotSchema,
  'top-center': SlotSchema,
  'top-right': SlotSchema,
  'middle-left': SlotSchema,
  'middle-right': SlotSchema,
  'bottom-left': SlotSchema,
  'bottom-center': SlotSchema,
  'bottom-right': SlotSchema,
});

export { POSITIONS };

export default {
  namespace: 'dockLayout',
  init() {
    return Object.fromEntries(POSITIONS.map((p) => [p, null]));
  },
  parse(value) {
    return DockLayoutSchema.parse(value);
  },
};
