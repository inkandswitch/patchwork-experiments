import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { LivelymergeDoc } from './types';

export const LivelymergeDatatype: DatatypeImplementation<LivelymergeDoc> = {
  init(doc: LivelymergeDoc) {
    doc['@patchwork'] = { type: 'livelymerge' };
    doc.title = 'Untitled';
    // TODO: Livelymerge default doc
  },
  getTitle(doc: LivelymergeDoc) {
    return doc.title?.trim() || 'Livelymerge';
  },
  setTitle(doc: LivelymergeDoc, title: string) {
    doc.title = title.trim();
  },
};
