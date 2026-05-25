import type { ColorsDoc } from '../types.ts';

export const ColorsDatatype = {
  init(doc: ColorsDoc) {
    doc['@patchwork'] = { type: 'spatial-colors' };
    doc.title = 'QR Colors';
    doc.activeColors = [];
    doc.activeRegions = null;
    doc.cameraAspect = null;
  },
  getTitle(doc: ColorsDoc) {
    return doc.title || 'QR Colors';
  },
  setTitle(doc: ColorsDoc, title: string) {
    doc.title = title;
  },
};
