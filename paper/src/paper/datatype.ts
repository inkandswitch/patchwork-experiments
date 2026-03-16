import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { PaperDoc } from './types.js';

export const PaperDatatype: DatatypeImplementation<PaperDoc> = {
  init(doc) {
    doc.title = 'Paper';
    doc.shapes = {};
    doc.panels = [
      { id: 'panel-top-left', toolId: 'paper-panel', position: 'top-left' },
      { id: 'panel-top-center', toolId: 'paper-panel', position: 'top-center' },
      { id: 'panel-top-right', toolId: 'paper-panel', position: 'top-right' },
      { id: 'panel-bottom-left', toolId: 'paper-panel', position: 'bottom-left' },
      { id: 'panel-bottom-right', toolId: 'paper-panel', position: 'bottom-right' },
      { id: 'panel-left', toolId: 'paper-panel', position: 'left-top' },
      { id: 'panel-right', toolId: 'paper-panel', position: 'right-center' },
    ];

    const shapes = [
      [
        'shape-center',
        {
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
      ],
      [
        'shape-red',
        {
          type: 'rectangle',
          x: -1100,
          y: -900,
          w: 200,
          h: 150,
          fill: '#fca5a5',
          stroke: '#dc2626',
          strokeWidth: 2,
          zIndex: 1,
        },
      ],
      [
        'shape-blue',
        {
          type: 'rectangle',
          x: 700,
          y: -700,
          w: 180,
          h: 180,
          fill: '#93c5fd',
          stroke: '#2563eb',
          strokeWidth: 2,
          zIndex: 2,
        },
      ],
      [
        'shape-green',
        {
          type: 'rectangle',
          x: -800,
          y: 900,
          w: 220,
          h: 120,
          fill: '#86efac',
          stroke: '#16a34a',
          strokeWidth: 2,
          zIndex: 3,
        },
      ],
      [
        'shape-yellow',
        {
          type: 'rectangle',
          x: 1000,
          y: 800,
          w: 160,
          h: 160,
          fill: '#fde047',
          stroke: '#ca8a04',
          strokeWidth: 2,
          zIndex: 4,
        },
      ],
      [
        'shape-line',
        {
          type: 'line',
          x: -1000,
          y: 0,
          x1: -1000,
          y1: 0,
          x2: 1100,
          y2: 0,
          stroke: '#94a3b8',
          strokeWidth: 2,
          zIndex: 5,
        },
      ],
      [
        'shape-line-diagonal',
        {
          type: 'line',
          x: -600,
          y: -600,
          x1: -600,
          y1: -600,
          x2: 600,
          y2: 600,
          stroke: '#f97316',
          strokeWidth: 3,
          zIndex: 6,
        },
      ],
      [
        'shape-embed',
        {
          type: 'embed',
          x: 200,
          y: -200,
          docUrl: 'automerge:dhkuYMpSttbRJPBJ7J5XST28bu7',
          width: 400,
          height: 300,
          zIndex: 7,
        },
      ],
    ] as const;

    for (const [id, shape] of shapes) {
      doc.shapes[id] = { ...shape, id };
    }
  },

  getTitle(doc) {
    return doc.title ?? 'Paper';
  },

  setTitle(doc, title) {
    doc.title = title;
  },
};
