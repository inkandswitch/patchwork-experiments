import { z } from 'https://esm.sh/zod@4.3';
import { getViewUrl } from '../url.js';

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

const DockLayoutSchema = z.object(
  Object.fromEntries(POSITIONS.map((p) => [p, SlotSchema])),
);

export { POSITIONS };

export default {
  namespace: 'dockLayout',
  init() {
    return {
      'top-left': null,
      'top-center': [
        { viewUrl: getViewUrl('../selection/button.json', import.meta.url) },
        { viewUrl: getViewUrl('../rectangle/button.json', import.meta.url) },
        { viewUrl: getViewUrl('../line/button.json', import.meta.url) },
        { viewUrl: getViewUrl('../text/button.json', import.meta.url) },
        { viewUrl: getViewUrl('../eraser/button.json', import.meta.url) },
        { viewUrl: getViewUrl('../rainbow-marker/button.json', import.meta.url) },
        { viewUrl: getViewUrl('../sparkle-marker/button.json', import.meta.url) },
      ],
      'top-right': null,
      'middle-left': [
        {
          viewUrl: getViewUrl('../parts-bin/tool.json', import.meta.url),
          width: 280,
          height: 800,
        },
      ],
      'middle-right': null,
      'bottom-left': null,
      'bottom-center': null,
      'bottom-right': null,
    };
  },
  parse(value) {
    return DockLayoutSchema.parse(value);
  },
};
