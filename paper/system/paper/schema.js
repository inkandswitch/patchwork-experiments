import { z } from 'https://esm.sh/zod@4.3';
import { getViewUrl } from '../url.js';

const ShapeSchema = z.object({
  x: z.number(),
  y: z.number(),
  viewUrl: z.string(),
});

export const shapesSchema = {
  namespace: 'shapes',
  init() {
    return {
      selectionButton: {
        x: 10,
        y: 10,
        isLocked: true,
        viewUrl: getViewUrl('../selection/button.json', import.meta.url),
      },
      rectButton: {
        x: 50,
        y: 10,
        isLocked: true,
        viewUrl: getViewUrl('../rectangle/button.json', import.meta.url),
      },
      lineButton: {
        x: 90,
        y: 10,
        isLocked: true,
        viewUrl: getViewUrl('../line/button.json', import.meta.url),
      },
      textButton: {
        x: 130,
        y: 10,
        isLocked: true,
        viewUrl: getViewUrl('../text/button.json', import.meta.url),
      },
      embedButton: {
        x: 170,
        y: 10,
        isLocked: true,
        viewUrl: getViewUrl('../embed/button.json', import.meta.url),
      },
      partsBin: {
        x: 10,
        y: 50,
        isLocked: true,
        viewUrl: getViewUrl('../parts-bin/tool.json', import.meta.url),
        width: 280,
        height: 800,
      },
      tray: {
        x: 10,
        y: 860,
        isLocked: true,
        viewUrl: getViewUrl('../tray/tool.json', import.meta.url),
        width: 520,
        height: 140,
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
