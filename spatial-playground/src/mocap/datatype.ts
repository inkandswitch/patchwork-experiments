import type { MocapDoc } from '../types.ts';

export const MocapDatatype = {
  init(doc: MocapDoc) {
    doc['@patchwork'] = { type: 'spatial-mocap' };
    doc.title = 'Hole in the Wall';
    doc.highScores = [];
  },
  getTitle(doc: MocapDoc) {
    return doc.title || 'Hole in the Wall';
  },
  setTitle(doc: MocapDoc, title: string) {
    doc.title = title;
  },
};
