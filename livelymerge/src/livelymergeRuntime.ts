import { transpile } from './transpiler';
import { wrapForCompletionValue } from './completionValue';
import { ensureObjectPrototypeDefaults } from './objectPrototypeDefaults';
import {
  lmCallToString,
  lmGetOwn,
  lmGetWithDelegation,
  lmHeapPropertyNames,
  lmIsReservedKey,
  lmObjDelegatesTo,
  lmOwnUserPropertyKeys,
  lmSetOwn,
} from './lmStorage';
import {
  type LivelymergeDoc,
  type Obj,
  type Arr,
  type Fun,
  type Ref,
  type Val,
  isObj,
  isArr,
  isRef,
  isFun,
} from './types';

export interface Proxy {
  $isProxy: boolean;
  $id: string;
  $toRef: Ref;
  $unwrapped: Obj | Arr | Fun;
}

/** Minimal doc handle — same contract as automerge-repo DocHandle.change */
export interface LivelymergeDocHandle {
  change(fn: (doc: LivelymergeDoc) => void): void;
}

export interface LivelymergeRuntime {
  /** Mod-d: evaluate source, return raw result (inside change; formatted after). */
  eval(source: string): unknown;
  /** Mod-p: evaluate source, return formatted print-it string (formatEvalResult after change). */
  printIt(source: string): string;
  change<T>(fn: () => T): T;
  formatEvalResult(value: unknown): string;
  doc(): LivelymergeDoc;
}

