import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { LivelymergeDoc } from './types';

export const LivelymergeDatatype: DatatypeImplementation<LivelymergeDoc> = {
  init(doc: LivelymergeDoc) {
    doc['@patchwork'] = { type: 'livelymerge' };
    doc.title = 'Untitled Livelymerge';
    doc.objectTable = {
      "-1": { type: "obj", _id: -1 }, // object prototype (top of the delegation chain)
      "0": { type: "obj", _id: 0, _protoId: -1 }, // root object (w or world)
    };
  },
  getTitle(doc: LivelymergeDoc) {
    return doc.title?.trim() || 'Livelymerge';
  },
  setTitle(doc: LivelymergeDoc, title: string) {
    doc.title = title.trim();
  },
};
