import { transpile } from './transpiler';
import { wrapForCompletionValue } from './completionValue';
import {
  getJsGlobalTarget,
  isJsGlobalObj,
  isJsGlobalTarget,
  readJsGlobalProperty,
  toJsCallArgs,
  toJsValue,
} from './jsGlobal';
import { ensureObjectPrototypeDefaults } from './objectPrototypeDefaults';
import {
  lmCallToString,
  lmGetOwn,
  lmGetWithDelegation,
  lmHeapPropertyNames,
  lmIsEphemeralKey,
  lmIsReservedKey,
  lmObjDelegatesTo,
  lmOwnUserPropertyKeys,
  lmSetOwn,
  lmSameStoredVal,
  lmUserKey,
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

/**
 * Late-bound values: per-replica stand-ins for JS globals. Serialized as a symbolic
 * reference; each replica resolves them against its own globalThis at access time.
 * (Old documents are upgraded lazily by ensureHeapRoots.)
 */
export const JS_GLOBAL_IDS = [
  'canvas',
  'ctx',
  'document',
  'window',
  'Math',
  'String',
  'Date',
  'Number',
  'JSON',
  'Promise',
  'RegExp',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'localStorage',
  'fetch',
] as const;

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

  // -- The shadow document --
  // Holds every object that has not (yet) been proven persistently reachable: freshly
  // allocated objects and long-lived ephemeral (per-replica) objects alike. Same entry
  // format as doc.objectTable, but a plain JS object: never synced, never persisted.
  // Entries move to doc.objectTable at GC time iff persistently reachable ("promotion");
  // the objectId is preserved, so references and proxies survive promotion unchanged.
  const shadowTable: Record<string, Obj | Arr | Fun> = Object.create(null);

  // -- Ephemeral properties sidecar --
  // objectId × propertyName -> canonical Val. Backs `$foo` properties: per-replica,
  // lost on reload, persistent across transactions. Deliberately strong (not weak):
  // it is a root set for ephemeral liveness — GC sweeps dead rows explicitly.
  const ephemeralProps = new Map<string, Record<string, Val>>();

  // -- Proxy cache --
  // objectId -> WeakRef<proxy>. One proxy per objectId for as long as anyone holds it,
  // so `===`, Map keys, etc. work across transactions and across promotion. Proxies
  // resolve their backing store (shadow vs. Automerge) per access, which is what makes
  // promotion invisible to reference holders.
  const proxyCache = new Map<string, WeakRef<Proxy>>();
  const proxyReaper =
    typeof FinalizationRegistry !== 'undefined'
      ? new FinalizationRegistry<string>((id) => {
          const ref = proxyCache.get(id);
          if (ref && ref.deref() === undefined) proxyCache.delete(id);
        })
      : null;

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
    for (const id of JS_GLOBAL_IDS) {
      if (!doc.objectTable[id]) {
        doc.objectTable[id] = { $type: 'obj', $id: id, $jsGlobal: id };
      }
      const globalObj = doc.objectTable['global'] as Obj;
      const key = '@' + id;
      if (!globalObj[key]) {
        globalObj[key] = { $type: 'ref', $id: id };
      }
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

  function unwrapLmFun(x: unknown): Fun | null {
    if (!isProxy(x) || !isFun(x.$unwrapped)) return null;
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
    return shadowTable[id] ?? doc.objectTable[id];
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

  function liveHeapArr(arr: Arr): Arr {
    const live = lookupHeapEntry(arr.$id);
    return isArr(live) ? live : arr;
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
      if (lmIsEphemeralKey(k)) {
        // `{ $halo: x }` — an ephemeral property, never stored in the heap entry.
        writeEphemeralProp($id, k, v);
        continue;
      }
      entry[k.startsWith('@') ? k : '@' + k] = toValLenient(v, `property '${k}' of object ${$id}`);
    }
    installHeapEntry($id, entry);
    return deserialize(entry);
  }

  function $arr(values: any) {
    const $id = Math.random().toString();
    const entry: Arr = {
      $type: 'arr',
      $id,
      $values: values.map((v: any) => toValLenient(v, `element of array ${$id}`)),
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

  function installHeapEntry(id: string, entry: Obj | Arr | Fun): void {
    // Fresh objects live in the shadow document only. GC promotes them into
    // doc.objectTable iff they are persistently reachable at end of transaction,
    // so temporaries never generate Automerge ops at all.
    shadowTable[id] = entry;
  }

  // -- Ephemeral ($-prefixed) properties --

  function readEphemeralProp(id: string, prop: string): unknown {
    const props = ephemeralProps.get(id);
    if (!props || !Object.hasOwn(props, prop)) return undefined;
    return deserialize(props[prop]);
  }

  function writeEphemeralProp(id: string, prop: string, value: unknown): boolean {
    let props = ephemeralProps.get(id);
    if (!props) {
      props = Object.create(null) as Record<string, Val>;
      ephemeralProps.set(id, props);
    }
    props[prop] = toValLenient(value, `ephemeral property '${prop}' of object ${id}`);
    return true;
  }

  function deleteEphemeralProp(id: string, prop: string): boolean {
    const props = ephemeralProps.get(id);
    if (props) {
      delete props[prop];
      if (Object.keys(props).length === 0) ephemeralProps.delete(id);
    }
    return true;
  }

  // -- Serialization / write barrier --
  //
  // Two regimes:
  //   STRICT  — writes whose target lives in the Automerge document. Unrepresentable
  //             (host) values throw immediately, at the write, with a real stack trace.
  //   LENIENT — writes whose target lives in the shadow document, and all ephemeral
  //             ($-prefixed) properties. These stores are per-replica, so raw host
  //             values (DOM events, timers, ...) are tolerated — closures routinely
  //             capture them (the transpiler seeds captured params onto scope objects).
  //             Each tolerated host value is tagged with provenance; if the containing
  //             object later becomes persistently reachable, PROMOTION throws, and the
  //             error names the property and object the host value came in through.

  function isAutomergeScalar(x: unknown): boolean {
    return x instanceof Date || x instanceof Uint8Array;
  }

  /** host value -> where it entered the heap, for promotion-time error messages. */
  const hostValueProvenance = new WeakMap<object, string>();

  /** Returns a human-readable violation for strict storage, or null if representable.
   * Plain JSON-ish data (e.g. results of String.split) is representable in Automerge as
   * an unaliased leaf value, so it passes — but it must not smuggle LM proxies
   * (aliasing would be silently lost) and `$`-keys would collide with serialized forms. */
  function findUnrepresentable(x: any, depth = 0): string | null {
    if (depth > 100) return 'value is too deeply nested to store';
    if (x === null || x === undefined) return null;
    const t = typeof x;
    if (t === 'number' || t === 'string' || t === 'boolean') return null;
    if (isAutomergeScalar(x)) return null;
    if (isProxy(x)) {
      return (
        'a Livelymerge object inside a plain JS value ' +
        '(aliasing would be lost) — use a Livelymerge array/object to hold it instead'
      );
    }
    if (Array.isArray(x)) {
      for (const v of x) {
        const bad = findUnrepresentable(v, depth + 1);
        if (bad) return bad;
      }
      return null;
    }
    if (t === 'object') {
      const proto = Object.getPrototypeOf(x);
      if (proto !== Object.prototype && proto !== null) {
        return (
          `a ${x.constructor?.name ?? 'host'} object — only Livelymerge objects, plain JSON ` +
          'data, Dates, and Uint8Arrays are representable. For per-replica host resources ' +
          '(canvas, DOM, sockets), use a late-bound global or ephemeral ($-prefixed) state instead'
        );
      }
      for (const k of Object.keys(x)) {
        if (k.startsWith('$')) {
          return `a plain object with a "$"-prefixed key ('${k}') — it would collide with the serialized heap format`;
        }
        const bad = findUnrepresentable(x[k], depth + 1);
        if (bad) return bad;
      }
      return null;
    }
    return `a value of type ${t} — only Livelymerge objects, plain JSON data, Dates, and Uint8Arrays are representable`;
  }

  /** Strict serialization: target lives in the Automerge document. */
  function toVal(x: any): Val {
    if (isProxy(x)) return toRef(x);
    if (x === undefined) return null;
    const bad = findUnrepresentable(x);
    if (bad) {
      throw new TypeError(`Livelymerge: cannot store ${bad}`);
    }
    return x;
  }

  /** Lenient serialization: target is per-replica (shadow document or an ephemeral
   * property). Host values pass through, tagged for promotion-time diagnostics.
   * LM proxies nested inside plain values are still rejected — losing aliasing is a
   * bug regardless of where the value lives. */
  function toValLenient(x: any, provenance: string): Val {
    if (isProxy(x)) return toRef(x);
    if (x === undefined) return null;
    if (
      x !== null &&
      (typeof x === 'object' || typeof x === 'function') &&
      !isAutomergeScalar(x)
    ) {
      if (nestedProxyViolation(x)) {
        throw new TypeError(
          'Livelymerge: cannot store a Livelymerge object inside a plain JS value ' +
            '(aliasing would be lost) — use a Livelymerge array/object to hold it instead',
        );
      }
      if (!hostValueProvenance.has(x)) hostValueProvenance.set(x, provenance);
    }
    return x;
  }

  function nestedProxyViolation(x: any, depth = 0): boolean {
    if (depth > 20 || x === null || typeof x !== 'object') return false;
    if (isProxy(x)) return true;
    if (Array.isArray(x)) return x.some((v) => nestedProxyViolation(v, depth + 1));
    if (Object.getPrototypeOf(x) === Object.prototype) {
      return Object.keys(x).some((k) => nestedProxyViolation(x[k], depth + 1));
    }
    return false; // host object: opaque, don't walk it
  }

  function enrichWriteError(e: unknown, prop: PropertyKey, id: string): unknown {
    if (e instanceof TypeError && e.message.startsWith('Livelymerge:')) {
      const enriched = new TypeError(
        `${e.message} (while assigning property '${String(prop)}' of object ${id})`,
      );
      enriched.stack = e.stack;
      return enriched;
    }
    return e;
  }

  /** Serializer for a write landing on `id`: lenient while the entry is per-replica
   * (shadow-resident), strict once it lives in the Automerge document. */
  function serializerFor(id: string): (x: any) => Val {
    if (Object.hasOwn(shadowTable, id)) {
      return (x: any) => toValLenient(x, `object ${id}`);
    }
    return toVal;
  }

  function toRef(proxy: Proxy): Ref {
    return { $type: 'ref', $id: proxy.$id };
  }

  function isProxy(x: any): x is Proxy {
    return (typeof x === 'object' || typeof x === 'function') && x != null && x.$isProxy;
  }

  function deserialize(value: any): Proxy {
    if (isRef(value)) {
      return deserialize(shadowTable[value.$id] ?? doc.objectTable[value.$id]);
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

  function cachedProxy(id: string): Proxy | undefined {
    return proxyCache.get(id)?.deref();
  }

  function cacheProxy(id: string, p: Proxy): void {
    proxyCache.set(id, new WeakRef(p));
    proxyReaper?.register(p, id);
  }

  function proxifyObj(obj: Obj): Proxy {
    let p = cachedProxy(obj.$id);
    if (p) {
      return p;
    }

    if (isJsGlobalObj(obj)) {
      return proxifyJsGlobalObj(obj);
    }

    // Captured once; every access resolves the live entry by id, so the same proxy
    // stays valid across transactions and across shadow → Automerge promotion.
    const id = obj.$id;

    let _ref: Ref | null = null;
    const ref = () => {
      if (!_ref) {
        _ref = { $type: 'ref', $id: id };
      }
      return _ref;
    };

    p = new Proxy(Object.create(null), {
      set(_, prop, value) {
        if (lmIsEphemeralKey(prop)) return writeEphemeralProp(id, prop as string, value);
        if (lmIsReservedKey(prop)) return false;
        try {
          return lmSetOwn(liveHeapObj(obj), prop, value, serializerFor(id));
        } catch (e) {
          throw enrichWriteError(e, prop, id);
        }
      },
      get(_, prop) {
        const entry = liveHeapObj(obj);
        switch (prop) {
          case '$isProxy':
            return true;
          case '$id':
            return id;
          case '$toRef':
            return ref();
          case '$unwrapped':
            return entry;
          case '__proto__':
            return !entry.$protoId ? null : lmGetPrototypeOf(entry);
        }

        if (lmIsEphemeralKey(prop)) return readEphemeralProp(id, prop as string);
        if (lmIsReservedKey(prop)) return undefined;

        const value = lmGetWithDelegation(entry, prop, lookupHeapProto, deserialize);
        if (value !== undefined) return value;

        if (prop === 'toString') {
          return () => `[obj ${id}]`;
        }

        return undefined;
      },
      deleteProperty(_, prop) {
        if (lmIsEphemeralKey(prop)) return deleteEphemeralProp(id, prop as string);
        if (lmIsReservedKey(prop) || typeof prop === 'symbol') return false;
        const entry = liveHeapObj(obj);
        const key = lmUserKey(prop);
        if (Object.hasOwn(entry, key)) delete entry[key]; // deleting an absent key is free
        return true;
      },
    }) as unknown as Proxy;

    cacheProxy(id, p);
    return p;
  }

  function proxifyJsGlobalObj(obj: Obj): Proxy {
    let p = cachedProxy(obj.$id);
    if (p) {
      return p;
    }

    const id = obj.$id;

    let _ref: Ref | null = null;
    const ref = () => {
      if (!_ref) {
        _ref = { $type: 'ref', $id: id };
      }
      return _ref;
    };

    const jsTarget = () => {
      const target = getJsGlobalTarget(liveHeapObj(obj));
      return isJsGlobalTarget(target) ? target : null;
    };

    const nativeTarget = getJsGlobalTarget(liveHeapObj(obj));
    const target =
      typeof nativeTarget === 'function' ? (function () { }) as (...args: never[]) => unknown : Object.create(null);
    p = new Proxy(target, {
      set(_, prop, value) {
        if (lmIsEphemeralKey(prop)) return writeEphemeralProp(id, prop as string, value);
        if (lmIsReservedKey(prop)) return false;
        const nativeTarget = jsTarget();
        if (!nativeTarget) return false;
        return Reflect.set(nativeTarget, prop, toJsValue(value));
      },
      get(_, prop) {
        const entry = liveHeapObj(obj);
        switch (prop) {
          case '$isProxy':
            return true;
          case '$id':
            return id;
          case '$toRef':
            return ref();
          case '$unwrapped':
            return entry;
          case '__proto__':
            return null;
        }

        if (lmIsEphemeralKey(prop)) return readEphemeralProp(id, prop as string);
        if (lmIsReservedKey(prop)) return undefined;

        const nativeTarget = jsTarget();
        if (!nativeTarget) return undefined;

        if (prop === 'toString') {
          return () => String(nativeTarget);
        }

        return readJsGlobalProperty(nativeTarget, prop);
      },
      deleteProperty(_, prop) {
        if (lmIsEphemeralKey(prop)) return deleteEphemeralProp(id, prop as string);
        if (lmIsReservedKey(prop)) return false;
        const nativeTarget = jsTarget();
        if (!nativeTarget) return false;
        return Reflect.deleteProperty(nativeTarget, prop);
      },
      apply(_, thisArg, args) {
        const nativeTarget = jsTarget();
        if (typeof nativeTarget !== 'function') {
          throw new TypeError(`${liveHeapObj(obj).$jsGlobal} is not a function`);
        }
        return Reflect.apply(nativeTarget, toJsValue(thisArg), toJsCallArgs(args));
      },
      construct(_, args) {
        const nativeTarget = jsTarget();
        if (typeof nativeTarget !== 'function') {
          throw new TypeError(`${liveHeapObj(obj).$jsGlobal} is not a constructor`);
        }
        return Reflect.construct(nativeTarget, toJsCallArgs(args));
      },
    }) as unknown as Proxy;

    cacheProxy(id, p);
    return p;
  }

  function unsupportedArrayAccess(kind: 'read' | 'write', prop: string | symbol): never {
    throw new Error(`Unsupported array ${kind}: ${String(prop)}`);
  }

  function proxifyArr(arr: Arr): Proxy {
    let p = cachedProxy(arr.$id);
    if (p) {
      return p;
    }

    const id = arr.$id;
    // Resolve the live entry per access so the same proxy stays valid across
    // transactions and across shadow -> Automerge promotion.
    const vals = () => liveHeapArr(arr).$values;

    let _ref: Ref | null = null;
    const ref = () => {
      if (!_ref) {
        _ref = { $type: 'ref', $id: id };
      }
      return _ref;
    };

    p = new Proxy(arr, {
      set(_, prop, value) {
        if (lmIsEphemeralKey(prop)) return writeEphemeralProp(id, prop as string, value);
        if (prop === 'length') {
          vals().length = Number(value);
          return true;
        }
        if (isArrayIndexKey(prop) && prop !== 'length') {
          const idx = typeof prop === 'number' ? prop : Number(prop);
          try {
            const next = serializerFor(id)(value);
            const cur = vals();
            if (!(idx < cur.length && lmSameStoredVal(cur[idx], next))) {
              cur[idx] = next;
            }
          } catch (e) {
            throw enrichWriteError(e, prop, id);
          }
          return true;
        }
        unsupportedArrayAccess('write', prop);
      },
      get(_, prop) {
        switch (prop) {
          case '$isProxy':
            return true;
          case '$id':
            return id;
          case '$toRef':
            return ref();
          case '$unwrapped':
            return liveHeapArr(arr);
          case 'toString':
            return () => `[${vals().map(deserialize).map((x) => x.toString())}]`;

          // override array methods
          case 'at': {
            // Normalize the index ourselves: Automerge's mutable list proxy (the
            // $values view inside a change callback) mishandles negative at() indices
            // (clamps them to 0), so never delegate at() to it.
            return function (index: number) {
              const items = vals();
              let i = Math.trunc(Number(index) || 0);
              if (i < 0) i += items.length;
              if (i < 0 || i >= items.length) return undefined;
              return deserialize(items[i]);
            };
          }
          case 'push': {
            return function () {
              for (const arg of arguments) {
                vals().push(serializerFor(id)(arg));
              }
              return vals().length;
            };
          }
          case 'pop': {
            return function () {
              return deserialize(vals().pop());
            };
          }
          case 'unshift': {
            return function () {
              for (const arg of arguments) {
                vals().unshift(serializerFor(id)(arg));
              }
              return vals().length;
            };
          }
          case 'shift': {
            return function () {
              return deserialize(vals().shift());
            };
          }
          case 'findIndex': {
            return function (predicate: (value: any, index: number) => boolean, thisArg?: any) {
              return vals().map(deserialize).findIndex(predicate, thisArg);
            };
          }
          case 'find': {
            return function (predicate: (value: any, index: number) => boolean, thisArg?: any) {
              return vals().map(deserialize).find(predicate, thisArg);
            };
          }
          case 'some': {
            return function (predicate: (value: any, index: number) => boolean, thisArg?: any) {
              return vals().map(deserialize).some(predicate, thisArg);
            };
          }
          case 'every': {
            return function (predicate: (value: any, index: number) => boolean, thisArg?: any) {
              return vals().map(deserialize).every(predicate, thisArg);
            };
          }
          case 'filter': {
            return function (predicate: (value: any, index: number) => boolean, thisArg?: any) {
              return $arr(vals().map(deserialize).filter(predicate, thisArg));
            };
          }
          case 'includes': {
            return function (searchElement: any, fromIndex?: number) {
              return vals().map(deserialize).includes(searchElement, fromIndex);
            };
          }
          case 'indexOf': {
            return function (searchElement: any, fromIndex?: number) {
              return vals().map(deserialize).indexOf(searchElement, fromIndex);
            };
          }
          case 'forEach': {
            return function (callbackFn: (value: any, index: number) => void, thisArg?: any) {
              vals().map(deserialize).forEach(callbackFn, thisArg);
            };
          }
          case 'reduce': {
            return function (
              callbackFn: (accumulator: any, value: any, index: number) => any,
              initialValue?: any,
            ) {
              const items = vals().map(deserialize);
              if (arguments.length >= 2) {
                return items.reduce(callbackFn, initialValue);
              }
              return items.reduce(callbackFn);
            };
          }
          case 'map': {
            return function (callbackFn: (value: any) => any, thisArg?: any) {
              return $arr(vals().map(deserialize).map(callbackFn, thisArg));
            };
          }
          case 'slice': {
            return function (startIdx: number, endIdx?: number) {
              return $arr(vals().slice(startIdx, endIdx).map(deserialize));
            };
          }
          case 'splice': {
            return function (startIdx: number, deleteCount = 0, ...args: any[]) {
              return $arr(
                vals().splice(startIdx, deleteCount, ...args.map(serializerFor(id))).map(deserialize),
              );
            };
          }
          case 'concat': {
            return function (...args: any[]) {
              // Match JS concat semantics: array arguments (LM or plain) contribute
              // their elements; everything else is appended as a single element.
              const out: any[] = vals().map(deserialize);
              for (const arg of args) {
                if (unwrapLmArr(arg) || Array.isArray(arg)) out.push(...(arg as any[]));
                else out.push(arg);
              }
              return $arr(out);
            };
          }
          case 'join': {
            return function (separator?: string) {
              return vals().map(deserialize).join(separator);
            };
          }
          case 'sort': {
            return function (compareFn?: (a: any, b: any) => number) {
              const sorted = vals().map(deserialize).sort(compareFn);
              vals().splice(0, vals().length, ...sorted.map(serializerFor(id)));
              return p;
            };
          }
          case 'toReversed': {
            return function () {
              return $arr(vals().map(deserialize).toReversed());
            };
          }
          case 'toSorted': {
            return function (compareFn?: (a: any, b: any) => number) {
              return $arr(vals().map(deserialize).toSorted(compareFn));
            };
          }
          case 'toSpliced': {
            return function (start: number, deleteCount?: number, ...items: any[]) {
              const copy = vals().map(deserialize);
              if (arguments.length === 1) return $arr(copy.toSpliced(start));
              if (arguments.length === 2) return $arr(copy.toSpliced(start, deleteCount as number));
              return $arr(copy.toSpliced(start, deleteCount as number, ...items));
            };
          }
          case 'with': {
            return function (index: number, value: any) {
              return $arr(vals().map(deserialize).with(index, value));
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
                  if (i >= vals().length) {
                    return { done: true, value: undefined };
                  }
                  return { done: false, value: deserialize(vals()[i++]) };
                },
              };
            };
          }
        }

        if (prop === 'length') {
          return vals().length;
        }

        if (isArrayIndexKey(prop)) {
          return deserialize(vals()[prop as any]);
        }

        if (lmIsEphemeralKey(prop)) return readEphemeralProp(id, prop as string);

        if (typeof prop === 'symbol') {
          // Well-known-symbol probes from JS internals (string coercion via
          // Symbol.toPrimitive, inspect, isConcatSpreadable, …): absent, not an
          // error. Symbol.iterator is handled above.
          return undefined;
        }

        unsupportedArrayAccess('read', prop);
      },
      ownKeys() {
        const keys: Array<string | symbol> = lmArrayIndexKeys(liveHeapArr(arr));
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
              value: vals().length,
              writable: true,
              enumerable: false,
              configurable: false,
            };
          }
          const idx = typeof prop === 'string' ? Number(prop) : prop;
          if (typeof idx === 'number' && idx >= 0 && idx < vals().length) {
            return {
              value: deserialize(vals()[idx]),
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
    cacheProxy(id, p);
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
        if (isJsGlobalObj(unwrapped)) {
          const target = getJsGlobalTarget(liveHeapObj(unwrapped));
          if (target != null) {
            try {
              return String(target);
            } catch {
              return `[obj ${unwrapped.$id}]`;
            }
          }
        }
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
    const existing = cachedProxy(fun.$id);
    if (existing) {
      return existing;
    }

    const id = fun.$id;

    let _ref: Ref | null = null;
    const ref = () => {
      if (!_ref) {
        _ref = { $type: 'ref', $id: id };
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
        if (lmIsEphemeralKey(prop)) return writeEphemeralProp(id, prop as string, value);
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
        try {
          if (!lmSetOwn(live, prop, value, serializerFor(id))) return false;
        } catch (e) {
          throw enrichWriteError(e, prop, id);
        }
        return true;
      },
      get(_, prop) {
        const live = liveHeapFun(fun);
        switch (prop) {
          case '$isProxy':
            return true;
          case '$id':
            return id;
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
        if (lmIsEphemeralKey(prop)) return readEphemeralProp(id, prop as string);
        if (lmIsReservedKey(prop)) return undefined;
        const own = lmGetOwn(live, prop);
        if (own !== undefined) return deserialize(own);
        return undefined;
      },
      deleteProperty(_, prop) {
        if (lmIsEphemeralKey(prop)) return deleteEphemeralProp(id, prop as string);
        if (lmIsReservedKey(prop) || typeof prop === 'symbol' || prop === 'prototype') return false;
        delete liveHeapFun(fun)[lmUserKey(prop)];
        return true;
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
    cacheProxy(id, funProxy);
    return funProxy;
  }

  function entryStoredValues(entry: Obj | Arr | Fun): Array<[string, unknown]> {
    if (isArr(entry)) {
      return entry.$values.map((v, i) => [String(i), v] as [string, unknown]);
    }
    // Objects and functions: user properties (internal $-fields hold only ids/refs/code).
    return lmHeapPropertyNames(entry)
      .filter((k) => k.startsWith('@'))
      .map((k) => [k.slice(1), (entry as Record<string, unknown>)[k]] as [string, unknown]);
  }

  function validateEntryForPromotion(id: string, entry: Obj | Arr | Fun): void {
    for (const [prop, v] of entryStoredValues(entry)) {
      // Stored values are already canonical: object references appear as Refs, which
      // are exactly the representable case. Only non-Ref leaves need validation.
      if (isRef(v)) continue;
      const bad = findUnrepresentable(v);
      if (bad) {
        const origin =
          v !== null && (typeof v === 'object' || typeof v === 'function')
            ? hostValueProvenance.get(v as object)
            : undefined;
        throw new TypeError(
          `Livelymerge: object ${id} became persistently reachable, but its property ` +
            `'${prop}' holds ${bad}` +
            (origin ? ` (the value was stored via ${origin})` : '') +
            '. Keep such values in ephemeral ($-prefixed) state, or use a late-bound global.',
        );
      }
    }
  }

  const warnedMissingReferents = new Set<string>();

  function gc(extraRoot?: unknown) {
    // End-of-transaction GC. Classifies every SHADOW object as one of:
    //   promote  — persistently reachable: moved from the shadow document into the
    //              Automerge document (same objectId, so references and cached
    //              proxies survive promotion unchanged);
    //   retain   — not persistently reachable, but reachable from live ephemeral
    //              ($-prefixed) properties: stays in the shadow document;
    //   collect  — reachable from neither: removed.
    //
    // PERSISTENT objects are NEVER collected. Reachability is a global property in a
    // local-first system: an offline replica may still hold or re-link an object that
    // looks unreachable here, and a local sweep would silently destroy their work at
    // merge time. Unreachable persistent objects simply remain in the object table —
    // this does not grow the Automerge *history* (deletion would add ops, never remove
    // them), only the current-state snapshot.
    //
    // The traversal is $-edge-blind by construction: heap entries never contain
    // ephemeral keys (those live in the ephemeralProps sidecar), so following an
    // entry's properties can never drag ephemeral state into the Automerge document.

    const persistentLive = new Set<string>();
    const ephemeralLive = new Set<string>();

    function traverse(val: Obj | Arr | Fun, visitRef: (id: string) => void) {
      const lookAt = (v: Val) => {
        if (isRef(v)) visitRef(v.$id);
      };
      if (isObj(val)) {
        for (const p of lmHeapPropertyNames(val)) {
          lookAt(val[p]);
        }
        if (val.$protoId != null) {
          visitRef(val.$protoId);
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
          visitRef(val.$prototypeId);
        }
        for (const prop of lmOwnUserPropertyKeys(val)) {
          lookAt(lmGetOwn(val, prop) as Val);
        }
      } else {
        throw new Error('WAT');
      }
    }

    // -- Phase 1: mark persistent. Shadow entries reached here are candidates for
    // promotion; they are validated and installed only after marking completes, so a
    // failed promotion leaves the shadow document untouched (the Automerge change is
    // rolled back by the thrown error, and shadow state must not be half-moved).

    const toPromote: string[] = [];

    function visitPersistent(id: string) {
      if (persistentLive.has(id)) {
        return;
      }
      persistentLive.add(id);

      let val = shadowTable[id];
      if (val) {
        // Persistently reachable, so it graduates from the shadow document to the
        // Automerge document (after validation, below). objectId is preserved.
        toPromote.push(id);
      } else {
        val = doc.objectTable[id];
        if (!val) {
          // A dangling reference: refs baked into documents by earlier builds whose GC
          // swept persistent objects, or persistent refs to per-user objects from a
          // previous session (e.g. a stale pointerFocus). Non-fatal; reads yield
          // undefined. Warn once per id — this runs every transaction, and a legacy
          // dangler would otherwise flood the console at frame rate.
          if (!warnedMissingReferents.has(id)) {
            warnedMissingReferents.add(id);
            console.warn('Livelymerge gc: missing referent with id ' + id);
          }
          return;
        }
      }
      traverse(val, visitPersistent);
    }

    // The persistent root: the global object (everything else hangs off it).
    visitPersistent('global');

    // Validate every promotion candidate before installing any of them. Host values
    // were tolerated while these entries were per-replica; crossing into the shared,
    // persistent document is where they become errors — reported with the provenance
    // recorded at the original write.
    for (const id of toPromote) {
      validateEntryForPromotion(id, shadowTable[id]!);
    }
    for (const id of toPromote) {
      doc.objectTable[id] = shadowTable[id]!;
      delete shadowTable[id];
    }

    // -- Phase 2: mark ephemeral. --
    // Roots are the ephemeral properties of live objects. Marking an object
    // ephemeral-live exposes its own ephemeral properties as further roots, so this
    // runs as a worklist to a fixpoint. (Ephemeral references into the Automerge
    // document need no special pinning: persistent objects are never swept.)

    const worklist: string[] = [];

    const enqueueEphemeralPropsOf = (id: string) => {
      const props = ephemeralProps.get(id);
      if (!props) return;
      for (const prop of Object.keys(props)) {
        const v = props[prop];
        if (isRef(v)) worklist.push(v.$id);
      }
    };

    for (const id of persistentLive) {
      enqueueEphemeralPropsOf(id);
    }

    // The result of a do-it is an ephemeral root for this collection: print-it must be
    // able to read it after the change, but evaluating an expression must not publish
    // its value into the shared document. If nothing ends up referencing it, the next
    // collection reclaims it.
    if (isProxy(extraRoot)) {
      worklist.push(extraRoot.$id);
    }

    // Pending timer callbacks are ephemeral roots too: the browser holds the native
    // closure, which is invisible to this GC (see the setTimeout section).
    eachPendingTimerRef((v) => {
      if (isRef(v)) worklist.push(v.$id);
    });

    while (worklist.length > 0) {
      const id = worklist.pop()!;
      if (persistentLive.has(id) || ephemeralLive.has(id)) {
        continue;
      }
      ephemeralLive.add(id);
      const val = shadowTable[id] ?? doc.objectTable[id];
      if (!val) {
        // Dangling ephemeral reference (e.g. the referent was collected by another
        // replica, or the row outlived its target). Reads yield undefined.
        continue;
      }
      traverse(val, (refId) => worklist.push(refId));
      enqueueEphemeralPropsOf(id);
    }

    // -- Sweep (shadow document only; persistent objects are immortal, see above). --

    let numShadowReclaimed = 0;
    for (const id of Object.keys(shadowTable)) {
      if (!ephemeralLive.has(id)) {
        // Not ephemeral-live, and not promoted (promotion removed it from the
        // shadow table already): fresh garbage or an abandoned ephemeral object.
        delete shadowTable[id];
        numShadowReclaimed++;
      }
    }
    // Ephemeral-property rows survive as long as their owner exists anywhere:
    // in the Automerge document (persistent objects are never swept, so membership is
    // the liveness test) or still in the shadow document.
    for (const id of [...ephemeralProps.keys()]) {
      if (!doc.objectTable[id] && !ephemeralLive.has(id)) {
        ephemeralProps.delete(id);
      }
    }
    if ((globalThis as any).debugGC) {
      console.log('reclaimed', numShadowReclaimed, 'ephemeral objects');
    }
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
    if (objUnwrapped) {
      if (isJsGlobalObj(objUnwrapped)) {
        const target = getJsGlobalTarget(liveHeapObj(objUnwrapped));
        return $arr(isJsGlobalTarget(target) ? Object.keys(target) : []);
      }
      return ownUserPropertyKeys(objUnwrapped);
    }
    const arrUnwrapped = unwrapLmArr(obj);
    if (arrUnwrapped) return $arr(lmArrayIndexKeys(arrUnwrapped));
    const funUnwrapped = unwrapLmFun(obj);
    if (funUnwrapped) return $arr(lmOwnUserPropertyKeys(liveHeapFun(funUnwrapped)));
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
      if (isJsGlobalObj(unwrapped)) {
        const target = getJsGlobalTarget(liveHeapObj(unwrapped));
        return isJsGlobalTarget(target) && Object.hasOwn(target, prop);
      }
      return lmHasOwn(unwrapped, prop);
    }
    const funUnwrapped = unwrapLmFun(obj);
    if (funUnwrapped && typeof prop === 'string') {
      return lmHasOwn(liveHeapFun(funUnwrapped) as unknown as Obj, prop);
    }
    return Object.hasOwn(obj as object, prop);
  };

  $Object.getOwnPropertyNames = function (obj: unknown) {
    const objUnwrapped = unwrapLmObj(obj);
    if (objUnwrapped) {
      if (isJsGlobalObj(objUnwrapped)) {
        const target = getJsGlobalTarget(liveHeapObj(objUnwrapped));
        return $arr(isJsGlobalTarget(target) ? Object.getOwnPropertyNames(target) : []);
      }
      return ownUserPropertyKeys(objUnwrapped);
    }
    const arrUnwrapped = unwrapLmArr(obj);
    if (arrUnwrapped) return $arr([...lmArrayIndexKeys(arrUnwrapped), 'length']);
    const funUnwrapped = unwrapLmFun(obj);
    if (funUnwrapped) return $arr(lmOwnUserPropertyKeys(liveHeapFun(funUnwrapped)));
    return $arr(Object.getOwnPropertyNames(obj as object));
  };

  $Object.getPrototypeOf = function (obj: unknown) {
    const unwrapped = unwrapLmObj(obj);
    if (unwrapped) {
      if (isJsGlobalObj(unwrapped)) {
        const target = getJsGlobalTarget(liveHeapObj(unwrapped));
        return isJsGlobalTarget(target) ? Object.getPrototypeOf(target) : null;
      }
      return lmGetPrototypeOf(unwrapped);
    }
    return Object.getPrototypeOf(obj as object);
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
  //
  // Pending timer callbacks are EPHEMERAL GC roots, per replica, held in runtime maps
  // below — never in the Automerge document. Rationale: a native timer cannot survive
  // a reload anyway (registering the callback in the shared doc was only ever a
  // GC-retention hack), it is invisible to other users by nature, and the doc
  // registration was expensive: every setTimeout promoted the callback closure — with
  // its full $code source strings — into the document (~1000 ops per registration
  // under Automerge text encoding, e.g. on EVERY pointerdown via the long-click arm),
  // then deleted it again, leaving the promoted closure behind as an immortal orphan
  // under never-collect.

  /** timer id → Ref to the pending callback's heap entry (an ephemeral GC root). */
  const pendingTimeoutFns = new Map<number, Val>();
  const pendingIntervalFns = new Map<number, Val>();

  function eachPendingTimerRef(visit: (v: Val) => void): void {
    for (const v of pendingTimeoutFns.values()) visit(v);
    for (const v of pendingIntervalFns.values()) visit(v);
  }

  /** Browsers return numeric timer ids; Node returns Timeout objects. Normalize to the
   * numeric id (Node's Timeout has Symbol.toPrimitive) so ids are heap-representable
   * and clearTimeout/clearInterval accept them in both environments. */
  function normalizeTimerId(id: unknown): number {
    return typeof id === 'number' ? id : Number(id);
  }

  function $setTimeout(fn: () => void, delay?: number) {
    const id = normalizeTimerId(
      setTimeout(() => {
        // Release the root first; the native closure keeps `fn` callable, and the
        // end-of-change GC may then reclaim the callback if nothing else holds it.
        pendingTimeoutFns.delete(id);
        change(() => fn());
      }, delay),
    );
    pendingTimeoutFns.set(id, toValLenient(fn, `setTimeout callback ${id}`));
    return id;
  }

  function $clearTimeout(id: number) {
    clearTimeout(id);
    pendingTimeoutFns.delete(id);
  }

  function $setInterval(fn: () => void, period?: number) {
    const id = normalizeTimerId(setInterval(() => change(fn), period));
    pendingIntervalFns.set(id, toValLenient(fn, `setInterval callback ${id}`));
    return id;
  }

  function $clearInterval(id: number) {
    clearInterval(id);
    pendingIntervalFns.delete(id);
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
      try {
        factory = new Function(...Object.keys(runtimeParams), 'return ' + code) as (
          ...runtime: unknown[]
        ) => (...scopeArgs: unknown[]) => unknown;
      } catch (e) {
        throw new SyntaxError(
          `Livelymerge: stored function code does not parse (${(e as Error).message}) in:\n${code}`,
        );
      }
      codeFactoryCache.set(code, factory);
    }
    const runtimeParams = getRuntimeParams();
    return factory(...Object.values(runtimeParams));
  }
  function evaluateSource(source: string): unknown {
    return change(() => {
      const realCode = transpile(wrapForCompletionValue(source));
      if ((globalThis as any).debugEval) console.log('realCode', realCode);
      const runtimeParams = getRuntimeParams();
      const fn = new Function(...Object.keys(runtimeParams), realCode);
      return fn(...Object.values(runtimeParams));
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
