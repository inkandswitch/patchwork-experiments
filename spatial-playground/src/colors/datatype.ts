import type { ColorsDoc } from '../types.ts';

export const ColorsDatatype = {
  init(doc: ColorsDoc) {
    doc['@patchwork'] = { type: 'spatial-colors' };
    doc.title = 'Color Markers';
    doc.activeRegions = null;
    doc.cameraAspect = null;
  },
  getTitle(doc: ColorsDoc) {
    return doc.title || 'Color Markers';
  },
  setTitle(doc: ColorsDoc, title: string) {
    doc.title = title;
  },
};
