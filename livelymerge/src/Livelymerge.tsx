import { Automerge } from '@automerge/automerge-repo/slim';
import type { AutomergeUrl, Doc, DocHandle } from '@automerge/automerge-repo';
import { RepoContext, useDocHandle } from '@automerge/automerge-repo-react-hooks';
import { javascript } from '@codemirror/lang-javascript';
import { EditorState, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { EditorView, basicSetup } from 'codemirror';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as DomPointerEvent,
  type TransitionEvent,
} from 'react';

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
import { createRoot } from 'react-dom/client';
import type { ToolElement, ToolImplementation } from '@inkandswitch/patchwork-plugins';
import './styles.css';
import { transpile } from './transpiler';
import { wrapForCompletionValue } from './completionValue';
import { ensureObjectPrototypeDefaults } from './objectPrototypeDefaults';
import {
  lmGetOwn,
  lmGetWithDelegation,
  lmIsReservedKey,
  lmObjDelegatesTo,
  lmOwnUserPropertyKeys,
  lmSetOwn,
} from './lmStorage';

interface Proxy {
  $isProxy: boolean;
  $id: string;
  $toRef: Ref;
  $unwrapped: Obj | Arr | Fun;
}

let docHandle: DocHandle<LivelymergeDoc>;
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

function change(fn: () => void) {
  if (inChangeCall) {
    fn();
    return;
  }

  inChangeCall = true;
  newObjects = null;
  proxies = null;
  let exception: any;
  try {
    docHandle.change((_doc) => {
      doc = _doc;
      ensureHeapRoots();
      $global = (window as any).$global = deserialize(doc.objectTable['global']);
      if (!$global) {
        throw new Error('Failed to initialize $global from document');
      }
      ensureObjectPrototype();
      try {
        fn();
      } catch (e) {
        exception = e;
      } finally {
        gc();
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
}

function isLmObj(x: unknown): boolean {
  return isProxy(x) && isObj(x.$unwrapped);
}

function unwrapLmObj(x: unknown): Obj | null {
  if (!isProxy(x) || !isObj(x.$unwrapped)) return null;
  return x.$unwrapped;
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
  ensureNewObjects().set($id, entry);
  return deserialize(entry);
}

function $arr(values: any) {
  const $id = Math.random().toString();
  const entry: Arr = {
    $type: 'arr',
    $id,
    $values: values.map(toVal),
  };
  ensureNewObjects().set($id, entry);
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
  ensureNewObjects().set($id, entry);
  return deserialize(entry);
}

function ensureNewObjects() {
  if (!newObjects) {
    newObjects = new Map();
  }
  return newObjects;
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

  p = new Proxy(obj, {
    set(_, prop, value) {
      if (lmIsReservedKey(prop)) return false;
      return lmSetOwn(obj, prop, value, toVal);
    },
    get(_, prop) {
      switch (prop) {
        case '$isProxy':
          return true;
        case '$id':
          return obj.$id;
        case '$toRef':
          return ref();
        case '$unwrapped':
          return obj;
        case '__proto__':
          return !obj.$protoId ? null : lmGetPrototypeOf(obj);
      }

      if (lmIsReservedKey(prop)) return undefined;

      const value = lmGetWithDelegation(obj, prop, lookupHeapProto, deserialize);
      if (value !== undefined) return value;

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

function formatEvalResult(value: any): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (isProxy(value)) {
    if (isObj(value.$unwrapped)) return `[obj ${value.$id}]`;
    return value.toString();
  }
  try {
    return '' + value;
  } catch {
    return `[${typeof value}]`;
  }
}

function consoleFormatArg(value: unknown): unknown {
  if (value === undefined || value === null) return value;
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
  if (fun.$prototypeId) {
    return deserialize(newObjects?.get(fun.$prototypeId) ?? doc.objectTable[fun.$prototypeId]);
  }
  const proto = $obj({});
  (proto as any).constructor = funProxy;
  fun.$prototypeId = proto.$id;
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
      _fn = getCodeFactory(fun.$code)(...fun.$scopes.map(deserialize)) as (...args: any[]) => any;
    }
    return _fn;
  };

  let funProxy: Proxy;
  const target = function () {};
  Object.defineProperty(target, Symbol.hasInstance, {
    value: (instance: unknown) => lmInstanceOf(instance, funProxy!),
  });
  funProxy = new Proxy(target, {
    set(_, prop, value) {
      if (prop === 'prototype') {
        if (!isConstructibleFun(fun)) {
          return false;
        }
        if (value !== null && !isLmObj(value)) {
          throw new TypeError('Function.prototype is not an object or null');
        }
        fun.$prototypeId = value === null ? undefined : value.$id;
        return true;
      }
      if (lmIsReservedKey(prop)) return false;
      if (!lmSetOwn(fun, prop, value, toVal)) return false;
      return true;
    },
    get(_, prop) {
      switch (prop) {
        case '$isProxy':
          return true;
        case '$id':
          return fun.$id;
        case '$toRef':
          return ref();
        case '$unwrapped':
          return fun;
        case 'prototype':
          if (!isConstructibleFun(fun)) {
            return undefined;
          }
          return getFunPrototype(fun, funProxy);
        case 'toString':
          return () => fun.$codeForShow;
        case 'call':
          return (thisArg: unknown, ...args: unknown[]) => fn().apply(thisArg, args);
        case 'apply':
          return (thisArg: unknown, args: unknown[]) => fn().apply(thisArg, args);
      }
      if (lmIsReservedKey(prop)) return undefined;
      const own = lmGetOwn(fun, prop);
      if (own !== undefined) return deserialize(own);
      return undefined;
    },
    apply(_, thisArg, args) {
      return fn().apply(thisArg, args);
    },
    construct(_, args) {
      if (!isConstructibleFun(fun)) {
        throw new TypeError('Not a constructor');
      }
      const instance = $obj({}, getFunPrototype(fun, funProxy));
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

function gc() {
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
      for (const p of Object.getOwnPropertyNames(val)) {
        // console.log('looking at', val.$id, p, val[p]);
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
  let numReclaimed = 0;
  for (const id of Object.keys(doc.objectTable)) {
    if (!visited.has(id)) {
      delete doc.objectTable[id];
      numReclaimed++;
    }
  }
  if ((window as any).debugGC) {
    console.log('reclaimed', numReclaimed, 'objects');
  }
  newObjects = null;
}

const DEFAULT_DRAWER_HEIGHT = 250;
const MIN_DRAWER_HEIGHT = 120;

function clampDrawerHeight(px: number): number {
  const max = Math.floor(window.innerHeight * 0.92);
  return Math.min(Math.max(px, MIN_DRAWER_HEIGHT), max);
}

const codeMirrorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '13px' },
  '.cm-editor': { height: '100%' },
  '.cm-editor.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
});

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
  const unwrapped = unwrapLmObj(obj);
  return unwrapped ? ownUserPropertyKeys(unwrapped) : $arr(Object.keys(obj as object));
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
  const unwrapped = unwrapLmObj(obj);
  return unwrapped
    ? ownUserPropertyKeys(unwrapped)
    : $arr(Object.getOwnPropertyNames(obj as object));
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

function doIt(view: EditorView, print = false) {
  // compute the from- and to-indices of the code we're about to execute
  let { from, to, head } = view.state.selection.main;
  if (from === to) {
    const line = view.state.doc.lineAt(head);
    from = line.from;
    to = line.to;
  }

  // execute the code
  const code = view.state.sliceDoc(from, to);
  console.log('doIt', code, print);
  let result: any;
  try {
    change(() => {
      const realCode = transpile(wrapForCompletionValue(code));
      console.log('evaluating', realCode);
      const runtimeParams = getRuntimeParams();
      result = (window as any).result = new Function(...Object.keys(runtimeParams), realCode)(
        ...Object.values(runtimeParams),
      );
    });
    console.log('result', result);
  } catch (error) {
    result = `{ERROR: ${formatEvalResult(error)}}`;
    console.error('error', error);
  }

  if (!print) {
    return;
  }

  // insert the result into the editor, and select it
  const insert = ` ==> ${formatEvalResult(result)}`;
  view.dispatch({
    changes: { from: to, insert },
  });
  view.dispatch({
    selection: { anchor: to, head: to + insert.length },
  });
}

function doCatchingErrors(fn: () => void) {
  try {
    return fn();
  } catch (error) {
    console.error('error', error);
  }
}

function readAutomergeDocStats(amDoc: Doc<LivelymergeDoc>) {
  return {
    heads: Automerge.getHeads(amDoc),
    numOps: Automerge.stats(amDoc).numOps,
  };
}

function AutomergeDocStats({ handle }: { handle: DocHandle<LivelymergeDoc> }) {
  const [stats, setStats] = useState(() => readAutomergeDocStats(handle.doc()));

  useEffect(() => {
    const refresh = () => setStats(readAutomergeDocStats(handle.doc()));
    refresh();
    handle.on('change', refresh);
    handle.on('heads-changed', refresh);
    return () => {
      handle.removeListener('change', refresh);
      handle.removeListener('heads-changed', refresh);
    };
  }, [handle]);

  return (
    <div
      className="pointer-events-none absolute top-2 right-2 z-30 max-w-[min(24rem,calc(100%-1rem))] font-mono text-[11px] leading-snug text-base-content/80"
      aria-live="polite"
      aria-label="Automerge document statistics"
    >
      <div className="rounded-md border border-base-300/70 bg-base-100/90 px-2.5 py-1.5 shadow-sm backdrop-blur-sm">
        <div className="tabular-nums">
          <span className="text-base-content/55">ops</span> {stats.numOps.toLocaleString()}
        </div>
        <div className="mt-0.5">
          <span className="text-base-content/55">heads</span>{' '}
          {stats.heads.length === 0 ? (
            '—'
          ) : (
            <ul className="mt-0.5 list-none space-y-0.5 break-all">
              {stats.heads.map((head: string) => (
                <li key={head}>{head}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export const LivelymergeEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  docHandle = useDocHandle<LivelymergeDoc>(docUrl, { suspense: true })!;
  (window as any).handle = docHandle; // needed for historical reasons, will go away once we update alldefs

  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** Shell stays mounted during close height animation; cleared after transition ends. */
  const [drawerInDom, setDrawerInDom] = useState(false);
  /** When true, drawer height is `drawerHeight`; when false, height is 0 (animated). */
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const [drawerHeight, setDrawerHeight] = useState(DEFAULT_DRAWER_HEIGHT);
  const [dragging, setDragging] = useState(false);

  const editorMountRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const openRafRef = useRef<number | null>(null);
  /** Synced every render — transitionend must read current expanded state (avoid stale closure unmounting after open). */
  const drawerExpandedRef = useRef(drawerExpanded);
  drawerExpandedRef.current = drawerExpanded;

  /** If height change is instant (e.g. transition disabled while dragging), transitionend never fires — we still must remove the drawer shell and show the footer. */
  const closeFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const syncCanvasSize = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(width));
      const h = Math.max(1, Math.floor(height));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    };

    syncCanvasSize();
    const ro = new ResizeObserver(syncCanvasSize);
    ro.observe(canvas);
    window.addEventListener('resize', syncCanvasSize);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', syncCanvasSize);
    };
  }, []);

  useLayoutEffect(() => {
    if (!drawerInDom) return;
    setDrawerExpanded(false);
    openRafRef.current = requestAnimationFrame(() => {
      openRafRef.current = null;
      setDrawerExpanded(true);
    });
    return () => {
      if (openRafRef.current != null) {
        cancelAnimationFrame(openRafRef.current);
        openRafRef.current = null;
      }
    };
  }, [drawerInDom]);

  const editorKeymap = useMemo(
    () =>
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-d',
            run: (view) => {
              doIt(view);
              return true;
            },
          },
          {
            key: 'Mod-p',
            run: (view) => {
              doIt(view, true);
              return true;
            },
          },
        ]),
      ),
    [],
  );

  useLayoutEffect(() => {
    if (!drawerInDom) return;

    const parent = editorMountRef.current;
    if (!parent) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [basicSetup, javascript(), codeMirrorTheme, editorKeymap],
      }),
      parent,
    });

    return () => {
      view.destroy();
    };
  }, [drawerInDom, editorKeymap]);

  useEffect(() => {
    return () => {
      const uiRafId = (window as any)._uiRafId;
      if (uiRafId != null) {
        cancelAnimationFrame(uiRafId);
        (window as any)._uiRafId = null;
      }
    };
  }, []);

  useEffect(() => {
    const onResize = () => setDrawerHeight((h) => clampDrawerHeight(h));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const clearCloseFallback = useCallback(() => {
    if (closeFallbackTimerRef.current != null) {
      clearTimeout(closeFallbackTimerRef.current);
      closeFallbackTimerRef.current = null;
    }
  }, []);

  const finalizeDrawerShellRemoval = useCallback(() => {
    clearCloseFallback();
    setDrawerInDom(false);
    setDrawerHeight(DEFAULT_DRAWER_HEIGHT);
  }, [clearCloseFallback]);

  const openDrawer = useCallback(() => {
    clearCloseFallback();
    setDrawerInDom(true);
  }, [clearCloseFallback]);

  const closeDrawer = useCallback(() => {
    setDragging(false);
    setDrawerExpanded(false);
    clearCloseFallback();
    closeFallbackTimerRef.current = setTimeout(() => {
      closeFallbackTimerRef.current = null;
      if (!drawerExpandedRef.current) {
        finalizeDrawerShellRemoval();
      }
    }, 400);
  }, [clearCloseFallback, finalizeDrawerShellRemoval]);

  useEffect(
    () => () => {
      if (closeFallbackTimerRef.current != null) {
        clearTimeout(closeFallbackTimerRef.current);
        closeFallbackTimerRef.current = null;
      }
    },
    [],
  );

  const onDrawerTransitionEnd = useCallback(
    (e: TransitionEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget || e.propertyName !== 'height') return;
      // Must use ref: when the *open* height transition ends, a stale closure can still see expanded=false and tear the drawer down.
      if (!drawerExpandedRef.current) {
        finalizeDrawerShellRemoval();
      }
    },
    [finalizeDrawerShellRemoval],
  );

  const onHandlePointerDown = useCallback(
    (e: DomPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { startY: e.clientY, startHeight: drawerHeight };
      setDragging(true);
    },
    [drawerHeight],
  );

  const onHandlePointerMove = useCallback((e: DomPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const { startY, startHeight } = dragRef.current;
    const dy = startY - e.clientY;
    setDrawerHeight(clampDrawerHeight(startHeight + dy));
  }, []);

  const onHandlePointerUp = useCallback((e: DomPointerEvent<HTMLDivElement>) => {
    if (dragRef.current) {
      try {
        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      dragRef.current = null;
      setDragging(false);
    }
  }, []);

  const drawerShellHeight = drawerInDom && drawerExpanded ? drawerHeight : 0;

  return (
    <div className="relative h-full min-h-0 flex-1 overflow-hidden bg-base-100">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      <AutomergeDocStats handle={docHandle} />

      {!drawerInDom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center pb-2">
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              className="btn btn-sm gap-1 border-base-300 bg-white text-black shadow-sm hover:bg-white"
              onClick={openDrawer}
            >
              <span className="text-base leading-none">▲</span>
              Workspace
            </button>
          </div>
        </div>
      )}

      {drawerInDom && (
        <div
          className="absolute inset-x-0 bottom-0 z-20 flex flex-col overflow-hidden border-t border-base-300 bg-base-200 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]"
          style={{
            height: drawerShellHeight,
            transition: dragging ? 'none' : 'height 0.32s cubic-bezier(0.32, 0.72, 0, 1)',
          }}
          onTransitionEnd={onDrawerTransitionEnd}
        >
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-base-300/60 bg-base-200 pr-1">
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize editor panel"
                className="flex min-h-0 min-w-0 flex-1 cursor-ns-resize touch-none select-none items-center justify-center py-2"
                onPointerDown={onHandlePointerDown}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
              >
                <span className="h-1 w-12 rounded-full bg-base-content/25" />
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  className="btn btn-ghost btn-xs shrink-0 gap-0.5"
                  aria-label="Collapse workspace"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={closeDrawer}
                >
                  <span className="text-sm leading-none">▼</span>
                  Close
                </button>
              </div>
            </div>
            <div ref={editorMountRef} className="min-h-0 flex-1 overflow-hidden px-1 pb-1" />
          </div>
        </div>
      )}
    </div>
  );
};

export function renderLivelymergeEditor(
  handle: { url: AutomergeUrl },
  element: ToolElement,
): ReturnType<ToolImplementation> {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo as any}>
      <LivelymergeEditor docUrl={handle.url} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
}
