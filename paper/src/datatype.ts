import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins'
import type { LineShape, PaperDoc, RectangleShape } from './types.js'

export const PaperDatatype: DatatypeImplementation<PaperDoc> = {
  init(doc) {
    doc.title = 'Paper'
    doc.shapes = {}

    const shapes: Array<[string, Omit<RectangleShape, 'id'> | Omit<LineShape, 'id'>]> = [
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
          x1: -1000,
          y1: 0,
          x2: 1100,
          y2: 0,
          stroke: '#94a3b8',
          strokeWidth: 2,
          zIndex: 5,
        },
      ],
    ]

    for (const [id, shape] of shapes) {
      doc.shapes[id] = { ...shape, id }
    }
  },

  getTitle(doc) {
    return doc.title ?? 'Paper'
  },

  setTitle(doc, title) {
    doc.title = title
  },
}
