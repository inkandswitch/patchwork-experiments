/** Minimal LM runtime for tests — mirrors Livelymerge eval primitives. */
import {
  lmGetOwn,
  lmGetWithDelegation,
  lmIsReservedKey,
  lmObjDelegatesTo,
  lmOwnUserPropertyKeys,
  lmSetOwn,
} from './lmStorage';
import { ensureObjectPrototypeDefaults } from './objectPrototypeDefaults';
import type { Fun, Obj, Ref, Val } from './types';
import { isFun, isObj, isRef } from './types';

export interface TestProxy {
  $isProxy: boolean;
  $id: string;
  $unwrapped: Obj | Fun;
}

let objectTable: Record<string, Obj | Fun> = {
  'object-prototype': { $type: 'obj', $id: 'object-prototype' },
};
let newObjects: Map<string, Obj | Fun> | null = null;
let proxies: Map<string, TestProxy> | null = null;
export let $global: TestProxy;

function ensureNewObjects() {
  if (!newObjects) newObjects = new Map();
  return newObjects;
}

function installHeapEntry(id: string, entry: Obj | Fun): void {
  ensureNewObjects().set(id, entry);
  objectTable[id] = entry;
}

function ensureProxies() {
  if (!proxies) proxies = new Map();
  return proxies;
}

function toVal(x: unknown): Val {
  return isTestProxy(x) ? toRef(x) : (x as Val);
}

function toRef(proxy: TestProxy): Ref {
  return { $type: 'ref', $id: proxy.$id };
}

function isTestProxy(x: unknown): x is TestProxy {
  return (typeof x === 'object' || typeof x === 'function') && x != null && (x as TestProxy).$isProxy;
}

function lookupHeapObj(id: string): Obj | undefined {
  const val = newObjects?.get(id) ?? objectTable[id];
  return isObj(val) ? val : undefined;
}

function deserialize(value: unknown): unknown {
  if (isRef(value)) {
    return deserialize(newObjects?.get(value.$id) ?? objectTable[value.$id]);
  }
  if (isObj(value)) return proxifyObj(value);
  if (isFun(value)) return proxifyFun(value);
  return value;
}

function lookupHeapProto(id: string): Obj | undefined {
  const val = newObjects?.get(id) ?? objectTable[id];
  return isObj(val) ? val : undefined;
}

function liveHeapObj(obj: Obj): Obj {
  const live = newObjects?.get(obj.$id) ?? objectTable[obj.$id];
  return isObj(live) ? live : obj;
}

function proxifyObj(obj: Obj): TestProxy {
  const existing = ensureProxies().get(obj.$id);
  if (existing) return existing;

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
      if (prop === '__proto__') {
        if (!entry.$protoId) return null;
        const protoEntry = lookupHeapProto(entry.$protoId);
        return protoEntry ? deserialize(protoEntry) : null;
      }
      const value = lmGetWithDelegation(entry, prop, lookupHeapProto, deserialize);
      if (value !== undefined) return value;
      if (prop === 'toString') {
        return () => `[obj ${entry.$id}]`;
      }
      return undefined;
    },
  }) as unknown as TestProxy;

  ensureProxies().set(obj.$id, p);
  return p;
}

function isConstructibleFun(fun: Fun): boolean {
  return /=>\s*(async\s+)?function\b/.test(fun.$code);
}

function getFunPrototype(fun: Fun, funProxy: TestProxy): TestProxy {
  if (fun.$prototypeId) {
    const entry = newObjects?.get(fun.$prototypeId) ?? objectTable[fun.$prototypeId];
    return deserialize(entry!) as TestProxy;
  }
  const proto = $obj({});
  (proto as unknown as { constructor: TestProxy }).constructor = funProxy;
  fun.$prototypeId = proto.$id;
  return proto;
}

function getCodeFactory(code: string): (...args: unknown[]) => unknown {
  return new Function('return ' + code)() as (...args: unknown[]) => unknown;
}

