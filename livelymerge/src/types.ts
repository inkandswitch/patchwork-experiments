import { typeTag } from './docStrings';

export interface LivelymergeDoc {
  '@patchwork': { type: 'livelymerge' };
  title: string;
  objectTable: Record<string, Obj | Arr | Fun>;
}

export type Obj = {
  $type: 'obj';
  $id: string;
  $protoId?: string;
  $jsGlobal?: string; // if set, this object is a stand-in for an object that's defined in the JS global scope (in which case $protoId is ignored)
} & Record<string, any>;

export interface Arr {
  $type: 'arr';
  $id: string;
  $values: Val[];
}

export interface Fun {
  $type: 'fun';
  $id: string;
  $codeForShow: string;
  $code: string;
  $scopes: Ref[];
  $prototypeId?: string;
  [key: string]: any;
}

export interface Ref {
  $type: 'ref';
  $id: string;
}

/** A stored getter/setter pair. Lives as a property value on a heap entry (usually a
 * class prototype); the proxy get/set traps invoke the referenced functions with the
 * receiver as `this` instead of returning/overwriting the record itself. */
export interface AccessorVal {
  $type: 'accessor';
  $get?: Ref;
  $set?: Ref;
}

export type Val = Ref | AccessorVal | number | string | boolean | null | undefined;

// The guards go through typeTag so they answer correctly for both in-memory
// entries (plain-string $type) and raw document reads ($type may be an
// immutable-string wrapper — see docStrings.ts).
export function isObj(value: any): value is Obj {
  return typeof value === 'object' && typeTag(value) === 'obj';
}

export function isArr(value: any): value is Arr {
  return typeof value === 'object' && typeTag(value) === 'arr';
}

export function isFun(value: any): value is Fun {
  return typeof value === 'object' && typeTag(value) === 'fun';
}

export function isRef(value: any): value is Ref {
  return typeof value === 'object' && typeTag(value) === 'ref';
}

export function isAccessorVal(value: any): value is AccessorVal {
  return typeof value === 'object' && typeTag(value) === 'accessor';
}
