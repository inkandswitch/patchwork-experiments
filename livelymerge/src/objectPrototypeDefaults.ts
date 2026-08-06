import type { Arr, Fun, Obj } from './types';
import { isObj } from './types';
import { lmHeapHasOwn } from './lmStorage';

export const OBJECT_PROTOTYPE_TO_STRING_FUN_ID = 'object-prototype-toString';

export const objectPrototypeToStringFun: Fun = {
  $type: 'fun',
  $id: OBJECT_PROTOTYPE_TO_STRING_FUN_ID,
  $codeForShow: 'function toString() { return `[obj ${this.$id}]`; }',
  $code: '() => function() { return `[obj ${this.$id}]`; }',
  $scopes: [],
};

/** `storeEntry`/`storeVal` encode writes for their destination: the runtime
 * passes the immutable-string wrappers for the Automerge table (docStrings.ts);
 * the test harness's plain-JS table stores as-is. */
export function ensureObjectPrototypeDefaults(
  objectTable: Record<string, Obj | Arr | Fun>,
  storeEntry: (entry: Fun) => Fun = (entry) => entry,
  storeVal: (value: any) => any = (value) => value,
): void {
  if (!objectTable[OBJECT_PROTOTYPE_TO_STRING_FUN_ID]) {
    objectTable[OBJECT_PROTOTYPE_TO_STRING_FUN_ID] = storeEntry(objectPrototypeToStringFun);
  }
  const proto = objectTable['object-prototype'];
  if (isObj(proto) && !lmHeapHasOwn(proto, '@toString')) {
    proto['@toString'] = storeVal({ $type: 'ref', $id: OBJECT_PROTOTYPE_TO_STRING_FUN_ID });
  }
}