function proxifyFun(fun: Fun): TestProxy {
  const existing = ensureProxies().get(fun.$id);
  if (existing) return existing;

  let fn: ((...args: unknown[]) => unknown) | null = null;
  const callFn = () => {
    if (!fn) fn = getCodeFactory(fun.$code)(...fun.$scopes.map(deserialize)) as (...args: unknown[]) => unknown;
    return fn;
  };

  let funProxy: TestProxy;
  const target = function () {};
  funProxy = new Proxy(target, {
    set(_, prop, value) {
      if (prop === 'prototype') {
        if (!isConstructibleFun(fun)) return false;
        if (value !== null && !isTestProxy(value)) {
          throw new TypeError('Function.prototype is not an object or null');
        }
        fun.$prototypeId = value === null ? undefined : (value as TestProxy).$id;
        return true;
      }
      if (lmIsReservedKey(prop)) return false;
      return lmSetOwn(fun, prop, value, toVal);
    },
    get(_, prop) {
      if (prop === '$isProxy') return true;
      if (prop === '$id') return fun.$id;
      if (prop === '$unwrapped') return fun;
      if (prop === 'prototype') {
        if (!isConstructibleFun(fun)) return undefined;
        return getFunPrototype(fun, funProxy);
      }
      const own = lmGetOwn(fun, prop);
      if (own !== undefined) return deserialize(own);
      return undefined;
    },
    apply(_, thisArg, args) {
      return callFn().apply(thisArg, args);
    },
    construct(_, args) {
      if (!isConstructibleFun(fun)) throw new TypeError('Not a constructor');
      const instance = $obj({}, getFunPrototype(fun, funProxy));
      const result = callFn().apply(instance, args);
      if (typeof result === 'object' && result !== null) return result;
      return instance;
    },
  }) as unknown as TestProxy;

  ensureProxies().set(fun.$id, funProxy);
  return funProxy;
}

export function $obj(obj: Record<string, Val>, proto?: TestProxy | null): TestProxy {
  const $id = Math.random().toString();
  const entry: Obj = { $type: 'obj', $id };
  if (proto !== null && proto !== undefined) {
    entry.$protoId = proto.$id;
  } else if (proto === undefined) {
    entry.$protoId = 'object-prototype';
  }
  for (const [k, v] of Object.entries(obj)) {
    entry[k.startsWith('@') ? k : '@' + k] = toVal(v);
  }
  installHeapEntry($id, entry);
  return proxifyObj(entry);
}

export function commitEvalObjects() {
  if (!newObjects) return;
  for (const [id, entry] of newObjects) {
    objectTable[id] = entry;
  }
}

export function $fun($codeForShow: string, $code: string, scopes: TestProxy[] = []): TestProxy {
  const $id = Math.random().toString();
  const entry: Fun = {
    $type: 'fun',
    $id,
    $codeForShow,
    $code,
    $scopes: scopes.map(toRef),
  };
  installHeapEntry($id, entry);
  return proxifyFun(entry);
}

export function $arr(values: unknown[]): TestProxy {
  return $obj(Object.fromEntries(values.map((v, i) => [String(i), toVal(v)])));
}

const $Object = Object.assign(function Object() {
  return $obj({});
}, {
  create(proto: TestProxy | null) {
    return $obj({}, proto);
  },
  keys(obj: TestProxy) {
    return $arr(lmOwnUserPropertyKeys(obj.$unwrapped as Obj));
  },
  getPrototypeOf(obj: TestProxy) {
    const o = obj.$unwrapped as Obj;
    return o.$protoId ? (deserialize(objectTable[o.$protoId]) as TestProxy) : null;
  },
  getOwnPropertyNames(obj: TestProxy) {
    return $arr(lmOwnUserPropertyKeys(obj.$unwrapped as Obj));
  },
});

export function resetEvalHarness() {
  objectTable = { 'object-prototype': { $type: 'obj', $id: 'object-prototype' } };
  ensureObjectPrototypeDefaults(objectTable);
  newObjects = null;
  proxies = null;
  $global = $obj({});
}

export function evalTranspiled(source: string): unknown {
  resetEvalHarness();
  const runtime = {
    $global,
    $obj,
    $arr,
    $fun,
    Object: $Object,
    Array: { isArray: Array.isArray },
    console,
  };
  return new Function(...Object.keys(runtime), source)(...Object.values(runtime));
}

export function lmInstanceOf(instance: unknown, constructor: TestProxy): boolean {
  if (!isTestProxy(constructor) || !isFun(constructor.$unwrapped)) return false;
  const fun = constructor.$unwrapped;
  if (!isConstructibleFun(fun)) return false;
  const instanceObj = instance as TestProxy;
  if (!isTestProxy(instanceObj) || !isObj(instanceObj.$unwrapped)) return false;
  const proto = getFunPrototype(fun, constructor);
  if (!proto || !isObj(proto.$unwrapped)) return false;
  return lmObjDelegatesTo(instanceObj.$unwrapped, proto.$unwrapped, lookupHeapObj);
}
