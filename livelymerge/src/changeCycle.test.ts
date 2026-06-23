import { describe, expect, it } from 'vitest';
import { wrapForCompletionValue } from './completionValue';
import { ensureObjectPrototypeDefaults } from './objectPrototypeDefaults';
import {
  lmCallToString,
  lmGetOwn,
  lmGetWithDelegation,
  lmHeapPropertyNames,
  lmIsReservedKey,
  lmOwnUserPropertyKeys,
  lmSetOwn,
} from './lmStorage';
import type { Arr, Fun, Obj, Ref, Val } from './types';
import { isArr, isFun, isObj, isRef } from './types';
import { transpile } from './transpiler';

type Proxy = {
  $isProxy: boolean;
  $id: string;
  $unwrapped: Obj | Arr | Fun;
  toString(): string;
};

let objectTable: Record<string, Obj | Arr | Fun> = {
  'object-prototype': { $type: 'obj', $id: 'object-prototype' },
  global: {
    $type: 'obj',
    $id: 'global',
    $protoId: 'object-prototype',
  },
};
let newObjects: Map<string, Obj | Arr | Fun> | null = null;
let proxies: Map<string, Proxy> | null = null;
let $global: Proxy;

function beginChange() {
  newObjects = null;
  proxies = null;
  ensureObjectPrototypeDefaults(objectTable);
  $global = deserialize(objectTable.global) as Proxy;
}

function endChangeGc() {
  const visited = new Set<string>();
  function visit(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    let val = newObjects?.get(id);
    if (val) {
      objectTable[id] = val;
    } else {
      val = objectTable[id];
      if (!val) throw new Error('missing ' + id);
    }
    if (isObj(val)) {
      for (const p of lmHeapPropertyNames(val)) lookAt(val[p]);
      if (val.$protoId != null) visit(val.$protoId);
    } else if (isArr(val)) {
      for (const v of val.$values) lookAt(v);
    } else if (isFun(val)) {
      for (const v of val.$scopes) lookAt(v);
      if (val.$prototypeId != null) visit(val.$prototypeId);
      for (const prop of lmOwnUserPropertyKeys(val)) lookAt(lmGetOwn(val, prop) as Val);
    }
  }
  function lookAt(v: Val) {
    if (isRef(v)) visit(v.$id);
  }
  visit('global');
  for (const id of Object.keys(objectTable)) {
    if (!visited.has(id)) delete objectTable[id];
  }
  newObjects = null;
}

function change(fn: () => void) {
  beginChange();
  fn();
  endChangeGc();
}

function toVal(x: unknown): Val {
  return isProxy(x) ? { $type: 'ref', $id: (x as Proxy).$id } : (x as Val);
}

function isProxy(x: unknown): x is Proxy {
  return (typeof x === 'object' || typeof x === 'function') && x != null && (x as Proxy).$isProxy;
}

function lookupHeapEntry(id: string) {
  return newObjects?.get(id) ?? objectTable[id];
}

function lookupHeapProto(id: string): Obj | undefined {
  const val = lookupHeapEntry(id);
  return isObj(val) ? val : undefined;
}

function liveHeapObj(obj: Obj): Obj {
  const live = lookupHeapEntry(obj.$id);
  return isObj(live) ? live : obj;
}

function deserialize(value: unknown): unknown {
  if (isRef(value)) {
    const entry = lookupHeapEntry(value.$id);
    if (entry === undefined) return undefined;
    return deserialize(entry);
  }
  if (isObj(value)) return proxifyObj(value);
  if (isArr(value)) return proxifyArr(value);
  if (isFun(value)) return proxifyFun(value);
  return value;
}

function proxifyObj(obj: Obj): Proxy {
  const existing = proxies?.get(obj.$id);
  if (existing) return existing;
  if (!proxies) proxies = new Map();
  const p = new Proxy(Object.create(null), {
    set(_, prop, value) {
      if (lmIsReservedKey(prop)) return false;
      return lmSetOwn(liveHeapObj(obj), prop, value, toVal);
    },
    get(_, prop) {
      const entry = liveHeapObj(obj);
      if (prop === '$isProxy') return true;
      if (prop === '$id') return entry.$id;
      if (prop === '$unwrapped') return entry;
      if (lmIsReservedKey(prop)) return undefined;
      const value = lmGetWithDelegation(entry, prop, lookupHeapProto, deserialize);
      if (value !== undefined) return value;
      if (prop === 'toString') {
        return () => `[obj ${entry.$id}]`;
      }
      return undefined;
    },
  }) as unknown as Proxy;
  proxies.set(obj.$id, p);
  return p;
}

