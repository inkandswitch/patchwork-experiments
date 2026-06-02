import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { SequenceDoc } from './types';
import { turnIntoSampleSequence } from './helpers';

export const SequenceDatatype: DatatypeImplementation<SequenceDoc> = {
  init(doc: SequenceDoc) {
    doc['@patchwork'] = { type: 'sequence' };
    doc.title = 'Untitled Sequence';
    doc.sources = {};
    doc.tracks = [];
    turnIntoSampleSequence(doc);
  },
  getTitle(doc: SequenceDoc) {
    return doc.title;
  },
  setTitle(doc: SequenceDoc, title: string) {
    doc.title = title.trim();
  },
};
