import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import {
  OBJECT_PROTOTYPE_TO_STRING_FUN_ID,
  objectPrototypeToStringFun,
} from './objectPrototypeDefaults';
import type { LivelymergeDoc } from './types';

export const LivelymergeDatatype: DatatypeImplementation<LivelymergeDoc> = {
  init(doc: LivelymergeDoc) {
    doc['@patchwork'] = { type: 'livelymerge' };
    doc.title = 'Untitled Livelymerge';
    doc.objectTable = {
      [OBJECT_PROTOTYPE_TO_STRING_FUN_ID]: objectPrototypeToStringFun,
      "object-prototype": {
        $type: "obj",
        $id: "object-prototype",
        "@toString": { $type: "ref", $id: OBJECT_PROTOTYPE_TO_STRING_FUN_ID },
      }, // object prototype (top of the delegation chain)
      "global": {
        $type: "obj",
        $id: "global",
        $protoId: "object-prototype",
        $timeoutFns: { $type: "ref", $id: "timeout-fns" },
        $intervalFns: { $type: "ref", $id: "interval-fns" },
        "@global": { $type: "ref", $id: "global" }
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
