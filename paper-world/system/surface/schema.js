import { z } from 'https://esm.sh/zod@4.3';

const ShapeSchema = z.object({
  viewUrl: z.string(),
  data: z.unknown().optional(),
});

export const surfaceSchema = {
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

export function findTargetSurface(target, rootSurface) {
  const closestRefView = target.closest('ref-view');
  if (!closestRefView) return null;
  const closestSurface = closestRefView.findClosest(surfaceSchema);
  if (!closestSurface) return null;
  if (closestSurface === rootSurface || rootSurface.contains(closestSurface)) {
    return closestSurface;
  }
  return null;
}

export const cameraSchema = {
  methods: [
    'screenToPage',
    'pageToScreen',
    'getCamera',
    'setCamera',
    'subscribeCamera',
    'getContainerEl',
    'getScale',
  ],
  init() {
    return {};
  },
  parse(value) {
    return value;
  },
};