function proxifyArr(arr: Arr): Proxy {
  if (!proxies) proxies = new Map();
  return new Proxy(arr, {
    get(_, prop) {
      if (prop === '$isProxy') return true;
      if (prop === '$id') return arr.$id;
      if (prop === '$unwrapped') return arr;
      return undefined;
    },
  }) as unknown as Proxy;
}

function proxifyFun(fun: Fun): Proxy {
  const existing = proxies?.get(fun.$id);
  if (existing) return existing;
  if (!proxies) proxies = new Map();
  let fn: ((...args: unknown[]) => unknown) | null = null;
  const callFn = () => {
    if (!fn) fn = new Function('return ' + fun.$code)()(...fun.$scopes.map(deserialize)) as typeof fn;
    return fn;
  };
  let funProxy: Proxy;
  const target = function () {};
  funProxy = new Proxy(target, {
    set(_, prop, value) {
      if (prop === 'prototype') {
        fun.$prototypeId = value === null ? undefined : (value as Proxy).$id;
        return true;
      }
      if (lmIsReservedKey(prop)) return false;
      return lmSetOwn(fun, prop, value, toVal);
    },
    get(_, prop) {
      if (prop === '$isProxy') return true;
      if (prop === '$id') return fun.$id;
      if (prop === '$unwrapped') return fun;
      if (prop === 'prototype') return getFunPrototype(fun, funProxy);
      const own = lmGetOwn(fun, prop);
      if (own !== undefined) return deserialize(own);
      return undefined;
    },
    construct(_, args) {
      const instance = $obj({}, getFunPrototype(fun, funProxy));
      const result = callFn()?.apply(instance, args);
      if (typeof result === 'object' && result !== null) return result;
      return instance;
    },
    apply(_, thisArg, args) {
      return callFn()?.apply(thisArg, args);
    },
  }) as unknown as Proxy;
  proxies.set(fun.$id, funProxy);
  return funProxy;
}

function getFunPrototype(fun: Fun, funProxy: Proxy): Proxy {
  if (fun.$prototypeId) {
    return deserialize(lookupHeapEntry(fun.$prototypeId)!) as Proxy;
  }
  const proto = $obj({});
  fun.$prototypeId = proto.$id;
  return proto;
}

function ensureNewObjects() {
  if (!newObjects) newObjects = new Map();
  return newObjects;
}

function installHeapEntry(id: string, entry: Obj | Arr | Fun): void {
  ensureNewObjects().set(id, entry);
  objectTable[id] = entry;
}

function $obj(obj: Record<string, Val>, proto?: Proxy | null): Proxy {
  const $id = Math.random().toString();
  const entry: Obj = { $type: 'obj', $id };
  if (proto !== null && proto !== undefined) entry.$protoId = proto.$id;
  else if (proto === undefined) entry.$protoId = 'object-prototype';
  for (const [k, v] of Object.entries(obj)) {
    entry[k.startsWith('@') ? k : '@' + k] = toVal(v);
  }
  installHeapEntry($id, entry);
  return proxifyObj(entry);
}

function $fun($codeForShow: string, $code: string, scopes: Proxy[] = []): Proxy {
  const $id = Math.random().toString();
  const entry: Fun = { $type: 'fun', $id, $codeForShow, $code, $scopes: scopes.map((s) => ({ $type: 'ref', $id: s.$id })) };
  installHeapEntry($id, entry);
  return proxifyFun(entry);
}

function evalInChange(source: string): unknown {
  const runtime = { $global, $obj, $fun, Object, Array: { isArray: Array.isArray }, console };
  return new Function(...Object.keys(runtime), source)(...Object.values(runtime));
}

