import { z } from 'https://esm.sh/zod@4.3';
import { cameraSchema, selectedShapesSchema, selectedToolSchema, surfaceSchema } from '../surface/schema.js';

const MapSchema = z.object({
  centerX: z.number().optional(),
  centerY: z.number().optional(),
  zoom: z.number().optional(),
  shapes: z.record(z.string(), z.unknown()).optional(),
  selectedTool: z.string().optional(),
  selectedShapes: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export { cameraSchema, selectedShapesSchema, selectedToolSchema, surfaceSchema };

export default {
  init() {
    return {
      centerX: 13.388,
      centerY: 52.517,
      zoom: 9.5,
      shapes: {},
      selectedTool: '',
      selectedShapes: {},
    };
  },
  parse(value) {
    return MapSchema.parse(value ?? {});
  },
  toJSONSchema() {
    return z.toJSONSchema(MapSchema);
  },
};
