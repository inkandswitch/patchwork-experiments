import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { MapDeleteBugDoc } from './types';

export const MapDeleteBugDatatype: DatatypeImplementation<MapDeleteBugDoc> = {
  init(doc) {
    doc['@patchwork'] = { type: 'solid-map-delete-bug' };
    doc.title = 'Solid map-delete bug repro';
    doc.items = {
      'seed-a': { id: 'seed-a', label: 'Alpha' },
      'seed-b': { id: 'seed-b', label: 'Bravo' },
      'seed-c': { id: 'seed-c', label: 'Charlie' },
    };
  },
  getTitle(doc) {
    return doc.title || 'Solid map-delete bug repro';
  },
  setTitle(doc, title) {
    doc.title = title;
  },
};
