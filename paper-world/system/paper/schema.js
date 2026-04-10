import { z } from 'https://esm.sh/zod@4.3';

const ShapeSchema = z.object({
  x: z.number(),
  y: z.number(),
  viewUrl: z.string(),
});

export const shapesSchema = {
  namespace: 'shapes',
  init() {
    return {};
  },
  parse(value) {
    const raw = value ?? {};
    const plain = {};
    for (const key of Object.keys(raw)) {
      plain[key] = raw[key];
    }
    return z.record(z.string(), ShapeSchema.passthrough()).parse(plain);
  },
};

export const selectedToolSchema = {
  namespace: 'selectedTool',
  init() {
    return '';
  },
  parse(value) {
    return typeof value === 'string' ? value : '';
  },
};

export const selectedShapesSchema = {
  namespace: 'selectedShapes',
  init() {
    return {};
  },
  parse(value) {
    return typeof value === 'object' && value ? value : {};
  },
};

export const cameraSchema = {
  methods: [
    'screenToPage',
    'pageToScreen',
    'getCamera',
    'setCamera',
    'subscribeCamera',
    'getContainerEl',
  ],
  init() {
    return {};
  },
  parse(value) {
    return value;
  },
};
