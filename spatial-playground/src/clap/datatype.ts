import type { ClapDoc } from '../types.ts';

export const ClapDatatype = {
  init(doc: ClapDoc) {
    doc['@patchwork'] = { type: 'spatial-clap' };
    doc.title = 'Clap Lights';
    doc.thresholdConfig = {
      peakThreshold: 0.38,
      windowMs: 850,
    };
    doc.hueConfig = null;
  },
  getTitle(doc: ClapDoc) {
    return doc.title || 'Clap Lights';
  },
  setTitle(doc: ClapDoc, title: string) {
    doc.title = title;
  },
};
