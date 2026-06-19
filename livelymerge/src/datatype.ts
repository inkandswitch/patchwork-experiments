import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import type { LivelymergeDoc } from './types';

export const LivelymergeDatatype: DatatypeImplementation<LivelymergeDoc> = {
  init(doc: LivelymergeDoc) {
    doc['@patchwork'] = { type: 'livelymerge' };
    doc.title = 'Untitled Livelymerge';
    doc.objectTable = {
      "object-prototype": {
        $type: "obj",
        $id: "object-prototype",
      }, // object prototype (top of the delegation chain)
      "global": {
        $type: "obj",
        $id: "w",
        $protoId: "object-prototype",
        $timeoutFns: { $type: "ref", $id: "timeout-fns" },
        $intervalFns: { $type: "ref", $id: "interval-fns" }
      }, // root object
      "timeout-fns": { $type: "obj", $id: "timeout-fns" },
      "interval-fns": { $type: "obj", $id: "interval-fns" },
    };
  },
  getTitle(doc: LivelymergeDoc) {
    return doc.title?.trim() || 'Livelymerge';
  },
  setTitle(doc: LivelymergeDoc, title: string) {
    doc.title = title.trim();
  },
};