export function createLivelymergeRuntime(docHandle: LivelymergeDocHandle): LivelymergeRuntime {
  // docHandle from factory parameter
  let doc: LivelymergeDoc;
  let newObjects: Map<string, Obj | Arr | Fun> | null = null;
  let proxies: Map<string, Proxy> | null = null;
  let $global: any;

  let inChangeCall = false;

  function ensureHeapRoots(): void {
    if (!doc.objectTable['object-prototype']) {
      doc.objectTable['object-prototype'] = { $type: 'obj', $id: 'object-prototype' };
    }
    ensureObjectPrototypeDefaults(doc.objectTable);
    if (!doc.objectTable['timeout-fns']) {
      doc.objectTable['timeout-fns'] = { $type: 'obj', $id: 'timeout-fns' };
    }
    if (!doc.objectTable['interval-fns']) {
      doc.objectTable['interval-fns'] = { $type: 'obj', $id: 'interval-fns' };
    }
    if (!doc.objectTable['global']) {
      doc.objectTable['global'] = {
        $type: 'obj',
        $id: 'global',
        $protoId: 'object-prototype',
        $timeoutFns: { $type: 'ref', $id: 'timeout-fns' },
        $intervalFns: { $type: 'ref', $id: 'interval-fns' },
      };
    }
  }

  function ensureObjectPrototype(): void {
    ($Object as { prototype: Proxy }).prototype = deserialize(doc.objectTable['object-prototype']);
  }

  function change<T>(fn: () => T): T {
    if (inChangeCall) {
      return fn();
    }

    inChangeCall = true;
    newObjects = null;
    proxies = null;
    let exception: any;
    let returnValue: T | undefined = undefined;
    try {
      docHandle.change((_doc) => {
        doc = _doc;
        ensureHeapRoots();
        $global = (globalThis as any).$global = deserialize(doc.objectTable['global']);
        if (!$global) {
          throw new Error('Failed to initialize $global from document');
        }
        ensureObjectPrototype();
        try {
          returnValue = fn();
        } catch (e) {
          exception = e;
        } finally {
          gc(returnValue);
        }
      });
    } catch (e) {
      exception = exception ?? e;
    } finally {
      inChangeCall = false;
    }
    if (exception) {
      console.error(exception);
      if (exception instanceof Error) {
        console.error(exception.stack);
      }
      throw exception;
    }
    return returnValue!;
  }

  function isLmObj(x: unknown): boolean {
    return isProxy(x) && isObj(x.$unwrapped);
  }

  function unwrapLmObj(x: unknown): Obj | null {
    if (!isProxy(x) || !isObj(x.$unwrapped)) return null;
    return x.$unwrapped;
  }

  function unwrapLmArr(x: unknown): Arr | null {
    if (!isProxy(x) || !isArr(x.$unwrapped)) return null;
    return x.$unwrapped;
  }

  function lmArrayIndexKeys(arr: Arr): string[] {
    return arr.$values.map((_, i) => String(i));
  }

  function ownUserPropertyKeys(obj: Obj): Proxy {
    return $arr(lmOwnUserPropertyKeys(obj));
  }

  function lmHasOwn(obj: Obj, prop: string): boolean {
    return Object.hasOwn(obj, '@' + prop) || Object.hasOwn(obj, prop);
  }

  function lookupHeapEntry(id: string): Obj | Arr | Fun | undefined {
    return newObjects?.get(id) ?? doc.objectTable[id];
  }

  function lookupHeapProto(id: string): Obj | undefined {
    const val = lookupHeapEntry(id);
    return isObj(val) ? val : undefined;
  }

  function liveHeapObj(obj: Obj): Obj {
    const live = lookupHeapEntry(obj.$id);
    return isObj(live) ? live : obj;
  }

  function liveHeapFun(fun: Fun): Fun {
    const live = lookupHeapEntry(fun.$id);
    return isFun(live) ? live : fun;
  }

  function lmGetPrototypeOf(obj: Obj): Proxy | null {
    if (!obj.$protoId) return null;
    const entry = lookupHeapEntry(obj.$protoId);
    return entry ? deserialize(entry) : null;
  }

  function lmInstanceOf(instance: unknown, constructor: Proxy): boolean {
    if (!isProxy(constructor) || !isFun(constructor.$unwrapped)) return false;
    const fun = constructor.$unwrapped;
    if (!isConstructibleFun(fun)) return false;
    const instanceObj = unwrapLmObj(instance);
    if (!instanceObj) return false;
    const proto = unwrapLmObj(getFunPrototype(fun, constructor));
    if (!proto) return false;
    return lmObjDelegatesTo(instanceObj, proto, lookupHeapProto);
  }

  function $obj(obj: Record<string, Val>, proto?: Proxy | null) {
    const $id = Math.random().toString();
    const entry: Obj = {
      $type: 'obj',
      $id,
    };
    if (proto !== null) {
      entry.$protoId = proto?.$id ?? 'object-prototype';
    }
    for (const [k, v] of Object.entries(obj)) {
      entry[k.startsWith('@') ? k : '@' + k] = toVal(v);
    }
    installHeapEntry($id, entry);
    return deserialize(entry);
  }

  function $arr(values: any) {
    const $id = Math.random().toString();
    const entry: Arr = {
      $type: 'arr',
      $id,
      $values: values.map(toVal),
    };
    installHeapEntry($id, entry);
    return deserialize(entry);
  }

  function $fun($codeForShow: string, $code: string, scopes: Proxy[] = []) {
    const $id = Math.random().toString();
    const entry: Fun = {
      $type: 'fun',
      $id,
      $codeForShow,
      $code,
      $scopes: scopes.map(toRef),
    };
    installHeapEntry($id, entry);
    return deserialize(entry);
  }

  function ensureNewObjects() {
    if (!newObjects) {
      newObjects = new Map();
    }
    return newObjects;
  }

  function installHeapEntry(id: string, entry: Obj | Arr | Fun): void {
    ensureNewObjects().set(id, entry);
    doc.objectTable[id] = entry;
  }

  function toVal(x: any): Val {
    return isProxy(x) ? toRef(x) : x;
  }

  function toRef(proxy: Proxy): Ref {
    return { $type: 'ref', $id: proxy.$id };
  }

  function isProxy(x: any): x is Proxy {
    return (typeof x === 'object' || typeof x === 'function') && x != null && x.$isProxy;
  }

  function deserialize(value: any): Proxy {
    if (isRef(value)) {
      return deserialize(newObjects?.get(value.$id) ?? doc.objectTable[value.$id]);
    } else if (isObj(value)) {
      return proxifyObj(value);
    } else if (isArr(value)) {
      return proxifyArr(value);
    } else if (isFun(value)) {
      return proxifyFun(value);
    } else {
      return value;
    }
  }

  function proxifyObj(obj: Obj): Proxy {
    let p = proxies?.get(obj.$id);
    if (p) {
      return p;
    }

    let _ref: Ref | null = null;
    const ref = () => {
      if (!_ref) {
        _ref = { $type: 'ref', $id: obj.$id };
      }
      return _ref;
    };

    p = new Proxy(Object.create(null), {
      set(_, prop, value) {
        if (lmIsReservedKey(prop)) return false;
        return lmSetOwn(liveHeapObj(obj), prop, value, toVal);
      },
      get(_, prop) {
        const entry = liveHeapObj(obj);
        switch (prop) {
          case '$isProxy':
            return true;
          case '$id':
            return entry.$id;
          case '$toRef':
            return ref();
          case '$unwrapped':
            return entry;
          case '__proto__':
            return !entry.$protoId ? null : lmGetPrototypeOf(entry);
        }

        if (lmIsReservedKey(prop)) return undefined;

        const value = lmGetWithDelegation(entry, prop, lookupHeapProto, deserialize);
        if (value !== undefined) return value;

        if (prop === 'toString') {
          return () => `[obj ${entry.$id}]`;
        }

        return undefined;
      },
    }) as unknown as Proxy;

    ensureProxies().set(obj.$id, p);
    return p;
  }

  function unsupportedArrayAccess(kind: 'read' | 'write', prop: string | symbol): never {
    throw new Error(`Unsupported array ${kind}: ${String(prop)}`);
  }

  function proxifyArr(arr: Arr): Proxy {
    let p = proxies?.get(arr.$id);
    if (p) {
      return p;
    }

    let _ref: Ref | null = null;
    const ref = () => {
      if (!_ref) {
        _ref = { $type: 'ref', $id: arr.$id };
      }
      return _ref;
    };

    p = new Proxy(arr, {
      set(_, prop, value) {
        if (prop === 'length') {
          arr.$values.length = Number(value);
          return true;
        }
        if (isArrayIndexKey(prop) && prop !== 'length') {
          const idx = typeof prop === 'number' ? prop : Number(prop);
          arr.$values[idx] = toVal(value);
          return true;
        }
        unsupportedArrayAccess('write', prop);
      },
      get(_, prop) {
        switch (prop) {
          case '$isProxy':
            return true;
          case '$id':
            return arr.$id;
          case '$toRef':
            return ref();
          case '$unwrapped':
            return arr;
          case 'toString':
            return () => `[${arr.$values.map(deserialize).map((x) => x.toString())}]`;

          // override array methods
          case 'at': {
            return function (index: number) {
              return deserialize(arr.$values.at(index));
            };
          }
          case 'push': {
            return function () {
              for (const arg of arguments) {
                arr.$values.push(toVal(arg));
              }
              return arr.$values.length;
            };
          }
          case 'pop': {
            return function () {
              return deserialize(arr.$values.pop());
            };
          }
          case 'unshift': {
            return function () {
              for (const arg of arguments) {
                arr.$values.unshift(toVal(arg));
              }
              return arr.$values.length;
            };
          }
          case 'shift': {
            return function () {
              return deserialize(arr.$values.shift());
            };
          }
          case 'findIndex': {
            return function (predicate: (value: any, index: number) => boolean, thisArg?: any) {
              return arr.$values.map(deserialize).findIndex(predicate, thisArg);
            };
          }
          case 'find': {
            return function (predicate: (value: any, index: number) => boolean, thisArg?: any) {
              return arr.$values.map(deserialize).find(predicate, thisArg);
            };
          }
          case 'filter': {
            return function (predicate: (value: any, index: number) => boolean, thisArg?: any) {
              return $arr(arr.$values.map(deserialize).filter(predicate, thisArg));
            };
          }
          case 'includes': {
            return function (searchElement: any, fromIndex?: number) {
              return arr.$values.map(deserialize).includes(searchElement, fromIndex);
            };
          }
          case 'indexOf': {
            return function (searchElement: any, fromIndex?: number) {
              return arr.$values.map(deserialize).indexOf(searchElement, fromIndex);
            };
          }
          case 'forEach': {
            return function (callbackFn: (value: any, index: number) => void, thisArg?: any) {
              arr.$values.map(deserialize).forEach(callbackFn, thisArg);
            };
          }
          case 'reduce': {
            return function (
              callbackFn: (accumulator: any, value: any, index: number) => any,
              initialValue?: any,
            ) {
              const items = arr.$values.map(deserialize);
              if (arguments.length >= 2) {
                return items.reduce(callbackFn, initialValue);
              }
              return items.reduce(callbackFn);
            };
          }
          case 'map': {
            return function (callbackFn: (value: any) => any, thisArg?: any) {
              return $arr(arr.$values.map(deserialize).map(callbackFn, thisArg));
            };
          }
          case 'slice': {
            return function (startIdx: number, endIdx?: number) {
              return $arr(arr.$values.slice(startIdx, endIdx).map(deserialize));
            };
          }
          case 'splice': {
            return function (startIdx: number, deleteCount = 0, ...args: any[]) {
              return $arr(
                arr.$values.splice(startIdx, deleteCount, ...args.map(toVal)).map(deserialize),
              );
            };
          }
          case 'concat': {
            return function (...args: any[]) {
              return $arr(arr.$values.concat(...args.map(toVal)).map(deserialize));
            };
          }
          case 'join': {
            return function (separator?: string) {
              return arr.$values.map(deserialize).join(separator);
            };
          }
          case 'sort': {
            return function (compareFn?: (a: any, b: any) => number) {
              const sorted = arr.$values.map(deserialize).sort(compareFn);
              arr.$values.splice(0, arr.$values.length, ...sorted.map(toVal));
              return p;
            };
          }
          case 'toReversed': {
            return function () {
              return $arr(arr.$values.map(deserialize).toReversed());
            };
          }
          case 'toSorted': {
            return function (compareFn?: (a: any, b: any) => number) {
              return $arr(arr.$values.map(deserialize).toSorted(compareFn));
            };
          }
          case 'toSpliced': {
            return function (start: number, deleteCount?: number, ...items: any[]) {
              const copy = arr.$values.map(deserialize);
              if (arguments.length === 1) return $arr(copy.toSpliced(start));
              if (arguments.length === 2) return $arr(copy.toSpliced(start, deleteCount as number));
              return $arr(copy.toSpliced(start, deleteCount as number, ...items));
            };
          }
          case 'with': {
            return function (index: number, value: any) {
              return $arr(arr.$values.map(deserialize).with(index, value));
            };
          }
          case Symbol.iterator: {
            return function () {
              let i = 0;
              return {
                [Symbol.iterator]() {
                  return this;
                },
                next() {
                  if (i >= arr.$values.length) {
                    return { done: true, value: undefined };
                  }
                  return { done: false, value: deserialize(arr.$values[i++]) };
                },
              };
            };
          }
        }

        if (prop === 'length') {
          return arr.$values.length;
        }

        if (isArrayIndexKey(prop)) {
          return deserialize(arr.$values[prop as any]);
        }

        unsupportedArrayAccess('read', prop);
      },
      ownKeys() {
        const keys: Array<string | symbol> = lmArrayIndexKeys(arr);
        keys.push('length');
        return keys;
      },
      getOwnPropertyDescriptor(_fake, prop) {
        if (prop === '$unwrapped') {
          return undefined;
        }
        if (isArrayIndexKey(prop)) {
          if (prop === 'length') {
            return {
              value: arr.$values.length,
              writable: true,
              enumerable: false,
              configurable: false,
            };
          }
          const idx = typeof prop === 'string' ? Number(prop) : prop;
          if (typeof idx === 'number' && idx >= 0 && idx < arr.$values.length) {
            return {
              value: deserialize(arr.$values[idx]),
              writable: true,
              enumerable: true,
              configurable: true,
            };
          }
          return undefined;
        }
        return undefined;
      },
    }) as unknown as Proxy;
    ensureProxies().set(arr.$id, p);
    return p;
  }

  function isArrayIndexKey(prop: string | symbol): boolean {
    if (prop === 'length') {
      return true;
    }
    if (typeof prop === 'number') {
      return Number.isInteger(prop) && prop >= 0;
    }
    if (typeof prop === 'string' && /^[0-9]+$/.test(prop)) {
      return true;
    }
    return false;
  }

  function formatEvalResult(value: unknown): string {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';

    if (isProxy(value)) {
      const unwrapped = value.$unwrapped;
      if (isObj(unwrapped)) {
        return lmCallToString(liveHeapObj(unwrapped), value, lookupHeapProto, deserialize);
      }
      return value.toString();
    }

    if (isObj(value)) {
      return lmCallToString(liveHeapObj(value), deserialize(value), lookupHeapProto, deserialize);
    }

    try {
      return '' + value;
    } catch {
      return `[${typeof value}]`;
    }
  }

  function consoleFormatArg(value: unknown): unknown {
    if (value === undefined || value === null) return value;
    if (isProxy(value)) {
      if (isObj(value.$unwrapped)) {
        return formatEvalResult(value);
      }
      return (value as { toString(): string }).toString();
    }
    if (isObj(value)) {
      return formatEvalResult(value);
    }
    return (value as { toString(): string }).toString();
  }

  function consoleFormatArgs(args: unknown[]): unknown[] {
    return args.map(consoleFormatArg);
  }

  const $console = {
    log(...args: unknown[]) {
      console.log(...consoleFormatArgs(args));
    },
    info(...args: unknown[]) {
      console.info(...consoleFormatArgs(args));
    },
    error(...args: unknown[]) {
      console.error(...consoleFormatArgs(args));
    },
  };

  function isConstructibleFun(fun: Fun): boolean {
    return /=>\s*(async\s+)?function\b/.test(fun.$code);
  }

  function getFunPrototype(fun: Fun, funProxy: Proxy): Proxy {
    const live = liveHeapFun(fun);
    if (live.$prototypeId) {
      return deserialize(lookupHeapEntry(live.$prototypeId)!);
    }
    const proto = $obj({});
    (proto as any).constructor = funProxy;
    live.$prototypeId = proto.$id;
    return proto;
  }

  function proxifyFun(fun: Fun): Proxy {
    const existing = proxies?.get(fun.$id);
    if (existing) {
      return existing;
    }

    let _ref: Ref | null = null;
    const ref = () => {
      if (!_ref) {
        _ref = { $type: 'ref', $id: fun.$id };
      }
      return _ref;
    };

    let _fn: ((...args: any[]) => any) | null = null;
    const fn: () => (...args: any[]) => any = () => {
      if (!_fn) {
        _fn = getCodeFactory(fun.$code)(...liveHeapFun(fun).$scopes.map(deserialize)) as (
          ...args: any[]
        ) => any;
      }
      return _fn;
    };

    let funProxy: Proxy;
    const target = function () { };
    Object.defineProperty(target, Symbol.hasInstance, {
      value: (instance: unknown) => lmInstanceOf(instance, funProxy!),
    });
    funProxy = new Proxy(target, {
      set(_, prop, value) {
        const live = liveHeapFun(fun);
        if (prop === 'prototype') {
          if (!isConstructibleFun(live)) {
            return false;
          }
          if (value !== null && !isLmObj(value)) {
            throw new TypeError('Function.prototype is not an object or null');
          }
          live.$prototypeId = value === null ? undefined : value.$id;
          return true;
        }
        if (lmIsReservedKey(prop)) return false;
        if (!lmSetOwn(live, prop, value, toVal)) return false;
        return true;
      },
      get(_, prop) {
        const live = liveHeapFun(fun);
        switch (prop) {
          case '$isProxy':
            return true;
          case '$id':
            return live.$id;
          case '$toRef':
            return ref();
          case '$unwrapped':
            return live;
          case 'prototype':
            if (!isConstructibleFun(live)) {
              return undefined;
            }
            return getFunPrototype(live, funProxy);
          case 'toString':
            return () => live.$codeForShow;
          case 'call':
            return (thisArg: unknown, ...args: unknown[]) => fn().apply(thisArg, args);
          case 'apply':
            return (thisArg: unknown, args: unknown[]) => fn().apply(thisArg, args);
        }
        if (lmIsReservedKey(prop)) return undefined;
        const own = lmGetOwn(live, prop);
        if (own !== undefined) return deserialize(own);
        return undefined;
      },
      apply(_, thisArg, args) {
        return fn().apply(thisArg, args);
      },
      construct(_, args) {
        const live = liveHeapFun(fun);
        if (!isConstructibleFun(live)) {
          throw new TypeError('Not a constructor');
        }
        const instance = $obj({}, getFunPrototype(live, funProxy));
        const result = fn().apply(instance, args);
        if (typeof result === 'object' && result !== null) {
          return result;
        }
        return instance;
      },
    }) as unknown as Proxy;
    ensureProxies().set(fun.$id, funProxy);
    return funProxy;
  }

  function ensureProxies() {
    if (!proxies) {
      proxies = new Map();
    }
    return proxies;
  }

  function gc(extraRoot?: unknown) {
    const visited = new Set<string>();
    function visit(id: string) {
      if (visited.has(id)) {
        return;
      }
      visited.add(id);

      let val = newObjects?.get(id);
      if (val) {
        doc.objectTable[id] = val;
      } else {
        val = doc.objectTable[id];
        if (!val) {
          throw new Error('BAD: missing referent with id ' + id);
        }
      }

      if (isObj(val)) {
        for (const p of lmHeapPropertyNames(val)) {
          lookAt(val[p]);
        }
        if (val.$protoId != null) {
          visit(val.$protoId);
        }
      } else if (isArr(val)) {
        for (let i = 0; i < val.$values.length; i++) {
          lookAt(val.$values[i]);
        }
      } else if (isFun(val)) {
        for (const v of val.$scopes) {
          lookAt(v);
        }
        if (val.$prototypeId != null) {
          visit(val.$prototypeId);
        }
        for (const prop of lmOwnUserPropertyKeys(val)) {
          lookAt(lmGetOwn(val, prop) as Val);
        }
      } else {
        throw new Error('WAT');
      }
    }

    function lookAt(v: Val) {
      if (isRef(v)) {
        visit(v.$id);
      }
    }

    visit('global');
    if (isProxy(extraRoot)) {
      visit(extraRoot.$id);
    }
    let numReclaimed = 0;
    for (const id of Object.keys(doc.objectTable)) {
      if (!visited.has(id)) {
        delete doc.objectTable[id];
        numReclaimed++;
      }
    }
    if ((globalThis as any).debugGC) {
      console.log('reclaimed', numReclaimed, 'objects');
    }
    newObjects = null;
  }

  // Object

  interface $Object {
    (value?: unknown): Proxy;
    create(proto: Proxy | null): Proxy;
    keys(obj: unknown): Proxy;
    values(obj: unknown): Proxy;
    entries(obj: unknown): Proxy;
    hasOwn(obj: unknown, prop: PropertyKey): boolean;
    getOwnPropertyNames(obj: unknown): Proxy;
    getPrototypeOf(obj: unknown): Proxy | null;
  }

  const $Object = function Object(value?: unknown) {
    if (value !== undefined && value !== null) {
      throw new Error('Object(value) is not supported yet');
    }
    return $obj({});
  } as $Object;

  $Object.create = function (proto: Proxy | null) {
    if (proto !== null && !isLmObj(proto)) {
      throw new TypeError('Object prototype may only be an Object or null');
    }
    return $obj({}, proto);
  };

  $Object.keys = function (obj: unknown) {
    const objUnwrapped = unwrapLmObj(obj);
    if (objUnwrapped) return ownUserPropertyKeys(objUnwrapped);
    const arrUnwrapped = unwrapLmArr(obj);
    if (arrUnwrapped) return $arr(lmArrayIndexKeys(arrUnwrapped));
    return $arr(Object.keys(obj as object));
  };

  $Object.values = function (obj: unknown) {
    return ($Object.keys(obj) as any).map((key: string) => (obj as any)[key]);
  };

  $Object.entries = function (obj: any) {
    return ($Object.keys(obj) as any).map((key: string) => $arr([key, obj[key]]));
  };

  $Object.hasOwn = function (obj: unknown, prop: PropertyKey) {
    const unwrapped = unwrapLmObj(obj);
    if (unwrapped) {
      if (typeof prop !== 'string') return false;
      return lmHasOwn(unwrapped, prop);
    }
    return Object.hasOwn(obj as object, prop);
  };

  $Object.getOwnPropertyNames = function (obj: unknown) {
    const objUnwrapped = unwrapLmObj(obj);
    if (objUnwrapped) return ownUserPropertyKeys(objUnwrapped);
    const arrUnwrapped = unwrapLmArr(obj);
    if (arrUnwrapped) return $arr([...lmArrayIndexKeys(arrUnwrapped), 'length']);
    return $arr(Object.getOwnPropertyNames(obj as object));
  };

  $Object.getPrototypeOf = function (obj: unknown) {
    const unwrapped = unwrapLmObj(obj);
    return unwrapped ? lmGetPrototypeOf(unwrapped) : Object.getPrototypeOf(obj as object);
  };

  Object.defineProperty($Object, Symbol.hasInstance, {
    value: (x: unknown) => isLmObj(x),
  });

  // Array

  interface $Array {
    (...args: any[]): Proxy;
    isArray(x: unknown): boolean;
    from(
      iterable: Iterable<any> | ArrayLike<any>,
      mapFn?: (value: any, index: number) => any,
      thisArg?: any,
    ): Proxy;
    of(...items: any[]): Proxy;
  }

  const $Array = function Array(...args: any[]) {
    if (args.length === 1 && typeof args[0] === 'number') {
      const n = args[0];
      const len = n >>> 0;
      if (len !== n) {
        throw new RangeError('Invalid array length');
      }
      return $arr(globalThis.Array.from({ length: len }));
    }
    return $arr(args);
  } as $Array;

  $Array.isArray = (x: unknown) => isProxy(x) && isArr(x.$unwrapped);

  $Array.from = (
    iterable: Iterable<any> | ArrayLike<any>,
    mapFn?: (value: any, index: number) => any,
    thisArg?: any,
  ) => $arr(mapFn ? Array.from(iterable, mapFn, thisArg) : Array.from(iterable));

  $Array.of = function (...items: any[]) {
    return $arr(items);
  };

  Object.defineProperty($Array, Symbol.hasInstance, {
    value: (x: unknown) => $Array.isArray(x),
  });

  // setTimeout & friends

  function $setTimeout(fn: () => void, delay?: number) {
    const id = setTimeout(() => {
      change(() => {
        try {
          fn();
        } finally {
          delete (doc.objectTable['timeout-fns'] as Obj)[id as any];
        }
      });
    }, delay);
    change(() => {
      (doc.objectTable['timeout-fns'] as Obj)[id as any] = toVal(fn);
    });
    return id;
  }

  function $clearTimeout(id: number) {
    clearTimeout(id);
    change(() => {
      delete (doc.objectTable['timeout-fns'] as Obj)[id as any];
    });
  }

  function $setInterval(fn: () => void, period?: number) {
    const id = setInterval(() => change(fn), period);
    change(() => {
      (doc.objectTable['interval-fns'] as Obj)[id as any] = toVal(fn);
    });
    return id;
  }

  function $clearInterval(id: number) {
    clearInterval(id);
    change(() => {
      delete (doc.objectTable['interval-fns'] as Obj)[id as any];
    });
  }

  function getRuntimeParams(): Record<string, unknown> {
    return {
      $global,
      $obj,
      $arr,
      $fun,
      Object: $Object,
      Array: $Array,
      console: $console,
      setTimeout: $setTimeout,
      clearTimeout: $clearTimeout,
      setInterval: $setInterval,
      clearInterval: $clearInterval,
    };
  }

  const codeFactoryCache = new Map<
    string,
    (...runtime: unknown[]) => (...scopeArgs: unknown[]) => unknown
  >();

  function getCodeFactory(code: string): (...scopeArgs: unknown[]) => unknown {
    let factory = codeFactoryCache.get(code);
    if (!factory) {
      const runtimeParams = getRuntimeParams();
      factory = new Function(...Object.keys(runtimeParams), 'return ' + code) as (
        ...runtime: unknown[]
      ) => (...scopeArgs: unknown[]) => unknown;
      codeFactoryCache.set(code, factory);
    }
    const runtimeParams = getRuntimeParams();
    return factory(...Object.values(runtimeParams));
  }
  function evaluateSource(source: string): unknown {
    return change(() => {
      const realCode = transpile(wrapForCompletionValue(source));
      console.log('realCode', realCode);
      const runtimeParams = getRuntimeParams();
      return new Function(...Object.keys(runtimeParams), realCode)(
        ...Object.values(runtimeParams),
      );
    });
  }

  return {
    eval(source: string) {
      return evaluateSource(source);
    },
    printIt(source: string) {
      const raw = evaluateSource(source);
      return formatEvalResult(raw);
    },
    change,
    formatEvalResult,
    doc() {
      return doc;
    },
  };
}
