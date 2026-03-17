import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { PaperDoc } from './types.js';

export const PaperDatatype: DatatypeImplementation<PaperDoc> = {
  init(doc) {
    doc.title = 'Paper';
    doc.userState = {};
    doc.panels = [
      { id: 'tool-panel', toolId: 'paper-tool-panel', position: 'bottom-center' },
    ];
    doc.shapes = {
      'shape-center': {
        id: 'shape-center',
        type: 'rectangle',
        x: -60,
        y: -60,
        w: 120,
        h: 120,
        fill: '#e2e8f0',
        stroke: '#475569',
        strokeWidth: 2,
        zIndex: 0,
      },
    };
  },

  getTitle(doc) {
    return doc.title ?? 'Paper';
  },

  setTitle(doc, title) {
    doc.title = title;
  },
};
