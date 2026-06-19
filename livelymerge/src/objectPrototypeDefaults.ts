import type { Arr, Fun, Obj } from './types';
import { isObj } from './types';

export const OBJECT_PROTOTYPE_TO_STRING_FUN_ID = 'object-prototype-toString';

export const objectPrototypeToStringFun: Fun = {
  $type: 'fun',
  $id: OBJECT_PROTOTYPE_TO_STRING_FUN_ID,
  $codeForShow: 'function toString() { return `[obj ${this.$id}]`; }',
  $code: '() => function() { return `[obj ${this.$id}]`; }',
  $scopes: [],
};

export function ensureObjectPrototypeDefaults(
  objectTable: Record<string, Obj | Arr | Fun>,
): void {
  if (!objectTable[OBJECT_PROTOTYPE_TO_STRING_FUN_ID]) {
    objectTable[OBJECT_PROTOTYPE_TO_STRING_FUN_ID] = objectPrototypeToStringFun;
  }
  const proto = objectTable['object-prototype'];
  if (isObj(proto) && !Object.hasOwn(proto, '@toString')) {
    proto['@toString'] = { $type: 'ref', $id: OBJECT_PROTOTYPE_TO_STRING_FUN_ID };
  }
}
