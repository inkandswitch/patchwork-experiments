import { z } from 'https://esm.sh/zod@4.3';

const ShapeSchema = z.object({
  x: z.number(),
  y: z.number(),
  toolUrl: z.string(),
});

export const shapesSchema = {
  init() {
    return {
      selectionButton: {
        x: 10,
        y: 10,
        isLocked: true,
        toolUrl: new URL('../selection/button.js', import.meta.url).href,
      },
      rectButton: {
        x: 50,
        y: 10,
        isLocked: true,
        toolUrl: new URL('../rectangle/button.js', import.meta.url).href,
      },
      lineButton: {
        x: 90,
        y: 10,
        isLocked: true,
        toolUrl: new URL('../line/button.js', import.meta.url).href,
      },
      textButton: {
        x: 130,
        y: 10,
        isLocked: true,
        toolUrl: new URL('../text/button.js', import.meta.url).href,
      },
      embedButton: {
        x: 170,
        y: 10,
        isLocked: true,
        toolUrl: new URL('../embed/button.js', import.meta.url).href,
      },
    };
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
  init() {
    return '';
  },
  parse(value) {
    return typeof value === 'string' ? value : '';
  },
};

export const selectedShapesSchema = {
  init() {
    return {};
  },
  parse(value) {
    return typeof value === 'object' && value ? value : {};
  },
};
