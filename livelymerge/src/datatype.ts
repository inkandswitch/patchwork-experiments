import type { DatatypeImplementation } from '@inkandswitch/patchwork-plugins';
import { wrapEntryForDoc } from './docStrings';
import {
  OBJECT_PROTOTYPE_TO_STRING_FUN_ID,
  objectPrototypeToStringFun,
} from './objectPrototypeDefaults';
import type { LivelymergeDoc, Obj, Arr, Fun } from './types';

export const LivelymergeDatatype: DatatypeImplementation<LivelymergeDoc> = {
  init(doc: LivelymergeDoc) {
    doc['@patchwork'] = { type: 'livelymerge' };
    doc.title = 'Untitled Livelymerge';
    const objectTable: Record<string, Obj | Arr | Fun> = {
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
        "@global": { $type: "ref", $id: "global" },
        "@canvas": { $type: "ref", $id: "canvas" },
        "@ctx": { $type: "ref", $id: "ctx" },
        "@document": { $type: "ref", $id: "document" },
        "@Math": { $type: "ref", $id: "Math" },
        "@String": { $type: "ref", $id: "String" },
        "@Date": { $type: "ref", $id: "Date" },
        "@window": { $type: "ref", $id: "window" },
      }, // root object
      // JS global objects (escape hatch!)
      "canvas": {
        $type: "obj",
        $id: "canvas",
        $jsGlobal: "canvas",
      },
      "ctx": {
        $type: "obj",
        $id: "ctx",
        $jsGlobal: "ctx",
      },
      "document": {
        $type: "obj",
        $id: "document",
        $jsGlobal: "document",
      },
      "Math": {
        $type: "obj",
        $id: "Math",
        $jsGlobal: "Math",
      },
      "String": {
        $type: "obj",
        $id: "String",
        $jsGlobal: "String",
      },
      "Date": {
        $type: "obj",
        $id: "Date",
        $jsGlobal: "Date",
      },
      "window": {
        $type: "obj",
        $id: "window",
        $jsGlobal: "window",
      }, // the ultimate escape hatch!
      "timeout-fns": { $type: "obj", $id: "timeout-fns" },
      "interval-fns": { $type: "obj", $id: "interval-fns" },
    };
    // Strings are stored in the immutable-string encoding (see docStrings.ts).
    doc.objectTable = {};
    for (const [id, entry] of Object.entries(objectTable)) {
      doc.objectTable[id] = wrapEntryForDoc(entry);
    }
  },
  getTitle(doc: LivelymergeDoc) {
    return doc.title?.trim() || 'Livelymerge';
  },
  setTitle(doc: LivelymergeDoc, title: string) {
    doc.title = title.trim();
  },
};