describe('change cycle toString', () => {
  it('survives gc and a second change when class and instances are in separate print-its', () => {
    change(() => {
      evalInChange(
        transpile(
          wrapForCompletionValue(`class Pt {
  constructor(x, y) { this.x = x; this.y = y; }
  toString() { return \`(\${this.x}, \${this.y})\`; }
}`),
        ),
      );
    });

    change(() => {
      evalInChange(
        transpile(
          wrapForCompletionValue(`const p2 = new Pt(3, 4);
return p2.toString();`),
        ),
      );
    });

    // simulate console access after second change
    beginChange();
    const p2 = ($global as any).p2 as Proxy;
    const method = p2.toString;
    expect(typeof method).toBe('function');
    expect(p2.toString()).toBe('(3, 4)');
    expect(p2.toString === Object.prototype.toString).toBe(false);
  });

  it('survives gc when class and instances are in one print-it then another unrelated print-it runs', () => {
    change(() => {
      evalInChange(
        transpile(
          wrapForCompletionValue(`class Pt {
  constructor(x, y) { this.x = x; this.y = y; }
  toString() { return \`(\${this.x}, \${this.y})\`; }
}
const p2 = new Pt(3, 4);`),
        ),
      );
    });

    change(() => {
      evalInChange('return 1 + 1;');
    });

    beginChange();
    const p2 = ($global as any).p2 as Proxy;
    expect(p2, 'p2 missing from $global after gc: ' + JSON.stringify(Object.keys(objectTable.global))).toBeDefined();
    expect(p2.toString()).toBe('(3, 4)');
    expect(p2.toString === Object.prototype.toString).toBe(false);
  });

  it('formats print-it results after a separate change reads from $global', () => {
    change(() => {
      evalInChange(
        transpile(
          wrapForCompletionValue(`class Pt {
  constructor(x, y) { this.x = x; this.y = y; }
  toString() { return \`(\${this.x}, \${this.y})\`; }
}
const p = new Pt(1, 2);`),
        ),
      );
    });

    let printed = '';
    change(() => {
      const p = ($global as any).p as Proxy;
      printed = p.toString();
    });
    expect(printed).toBe('(1, 2)');

    change(() => {
      const value = evalInChange(transpile(wrapForCompletionValue('p.toString()')));
      expect(value).toBe('(1, 2)');
    });
  });

  it('print-it on instance uses class toString after change ends (formatEvalResult path)', () => {
    let p1: Proxy | undefined;
    change(() => {
      evalInChange(
        transpile(
          wrapForCompletionValue(`class Pt {
  constructor(x, y) { this.x = x; this.y = y; }
  toString() { return \`(\${this.x}, \${this.y})\`; }
}
const p1 = new Pt(1, 2);
const p2 = new Pt(3, 4);
return p1;`),
        ),
      );
      p1 = ($global as any).p1 as Proxy;
    });
    // formatEvalResult runs after change() returns — newObjects is cleared by gc
    expect(newObjects).toBeNull();
    expect(lmCallToString(liveHeapObj(p1!.$unwrapped), p1!, lookupHeapProto, deserialize)).toBe(
      '(1, 2)',
    );
  });

  it('separate print-it of p1.toString() after class setup', () => {
    change(() => {
      evalInChange(
        transpile(
          wrapForCompletionValue(`class Pt {
  constructor(x, y) { this.x = x; this.y = y; }
  toString() { return \`(\${this.x}, \${this.y})\`; }
}
const p1 = new Pt(1, 2);
const p2 = new Pt(3, 4);
p1;`),
        ),
      );
    });

    let result: unknown;
    change(() => {
      result = evalInChange(transpile(wrapForCompletionValue('p1.toString()')));
    });
    expect(result).toBe('(1, 2)');
  });

  it('toString works for objectTable entries that hide keys from Object.hasOwn', () => {
    change(() => {
      evalInChange(
        transpile(
          wrapForCompletionValue(`class Pt {
  constructor(x, y) { this.x = x; this.y = y; }
  toString() { return \`(\${this.x}, \${this.y})\`; }
}
const p1 = new Pt(1, 2);`),
        ),
      );
    });

    const p1Id = (objectTable.global as Obj)['@p1'] as Ref;
    const rawP1 = objectTable[p1Id.$id] as Obj;
    const protoId = rawP1.$protoId!;
    const rawProto = objectTable[protoId] as Obj;
    newObjects = null;

    const hiddenProto = new Proxy(rawProto, {
      get(target, prop, receiver) {
        return Reflect.get(target, prop, receiver);
      },
      ownKeys(target) {
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor(target, prop) {
        if (prop === '@toString') return undefined;
        return Object.getOwnPropertyDescriptor(target, prop);
      },
    });
    objectTable[protoId] = hiddenProto as Obj;

    beginChange();
    const p1 = ($global as any).p1 as Proxy;
    expect(p1.toString()).toBe('(1, 2)');
  });
});
