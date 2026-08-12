import { transpile } from './transpiler';
import { compileClassFragment, spliceMemberIntoClassSource } from './classTranspiler';
import { wrapForCompletionValue } from './completionValue';
import { isDocString, strVal, wrapEntryForDoc, wrapStoredVal } from './docStrings';
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
  lmFindSlotForWrite,
  lmGetOwn,
  lmGetWithDelegation,
  lmHeapGet,
  lmHeapHasOwn,
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
  type AccessorVal,
  type LivelymergeDoc,
  type Obj,
  type Arr,
  type Fun,
  type Ref,
  type Val,
  isAccessorVal,
  isObj,
  isArr,
  isRef,
  isFun,
} from './types';

/**
 * Late-bound values: per-replica stand-ins for JS globals. Serialized as a symbolic
 * reference; each replica resolves them at access time — against its own globalThis,
 * except `console`, which binds to the runtime's formatting wrapper (see
 * resolveJsGlobal). (Old documents are upgraded lazily by ensureHeapRoots.)
 */
export const JS_GLOBAL_IDS = [
  'canvas',
  'console',
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
  /** Diagnostic: refs whose target id exists in neither the document nor the shadow heap. */
  findDanglingRefs(): string[];
  doc(): LivelymergeDoc;
  /** Tell the GC about doc changes that bypassed the local write barrier (e.g. a
   * remote replica's writes): pass the affected objectTable ids, or nothing to
   * force a full re-traversal on the next transaction. Wired automatically when the
   * doc handle exposes change events. */
  noteExternalChanges(ids?: string[]): void;
  /** Monotonic count of noteExternalChanges calls. LM code (e.g. newdefs' frame
   * loop) polls this to run merge-repair passes only when remote changes arrived. */
  externalChangeCount(): number;
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

  // -- Incremental precise GC (edge cache) --
  // The GC's phase-1 job is to know exactly which ids are reachable from 'global' in
  // the persistent heap, without re-traversing the whole heap through (slow) Automerge
  // draft proxies every transaction. Reachability only changes when the heap's EDGE
  // structure changes, and every edge mutation funnels through the proxy write
  // barrier, which sees both the old and the new value. So:
  //
  //   - edgeCache: outgoing ref-targets per doc-resident entry, built during the
  //     initial full traversal and refreshed per entry when its edges change.
  //   - edgeDirtyIds: entries whose outgoing edges MAY have changed — a ref was
  //     written or removed ($-structure changes included). Value-only writes never
  //     land here, so pure-animation frames cost nothing.
  //   - persistentReachable: the PRECISE reachable set from the last trace. Valid
  //     until an edge changes; then one full re-trace over edgeCache at plain-JS
  //     speed recomputes it exactly (unlinks shrink it — no over-approximation, so
  //     no spurious promotion). null means "rebuild everything with a full
  //     traversal" (first transaction of a session, or after an aborted change).
  //
  // Writes by REMOTE replicas never hit the local barrier; the runtime subscribes to
  // the doc handle's change events (when available) and marks patched entries
  // edge-dirty — see noteExternalChanges.
  let persistentReachable: Set<string> | null = null;
  const edgeCache = new Map<string, string[]>();
  const edgeDirtyIds = new Set<string>();

  function markEdgeDirty(id: string): void {
    edgeDirtyIds.add(id);
  }

  /** Barrier helper: an edge changed iff a ref was stored or displaced. Leaf values
   * can never contain refs (plain JSON with $-keys is rejected at serialization), so
   * checking the top-level values is exact — refs appear either bare or inside an
   * accessor record's $get/$set. */
  function markEdgeDirtyIfRefs(id: string, oldValue: unknown, newValue?: unknown): void {
    if (isRef(oldValue) || isRef(newValue) || isAccessorVal(oldValue) || isAccessorVal(newValue)) {
      edgeDirtyIds.add(id);
    }
  }

  /** External (e.g. remote-replica) changes bypass the local write barrier. Call with
   * the affected objectTable ids to mark them edge-dirty, or with no argument to
   * invalidate all incremental GC state (full re-traversal on the next transaction). */
  let externalChangeCount = 0;

  function noteExternalChanges(ids?: string[]): void {
    externalChangeCount++;
    if (!ids) {
      persistentReachable = null;
      matCache.clear();
      heapRootsEnsured = false;
      return;
    }
    for (const id of ids) {
      edgeDirtyIds.add(id);
      invalidateMat(id);
    }
  }

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

  // -- Materialized read-cache (EXPERIMENTAL) --
  // Doc-resident entries (Obj, Fun, and Arr) are read through plain-JS copies.
  // Reading through an Automerge draft proxy costs a WASM op-set seek per key, and
  // render re-reads the same prototypes, functions, scope objects, and submorph lists
  // hundreds of times per frame. Copies are kept current by write-through (local
  // writes mirror onto the copy), invalidated per-id on external (remote) changes via
  // noteExternalChanges, and dropped wholesale when a change aborts (the copy may
  // reflect rolled-back draft state).
  const matCache = new Map<string, Obj | Arr | Fun>();

  // Heap roots are immortal once created, so ensureHeapRoots (a few dozen doc probes)
  // runs on the first change of a session and is skipped afterwards. Reset when its
  // work may have been rolled back (aborted change) or when an external change of
  // unknown shape arrives (see noteExternalChanges).
  let heapRootsEnsured = false;

  function invalidateMat(id: string): void {
    matCache.delete(id);
  }

  /** Write-through: keep a cached copy current instead of re-materializing the whole
   * entry (a full key enumeration through the Automerge proxy) on the next read. */
  function matWriteThrough(id: string, key: string, next: unknown): void {
    const m = matCache.get(id);
    if (m) (m as any)[key] = materializeStoredVal(next);
  }

  function matDeleteThrough(id: string, key: string): void {
    const m = matCache.get(id);
    if (m) delete (m as any)[key];
  }

  /** The cached copy's $values for array id, or undefined when not cached. Array
   * mutators mirror their operation onto this so the copy never goes stale. */
  function matArrVals(id: string): Val[] | undefined {
    const m = matCache.get(id);
    return m && isArr(m) ? m.$values : undefined;
  }

  function materializeStoredVal(v: any): any {
    // Document reads may answer immutable-string wrappers (see docStrings.ts);
    // materialized copies always hold the plain encoding.
    if (isDocString(v)) return v.val;
    if (v == null || typeof v !== 'object') return v;
    if (v instanceof Date) return v;
    if (isRef(v)) return { $type: 'ref', $id: strVal(v.$id) };
    if (isAccessorVal(v)) {
      const acc: any = { $type: 'accessor' };
      if (v.$get) acc.$get = { $type: 'ref', $id: strVal(v.$get.$id) };
      if (v.$set) acc.$set = { $type: 'ref', $id: strVal(v.$set.$id) };
      return acc;
    }
    return v;
  }

  function materializedEntry(id: string): Obj | Arr | Fun | undefined {
    id = strVal(id); // ids read off raw document entries may be wrapped
    const hit = matCache.get(id);
    if (hit) return hit;
    const e = doc.objectTable[id];
    if (!e) return e;
    let plain: any;
    if (isArr(e)) {
      plain = { $type: 'arr', $id: id, $values: e.$values.map(materializeStoredVal) };
    } else {
      plain = {};
      for (const k of lmHeapPropertyNames(e)) {
        if (k === '$scopes') continue;
        plain[k] = materializeStoredVal((e as any)[k]);
      }
      if (isFun(e)) plain.$scopes = e.$scopes.map(materializeStoredVal);
    }
    matCache.set(id, plain);
    return plain;
  }

  /** Read-only heap lookup: shadow entries live, doc entries as materialized copies. */
  function lookupHeapEntryRead(id: string): Obj | Arr | Fun | undefined {
    id = strVal(id); // ids read off raw document entries may be wrapped
    return shadowTable[id] ?? materializedEntry(id);
  }

  function ensureHeapRoots(): void {
    // Document writes use the immutable-string encoding (see docStrings.ts).
    if (!doc.objectTable['object-prototype']) {
      doc.objectTable['object-prototype'] = wrapEntryForDoc({
        $type: 'obj',
        $id: 'object-prototype',
      });
    }
    ensureObjectPrototypeDefaults(doc.objectTable, wrapEntryForDoc, wrapStoredVal);
    if (!doc.objectTable['timeout-fns']) {
      doc.objectTable['timeout-fns'] = wrapEntryForDoc({ $type: 'obj', $id: 'timeout-fns' });
    }
    if (!doc.objectTable['interval-fns']) {
      doc.objectTable['interval-fns'] = wrapEntryForDoc({ $type: 'obj', $id: 'interval-fns' });
    }
    if (!doc.objectTable['global']) {
      doc.objectTable['global'] = wrapEntryForDoc({
        $type: 'obj',
        $id: 'global',
        $protoId: 'object-prototype',
        $timeoutFns: { $type: 'ref', $id: 'timeout-fns' },
        $intervalFns: { $type: 'ref', $id: 'interval-fns' },
      });
    }
    for (const id of JS_GLOBAL_IDS) {
      if (!doc.objectTable[id]) {
        doc.objectTable[id] = wrapEntryForDoc({ $type: 'obj', $id: id, $jsGlobal: id });
      }
      const globalObj = doc.objectTable['global'] as Obj;
      const key = '@' + id;
      if (!globalObj[key]) {
        globalObj[key] = wrapStoredVal({ $type: 'ref', $id: id });
        invalidateMat('global');
      }
    }
  }

  function ensureObjectPrototype(): void {
    ($Object as { prototype: Proxy }).prototype = deserialize(
      lookupHeapEntryRead('object-prototype'),
    );
  }

  function change<T>(fn: () => T): T {
    if (inChangeCall) {
      return fn();
    }

    inChangeCall = true;
    let exception: any;
    let committed = false;
    let returnValue: T | undefined = undefined;
    try {
      docHandle.change((_doc) => {
        doc = _doc;
        if (!heapRootsEnsured) {
          ensureHeapRoots();
          heapRootsEnsured = true;
        }
        $global = (globalThis as any).$global = deserialize(lookupHeapEntryRead('global'));
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
      committed = true;
    } catch (e) {
      exception = exception ?? e;
    } finally {
      inChangeCall = false;
      // Shadow-side deletions and reachable-set additions from gc only apply if the
      // Automerge change actually committed; on an aborted change the document side
      // was rolled back, so the shadow entries must survive and the reachable set
      // must be rebuilt.
      flushPendingGcState(committed);
      // An aborted change rolls the document back: materialized copies made during
      // it may reflect discarded draft state, and roots it created are gone.
      if (!committed) {
        matCache.clear();
        heapRootsEnsured = false;
      }
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
    return $arr([...lmOwnUserPropertyKeys(obj), ...ephemeralPropKeys(strVal(obj.$id))]);
  }

  function lmHasOwn(obj: Obj, prop: string): boolean {
    return Object.hasOwn(obj, '@' + prop) || Object.hasOwn(obj, prop);
  }

  function lookupHeapEntry(id: string): Obj | Arr | Fun | undefined {
    id = strVal(id); // ids read off raw document entries may be wrapped
    return shadowTable[id] ?? doc.objectTable[id];
  }

  function lookupHeapProto(id: string): Obj | undefined {
    const val = lookupHeapEntryRead(id);
    return isObj(val) ? val : undefined;
  }

  function liveHeapObj(obj: Obj): Obj {
    const live = lookupHeapEntry(obj.$id);
    return isObj(live) ? live : obj;
  }

  /** Read-only variant of liveHeapObj: may answer a materialized copy. */
  function liveHeapObjRead(obj: Obj): Obj {
    const live = lookupHeapEntryRead(obj.$id);
    return isObj(live) ? live : obj;
  }

  /** Read-only variant of liveHeapFun: may answer a materialized copy. */
  function liveHeapFunRead(fun: Fun): Fun {
    const live = lookupHeapEntryRead(fun.$id);
    return isFun(live) ? live : fun;
  }

  /** Read-only variant of liveHeapArr: may answer a materialized copy. */
  function liveHeapArrRead(arr: Arr): Arr {
    const live = lookupHeapEntryRead(arr.$id);
    return isArr(live) ? live : arr;
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
    const entry = lookupHeapEntryRead(obj.$protoId);
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
    const $id = crypto.randomUUID();
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
    const $id = crypto.randomUUID();
    const entry: Arr = {
      $type: 'arr',
      $id,
      $values: values.map((v: any) => toValLenient(v, `element of array ${$id}`)),
    };
    installHeapEntry($id, entry);
    return deserialize(entry);
  }

  /** A getter/setter pair as a storable property value (see AccessorVal). The class
   * transpiler emits `'@x': $accessor(getFun, setFun)` in prototype literals; the
   * obj proxy's get/set traps invoke the referenced functions with the receiver. */
  function $accessor(get: Proxy | null, set: Proxy | null): AccessorVal {
    const acc: AccessorVal = { $type: 'accessor' };
    if (get) acc.$get = toRef(get);
    if (set) acc.$set = toRef(set);
    return acc;
  }

  function $fun($codeForShow: string, $code: string, scopes: Proxy[] = []) {
    const $id = crypto.randomUUID();
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

  function hasEphemeralProp(id: string, prop: string): boolean {
    const props = ephemeralProps.get(id);
    return props !== undefined && Object.hasOwn(props, prop);
  }

  function ephemeralPropKeys(id: string): string[] {
    const props = ephemeralProps.get(id);
    return props ? Object.keys(props) : [];
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
      // Accessor records are a canonical stored form (created only by $accessor);
      // their $get/$set are Refs, which are representable by construction.
      if (isAccessorVal(x)) return null;
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

  /** Encode an already-serialized Val for its destination: writes landing in the
   * Automerge document use the immutable-string encoding (see docStrings.ts);
   * shadow-resident targets store the plain value. Applied only at the actual
   * store — comparisons and materialized copies stay in the plain encoding. */
  function storedValFor(id: string, v: unknown): any {
    return Object.hasOwn(shadowTable, id) ? v : wrapStoredVal(v);
  }

  function toRef(proxy: Proxy): Ref {
    const id = proxy.$id;
    // Resurrection at the write barrier: JS-side references (window side-tables, DOM
    // closures) are invisible to the GC, so the entry may have been swept while the
    // proxy lived on. Storing the proxy re-establishes reachability — reinstall the
    // entry (proxies keep their entry via $unwrapped) instead of baking a dangling
    // ref into the heap. (A matCache hit proves the entry is doc-resident — only doc
    // entries are ever cached — and skips the objectTable probe.)
    if (!Object.hasOwn(shadowTable, id) && !matCache.has(id) && !(doc && doc.objectTable[id])) {
      const entry = proxy.$unwrapped;
      if (entry && (isObj(entry) || isArr(entry) || isFun(entry))) {
        shadowTable[id] = entry;
      }
    }
    return { $type: 'ref', $id: id };
  }

  function isProxy(x: any): x is Proxy {
    return (typeof x === 'object' || typeof x === 'function') && x != null && x.$isProxy;
  }

  function deserialize(value: any): Proxy {
    if (isDocString(value)) {
      // A raw document read: user string values surface as plain strings.
      return value.val as unknown as Proxy;
    }
    if (isRef(value)) {
      return deserialize(lookupHeapEntryRead(value.$id));
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
    return proxyCache.get(strVal(id))?.deref();
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
    const id: string = strVal(obj.$id);

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
          // Compare against the cheap read view; resolve the live doc entry only
          // when the write isn't elided.
          const entry = liveHeapObjRead(obj);
          // An accessor slot on the delegation chain intercepts the write (JS
          // semantics). The common case — an own data slot — exits the lookup on
          // its first iteration, so plain writes stay cheap.
          const slot = lmFindSlotForWrite(entry, prop, lookupHeapProto);
          if (slot && 'accessor' in slot) {
            const setter = slot.accessor.$set;
            if (setter) (deserialize(setter) as any).call(p, value);
            return true; // no setter: silently ignored, like sloppy-mode JS
          }
          return lmSetOwn(
            entry,
            prop,
            value,
            serializerFor(id),
            (oldV, newV) => {
              matWriteThrough(id, lmUserKey(prop), newV);
              markEdgeDirtyIfRefs(id, oldV, newV);
            },
            () => liveHeapObj(obj),
            (v) => storedValFor(id, v),
          );
        } catch (e) {
          throw enrichWriteError(e, prop, id);
        }
      },
      get(_, prop) {
        const entry = liveHeapObjRead(obj);
        switch (prop) {
          case '$isProxy':
            return true;
          case '$id':
            return id;
          case '$toRef':
            return ref();
          case '$unwrapped':
            return liveHeapObj(obj); // always the live entry: callers may write through it
          case '__proto__':
            return !entry.$protoId ? null : lmGetPrototypeOf(entry);
        }

        if (lmIsEphemeralKey(prop)) return readEphemeralProp(id, prop as string);
        if (lmIsReservedKey(prop)) return undefined;

        const value = lmGetWithDelegation(entry, prop, lookupHeapProto, deserialize, (acc) =>
          acc.$get ? (deserialize(acc.$get) as any).call(p) : undefined,
        );
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
        if (Object.hasOwn(entry, key)) {
          // Deleting an absent key is free; deleting a ref removes an edge.
          const oldV = entry[key];
          delete entry[key];
          matDeleteThrough(id, key);
          markEdgeDirtyIfRefs(id, oldV);
        }
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

    const id: string = strVal(obj.$id);

    let _ref: Ref | null = null;
    const ref = () => {
      if (!_ref) {
        _ref = { $type: 'ref', $id: id };
      }
      return _ref;
    };

    const jsTarget = () => {
      const target = resolveJsGlobal(liveHeapObjRead(obj));
      return isJsGlobalTarget(target) ? target : null;
    };

    const nativeTarget = resolveJsGlobal(liveHeapObjRead(obj));
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
        switch (prop) {
          case '$isProxy':
            return true;
          case '$id':
            return id;
          case '$toRef':
            return ref();
          case '$unwrapped':
            return liveHeapObj(obj);
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
          throw new TypeError(`${liveHeapObjRead(obj).$jsGlobal} is not a function`);
        }
        return Reflect.apply(nativeTarget, toJsValue(thisArg), toJsCallArgs(args));
      },
      construct(_, args) {
        const nativeTarget = jsTarget();
        if (typeof nativeTarget !== 'function') {
          throw new TypeError(`${liveHeapObjRead(obj).$jsGlobal} is not a constructor`);
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

    const id: string = strVal(arr.$id);
    // Resolve the live entry per access so the same proxy stays valid across
    // transactions and across shadow -> Automerge promotion. Mutators use vals()
    // (the live Automerge/shadow view) and mirror their operation onto the cached
    // copy; read-only paths use valsRead() (the materialized copy when doc-resident).
    const vals = () => liveHeapArr(arr).$values;
    const valsRead = () => liveHeapArrRead(arr).$values;

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
        // Compare against the cheap read view; touch the live doc entry only when
        // the write isn't elided.
        if (prop === 'length') {
          const cur = valsRead();
          const next = Number(value);
          if (cur.length !== next) {
            // Truncation may drop refs (edges); growth adds only holes.
            if (next < cur.length && cur.slice(next).some(isRef)) markEdgeDirty(id);
            vals().length = next;
            const mv = matArrVals(id);
            if (mv) mv.length = next;
          }
          return true;
        }
        if (isArrayIndexKey(prop) && prop !== 'length') {
          const idx = typeof prop === 'number' ? prop : Number(prop);
          try {
            const next = serializerFor(id)(value);
            const cur = valsRead();
            if (!(idx < cur.length && lmSameStoredVal(cur[idx], next))) {
              markEdgeDirtyIfRefs(id, idx < cur.length ? cur[idx] : undefined, next);
              vals()[idx] = storedValFor(id, next);
              const mv = matArrVals(id);
              if (mv) mv[idx] = materializeStoredVal(next);
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
            return () => `[${valsRead().map(deserialize).map((x) => x.toString())}]`;

          // override array methods
          case 'at': {
            // Normalize the index ourselves: Automerge's mutable list proxy (the
            // $values view inside a change callback) mishandles negative at() indices
            // (clamps them to 0), so never delegate at() to it.
            return function (index: number) {
              const items = valsRead();
              let i = Math.trunc(Number(index) || 0);
              if (i < 0) i += items.length;
              if (i < 0 || i >= items.length) return undefined;
              return deserialize(items[i]);
            };
          }
          case 'push': {
            return function () {
              for (const arg of arguments) {
                const v = serializerFor(id)(arg);
                if (isRef(v)) markEdgeDirty(id);
                vals().push(storedValFor(id, v));
                matArrVals(id)?.push(materializeStoredVal(v));
              }
              return valsRead().length;
            };
          }
          case 'pop': {
            return function () {
              const popped = vals().pop();
              matArrVals(id)?.pop();
              markEdgeDirtyIfRefs(id, popped);
              return deserialize(popped);
            };
          }
          case 'unshift': {
            return function () {
              for (const arg of arguments) {
                const v = serializerFor(id)(arg);
                if (isRef(v)) markEdgeDirty(id);
                vals().unshift(storedValFor(id, v));
                matArrVals(id)?.unshift(materializeStoredVal(v));
              }
              return valsRead().length;
            };
          }
          case 'shift': {
            return function () {
              const shifted = vals().shift();
              matArrVals(id)?.shift();
              markEdgeDirtyIfRefs(id, shifted);
              return deserialize(shifted);
            };
          }
          case 'findIndex': {
            return function (predicate: (value: any, index: number) => boolean, thisArg?: any) {
              return valsRead().map(deserialize).findIndex(predicate, thisArg);
            };
          }
          case 'find': {
            return function (predicate: (value: any, index: number) => boolean, thisArg?: any) {
              return valsRead().map(deserialize).find(predicate, thisArg);
            };
          }
          case 'some': {
            return function (predicate: (value: any, index: number) => boolean, thisArg?: any) {
              return valsRead().map(deserialize).some(predicate, thisArg);
            };
          }
          case 'every': {
            return function (predicate: (value: any, index: number) => boolean, thisArg?: any) {
              return valsRead().map(deserialize).every(predicate, thisArg);
            };
          }
          case 'filter': {
            return function (predicate: (value: any, index: number) => boolean, thisArg?: any) {
              return $arr(valsRead().map(deserialize).filter(predicate, thisArg));
            };
          }
          case 'includes': {
            return function (searchElement: any, fromIndex?: number) {
              return valsRead().map(deserialize).includes(searchElement, fromIndex);
            };
          }
          case 'indexOf': {
            return function (searchElement: any, fromIndex?: number) {
              return valsRead().map(deserialize).indexOf(searchElement, fromIndex);
            };
          }
          case 'forEach': {
            return function (callbackFn: (value: any, index: number) => void, thisArg?: any) {
              valsRead().map(deserialize).forEach(callbackFn, thisArg);
            };
          }
          case 'reduce': {
            return function (
              callbackFn: (accumulator: any, value: any, index: number) => any,
              initialValue?: any,
            ) {
              const items = valsRead().map(deserialize);
              if (arguments.length >= 2) {
                return items.reduce(callbackFn, initialValue);
              }
              return items.reduce(callbackFn);
            };
          }
          case 'map': {
            return function (callbackFn: (value: any) => any, thisArg?: any) {
              return $arr(valsRead().map(deserialize).map(callbackFn, thisArg));
            };
          }
          case 'slice': {
            return function (startIdx: number, endIdx?: number) {
              return $arr(valsRead().slice(startIdx, endIdx).map(deserialize));
            };
          }
          case 'splice': {
            return function (startIdx: number, deleteCount = 0, ...args: any[]) {
              const inserted = args.map(serializerFor(id));
              const removed = vals().splice(
                startIdx,
                deleteCount,
                ...inserted.map((v) => storedValFor(id, v)),
              );
              matArrVals(id)?.splice(startIdx, deleteCount, ...inserted.map(materializeStoredVal));
              if (removed.some(isRef) || inserted.some(isRef)) markEdgeDirty(id);
              return $arr(removed.map(deserialize));
            };
          }
          case 'concat': {
            return function (...args: any[]) {
              // Match JS concat semantics: array arguments (LM or plain) contribute
              // their elements; everything else is appended as a single element.
              const out: any[] = valsRead().map(deserialize);
              for (const arg of args) {
                if (unwrapLmArr(arg) || Array.isArray(arg)) out.push(...(arg as any[]));
                else out.push(arg);
              }
              return $arr(out);
            };
          }
          case 'join': {
            return function (separator?: string) {
              return valsRead().map(deserialize).join(separator);
            };
          }
          case 'sort': {
            return function (compareFn?: (a: any, b: any) => number) {
              // Rearranges the same elements: the edge SET is unchanged, never dirty.
              const sorted = valsRead().map(deserialize).sort(compareFn);
              const serialized = sorted.map(serializerFor(id));
              vals().splice(0, vals().length, ...serialized.map((v) => storedValFor(id, v)));
              const mv = matArrVals(id);
              if (mv) mv.splice(0, mv.length, ...serialized.map(materializeStoredVal));
              return p;
            };
          }
          case 'toReversed': {
            return function () {
              return $arr(valsRead().map(deserialize).toReversed());
            };
          }
          case 'toSorted': {
            return function (compareFn?: (a: any, b: any) => number) {
              return $arr(valsRead().map(deserialize).toSorted(compareFn));
            };
          }
          case 'toSpliced': {
            return function (start: number, deleteCount?: number, ...items: any[]) {
              const copy = valsRead().map(deserialize);
              if (arguments.length === 1) return $arr(copy.toSpliced(start));
              if (arguments.length === 2) return $arr(copy.toSpliced(start, deleteCount as number));
              return $arr(copy.toSpliced(start, deleteCount as number, ...items));
            };
          }
          case 'with': {
            return function (index: number, value: any) {
              return $arr(valsRead().map(deserialize).with(index, value));
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
                  const items = valsRead();
                  if (i >= items.length) {
                    return { done: true, value: undefined };
                  }
                  return { done: false, value: deserialize(items[i++]) };
                },
              };
            };
          }
        }

        if (prop === 'length') {
          return valsRead().length;
        }

        if (isArrayIndexKey(prop)) {
          return deserialize(valsRead()[prop as any]);
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
        const keys: Array<string | symbol> = lmArrayIndexKeys(liveHeapArrRead(arr));
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
              value: valsRead().length,
              writable: true,
              enumerable: false,
              configurable: false,
            };
          }
          const idx = typeof prop === 'string' ? Number(prop) : prop;
          const items = valsRead();
          if (typeof idx === 'number' && idx >= 0 && idx < items.length) {
            return {
              value: deserialize(items[idx]),
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
          const target = getJsGlobalTarget(liveHeapObjRead(unwrapped));
          if (target != null) {
            try {
              return String(target);
            } catch {
              return `[obj ${strVal(unwrapped.$id)}]`;
            }
          }
        }
        return lmCallToString(liveHeapObjRead(unwrapped), value, lookupHeapProto, deserialize);
      }
      return value.toString();
    }

    if (isObj(value)) {
      return lmCallToString(
        liveHeapObjRead(value),
        deserialize(value),
        lookupHeapProto,
        deserialize,
      );
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
    warn(...args: unknown[]) {
      console.warn(...consoleFormatArgs(args));
    },
    error(...args: unknown[]) {
      console.error(...consoleFormatArgs(args));
    },
  };

  /** Resolve a late-bound global to this replica's binding. Most names resolve against
   * globalThis, but `console` binds to the runtime's formatting wrapper: LM values print
   * readably, and code that patches console methods (e.g. newdefs' transcript mirror)
   * patches the wrapper rather than the page's real console. */
  function resolveJsGlobal(obj: Obj): unknown {
    if (strVal(obj.$jsGlobal) === 'console') return $console;
    return getJsGlobalTarget(obj);
  }

  function isConstructibleFun(fun: Fun): boolean {
    return /=>\s*(async\s+)?function\b/.test(strVal(fun.$code));
  }

  function getFunPrototype(fun: Fun, funProxy: Proxy): Proxy {
    const cheap = liveHeapFunRead(fun);
    if (cheap.$prototypeId) {
      return deserialize(lookupHeapEntryRead(cheap.$prototypeId)!);
    }
    const id = cheap.$id;
    const live = liveHeapFun(fun);
    const proto = $obj({});
    (proto as any).constructor = funProxy;
    // mutation on read: the fun gains a $prototypeId edge
    (live as any).$prototypeId = storedValFor(id, proto.$id);
    matWriteThrough(id, '$prototypeId', proto.$id);
    markEdgeDirty(id);
    return proto;
  }

  function proxifyFun(fun: Fun): Proxy {
    const existing = cachedProxy(fun.$id);
    if (existing) {
      return existing;
    }

    const id: string = strVal(fun.$id);

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
        _fn = getCodeFactory(fun.$code)(...liveHeapFunRead(fun).$scopes.map(deserialize)) as (
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
        if (prop === 'prototype') {
          if (!isConstructibleFun(liveHeapFunRead(fun))) {
            return false;
          }
          if (value !== null && !isLmObj(value)) {
            throw new TypeError('Function.prototype is not an object or null');
          }
          const nextProtoId = value === null ? undefined : value.$id;
          if (liveHeapFunRead(fun).$prototypeId !== nextProtoId) {
            (liveHeapFun(fun) as any).$prototypeId = storedValFor(id, nextProtoId);
            matWriteThrough(id, '$prototypeId', nextProtoId);
            markEdgeDirty(id);
          }
          return true;
        }
        if (lmIsReservedKey(prop)) return false;
        try {
          if (
            // Compare against the cheap read view; resolve the live doc entry only
            // when the write isn't elided.
            !lmSetOwn(
              liveHeapFunRead(fun),
              prop,
              value,
              serializerFor(id),
              (oldV, newV) => {
                matWriteThrough(id, lmUserKey(prop), newV);
                markEdgeDirtyIfRefs(id, oldV, newV);
              },
              () => liveHeapFun(fun),
              (v) => storedValFor(id, v),
            )
          ) {
            return false;
          }
        } catch (e) {
          throw enrichWriteError(e, prop, id);
        }
        return true;
      },
      get(_, prop) {
        const live = liveHeapFunRead(fun);
        switch (prop) {
          case '$isProxy':
            return true;
          case '$id':
            return id;
          case '$toRef':
            return ref();
          case '$unwrapped':
            return liveHeapFun(fun); // always the live entry: callers may write through it
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
        if (prop === Symbol.hasInstance) {
          // Proxy invariant: the target's Symbol.hasInstance is a non-configurable
          // data property, so the trap must return it verbatim — this is the path
          // by which `x instanceof Cls` reaches lmInstanceOf.
          return Reflect.get(target, Symbol.hasInstance);
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
        const live = liveHeapFun(fun);
        const key = lmUserKey(prop);
        if (Object.hasOwn(live, key)) {
          const oldV = live[key];
          delete live[key];
          matDeleteThrough(id, key);
          markEdgeDirtyIfRefs(id, oldV);
        }
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

  /** Shadow-table removals scheduled by gc(), applied by change() only after the
   * Automerge change has committed (see the promotion/sweep notes in gc). */
  let pendingShadowDeletes: string[] = [];

  /** The reachable set traced by gc(), promoted to persistentReachable on commit. */
  let pendingReachable: Set<string> | null = null;

  function flushPendingGcState(commit: boolean) {
    if (commit) {
      for (const id of pendingShadowDeletes) {
        delete shadowTable[id];
      }
      if (pendingReachable) persistentReachable = pendingReachable;
      edgeDirtyIds.clear();
    } else {
      // Aborted change: the document rolled back (promotions included), so the
      // traced set and any edge lists refreshed this transaction are invalid. Aborts
      // are rare (promotion validation failures) — rebuild from scratch next time.
      persistentReachable = null;
      edgeCache.clear();
      edgeDirtyIds.clear();
    }
    pendingShadowDeletes = [];
    pendingReachable = null;
  }

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

    const ephemeralLive = new Set<string>();

    // The PRECISE reachable set for THIS transaction. When no edges changed, the
    // committed set is reused as-is; otherwise it is recomputed exactly by a trace
    // over the edge cache. It replaces the committed set only if the change commits
    // (see flushPendingGcState).
    let reachable: Set<string>;

    function traverse(val: Obj | Arr | Fun, visitRef: (id: string, via: string) => void) {
      const from = val.$id;
      const lookAt = (v: Val, via: string) => {
        if (isRef(v)) visitRef(v.$id, via);
        else if (isAccessorVal(v)) {
          if (v.$get) visitRef(v.$get.$id, `${via} getter`);
          if (v.$set) visitRef(v.$set.$id, `${via} setter`);
        }
      };
      if (isObj(val)) {
        for (const p of lmHeapPropertyNames(val)) {
          lookAt(val[p], `obj ${from} property '${p}'`);
        }
        if (val.$protoId != null) {
          visitRef(val.$protoId, `obj ${from} $protoId`);
        }
      } else if (isArr(val)) {
        for (let i = 0; i < val.$values.length; i++) {
          lookAt(val.$values[i], `arr ${from}[${i}]`);
        }
      } else if (isFun(val)) {
        for (const v of val.$scopes) {
          lookAt(v, `fun ${from} scope`);
        }
        if (val.$prototypeId != null) {
          visitRef(val.$prototypeId, `fun ${from} $prototypeId`);
        }
        for (const prop of lmOwnUserPropertyKeys(val)) {
          lookAt(lmGetOwn(val, prop) as Val, `fun ${from} property '@${prop}'`);
        }
      } else {
        throw new Error('WAT');
      }
    }

    // -- Phase 1: mark persistent. Shadow entries reached here are candidates for
    // promotion; they are validated and installed only after marking completes, so a
    // failed promotion leaves the shadow document untouched (the Automerge change is
    // rolled back by the thrown error, and shadow state must not be half-moved).
    //
    // INCREMENTAL AND PRECISE (edge cache): reachability changes only when the
    // heap's edge structure changes, and every local edge mutation funnels through
    // the write barrier (edgeDirtyIds; remote mutations arrive via
    // noteExternalChanges). When no edges changed, the committed reachable set is
    // still exact and phase 1 is O(1). When edges did change, only the dirty entries
    // are re-read through the Automerge draft (to refresh their edge lists); the
    // full re-trace then runs over the edge cache at plain-JS speed and computes the
    // reachable set EXACTLY — unlinked subtrees drop out, so stale reachability can
    // never cause spurious promotion. Writes onto unreachable-but-immortal doc
    // objects behave as they always have: no promotion (phase 2's ephemeral marking
    // may still retain the targets).

    const toPromote: string[] = [];

    // Visits `id`, recording its outgoing edges in the edge cache as a side effect.
    // Doc-resident entries with cached edges are traced at plain-JS speed;
    // everything else (shadow entries, first encounters, remote additions) is read
    // once and cached.
    function visitPersistent(id: string, via?: string) {
      if (reachable.has(id)) {
        return;
      }
      reachable.add(id);

      let val: Obj | Arr | Fun | undefined = shadowTable[id];
      if (val) {
        // Persistently reachable, so it graduates from the shadow document to the
        // Automerge document (after validation, below). objectId is preserved; the
        // edge list cached below stays valid for the promoted doc entry.
        toPromote.push(id);
      } else {
        const cached = edgeCache.get(id);
        if (cached !== undefined) {
          for (const t of cached) visitPersistent(t, `entry ${id}`);
          return;
        }
        val = materializedEntry(id);
        if (!val) {
          // The entry is in neither store, but a live proxy may still carry it
          // (JS-side references are invisible to this GC, so the entry may have been
          // swept out from under the proxy). Resurrect it rather than leaving a
          // dangling reference in the persistent heap.
          const entry = cachedProxy(id)?.$unwrapped;
          if (entry && (isObj(entry) || isArr(entry) || isFun(entry))) {
            shadowTable[id] = entry;
            val = entry;
            toPromote.push(id);
          } else {
            // A dangling reference: refs baked into documents by earlier builds or
            // damaged sessions. Non-fatal; reads yield undefined. Warn once per id —
            // this runs every transaction, and a legacy dangler would otherwise flood
            // the console at frame rate.
            if (!warnedMissingReferents.has(id)) {
              warnedMissingReferents.add(id);
              console.warn(
                `Livelymerge gc: missing referent with id ${id}` +
                  (via ? ` (referenced by ${via})` : ''),
              );
            }
            return;
          }
        }
      }
      const edges: string[] = [];
      traverse(val, (t, via2) => {
        edges.push(t);
        visitPersistent(t, via2);
      });
      edgeCache.set(id, edges);
    }

    if (persistentReachable === null) {
      // Full traversal from the persistent root: the global object (everything else
      // hangs off it). Rebuilds the edge cache as it goes.
      edgeCache.clear();
      reachable = new Set();
      visitPersistent('global');
    } else {
      // Refresh the edge lists of entries whose edges may have changed. Each costs
      // one draft read of that entry; value-only writes never land in edgeDirtyIds,
      // so this loop is empty on pure-animation frames. Shadow-resident dirty
      // entries are skipped: the trace reads shadow entries directly, and their
      // reachability is determined by whoever points at them.
      let edgesChanged = false;
      for (const id of edgeDirtyIds) {
        if (Object.hasOwn(shadowTable, id)) continue;
        // The write that dirtied the entry also updated its materialized copy, so
        // the refreshed edge list can be read at plain-JS speed.
        const entry = materializedEntry(id);
        if (entry === undefined) {
          if (edgeCache.delete(id)) edgesChanged = true;
          continue;
        }
        const edges: string[] = [];
        traverse(entry, (t) => edges.push(t));
        edgeCache.set(id, edges);
        edgesChanged = true;
      }
      if (edgesChanged) {
        reachable = new Set();
        visitPersistent('global');
      } else {
        reachable = persistentReachable;
      }
    }

    // Validate every promotion candidate before installing any of them. Host values
    // were tolerated while these entries were per-replica; crossing into the shared,
    // persistent document is where they become errors — reported with the provenance
    // recorded at the original write.
    for (const id of toPromote) {
      validateEntryForPromotion(id, shadowTable[id]!);
    }
    // Install promotions into the (draft) document, but DEFER the shadow-side
    // deletions until the change has committed: if anything later in this change
    // throws, Automerge rolls the installs back — deleting the shadow entries here
    // would then lose the objects from both stores, and every surviving proxy write
    // would bake a dangling reference into the document.
    for (const id of toPromote) {
      // Promotion is where strings cross into the document: the entry is written
      // in the immutable-string encoding (see docStrings.ts). The shadow entry
      // stays plain (and stays authoritative until the change commits).
      doc.objectTable[id] = wrapEntryForDoc(shadowTable[id]!);
      invalidateMat(id);
      pendingShadowDeletes.push(id);
    }

    // The traced set replaces the committed reachable set — but only if the change
    // commits (see flushPendingGcState).
    pendingReachable = reachable;

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

    // Root the ephemeral rows of persistently-reachable owners. Iterate the rows
    // (few) rather than the live set (the whole reachable heap). Rows of shadow
    // owners are enqueued by the worklist below when their owner becomes
    // ephemeral-live, exactly as before.
    for (const id of ephemeralProps.keys()) {
      if (reachable.has(id)) {
        enqueueEphemeralPropsOf(id);
      }
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
      if (reachable.has(id) || ephemeralLive.has(id)) {
        continue;
      }
      ephemeralLive.add(id);
      const val = lookupHeapEntryRead(id);
      if (!val) {
        // Dangling ephemeral reference (e.g. the referent was collected by another
        // replica, or the row outlived its target). Reads yield undefined.
        continue;
      }
      traverse(val, (refId) => worklist.push(refId));
      enqueueEphemeralPropsOf(id);
    }

    // -- Sweep (shadow document only; persistent objects are immortal, see above). --
    // Like promotion, sweep deletions are deferred until the change commits.

    let numShadowReclaimed = 0;
    for (const id of Object.keys(shadowTable)) {
      if (!ephemeralLive.has(id) && !reachable.has(id)) {
        // Not ephemeral-live and not just promoted: fresh garbage or an abandoned
        // ephemeral object.
        pendingShadowDeletes.push(id);
        numShadowReclaimed++;
      }
    }
    // Ephemeral-property rows survive as long as their owner exists anywhere:
    // in the Automerge document (persistent objects are never swept, so membership is
    // the liveness test) or still in the shadow document. Check the plain-JS sets
    // first — reachable owners are doc-resident by construction (promotions are
    // already installed) — so the per-row doc probe only runs for the rare row on an
    // unreachable-but-immortal doc object.
    for (const id of [...ephemeralProps.keys()]) {
      if (!ephemeralLive.has(id) && !reachable.has(id) && !doc.objectTable[id]) {
        ephemeralProps.delete(id);
      }
    }
    if ((globalThis as any).debugGC) {
      console.log(
        'gc:',
        persistentReachable === null
          ? 'FULL scan,'
          : reachable === persistentReachable
            ? 'no edge changes (trace skipped),'
            : `re-traced (${edgeDirtyIds.size} edge-dirty),`,
        reachable.size,
        'reachable,',
        toPromote.length,
        'promoted,',
        numShadowReclaimed,
        'ephemeral objects reclaimed',
      );
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
    getOwnPropertyDescriptor(obj: unknown, prop: PropertyKey): Proxy | undefined;
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
        const target = getJsGlobalTarget(liveHeapObjRead(objUnwrapped));
        return $arr([
          ...(isJsGlobalTarget(target) ? Object.keys(target) : []),
          ...ephemeralPropKeys(strVal(objUnwrapped.$id)),
        ]);
      }
      return ownUserPropertyKeys(objUnwrapped);
    }
    const arrUnwrapped = unwrapLmArr(obj);
    if (arrUnwrapped) {
      return $arr([
        ...lmArrayIndexKeys(arrUnwrapped),
        ...ephemeralPropKeys(strVal(arrUnwrapped.$id)),
      ]);
    }
    const funUnwrapped = unwrapLmFun(obj);
    if (funUnwrapped) {
      return $arr([
        ...lmOwnUserPropertyKeys(liveHeapFunRead(funUnwrapped)),
        ...ephemeralPropKeys(strVal(funUnwrapped.$id)),
      ]);
    }
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
      if (lmIsEphemeralKey(prop)) return hasEphemeralProp(strVal(unwrapped.$id), prop);
      if (isJsGlobalObj(unwrapped)) {
        const target = getJsGlobalTarget(liveHeapObjRead(unwrapped));
        return isJsGlobalTarget(target) && Object.hasOwn(target, prop);
      }
      return lmHasOwn(unwrapped, prop);
    }
    const arrUnwrapped = unwrapLmArr(obj);
    if (arrUnwrapped && typeof prop === 'string' && lmIsEphemeralKey(prop)) {
      return hasEphemeralProp(strVal(arrUnwrapped.$id), prop);
    }
    const funUnwrapped = unwrapLmFun(obj);
    if (funUnwrapped && typeof prop === 'string') {
      if (lmIsEphemeralKey(prop)) return hasEphemeralProp(strVal(funUnwrapped.$id), prop);
      return lmHasOwn(liveHeapFunRead(funUnwrapped) as unknown as Obj, prop);
    }
    return Object.hasOwn(obj as object, prop);
  };

  $Object.getOwnPropertyNames = function (obj: unknown) {
    const objUnwrapped = unwrapLmObj(obj);
    if (objUnwrapped) {
      if (isJsGlobalObj(objUnwrapped)) {
        const target = getJsGlobalTarget(liveHeapObjRead(objUnwrapped));
        return $arr([
          ...(isJsGlobalTarget(target) ? Object.getOwnPropertyNames(target) : []),
          ...ephemeralPropKeys(strVal(objUnwrapped.$id)),
        ]);
      }
      return ownUserPropertyKeys(objUnwrapped);
    }
    const arrUnwrapped = unwrapLmArr(obj);
    if (arrUnwrapped) {
      return $arr([
        ...lmArrayIndexKeys(arrUnwrapped),
        'length',
        ...ephemeralPropKeys(strVal(arrUnwrapped.$id)),
      ]);
    }
    const funUnwrapped = unwrapLmFun(obj);
    if (funUnwrapped) {
      return $arr([
        ...lmOwnUserPropertyKeys(liveHeapFunRead(funUnwrapped)),
        ...ephemeralPropKeys(strVal(funUnwrapped.$id)),
      ]);
    }
    return $arr(Object.getOwnPropertyNames(obj as object));
  };

  /** Raw own-slot inspection: `{ value }` for a data slot, `{ get, set }` for an
   * accessor slot — without invoking the getter. This is how the browser reads a
   * getter/setter's source for display (reading `proto[name]` would invoke it). */
  $Object.getOwnPropertyDescriptor = function (obj: unknown, prop: PropertyKey) {
    if (typeof prop !== 'string') return undefined;
    const target = unwrapLmObj(obj) ?? unwrapLmArr(obj) ?? unwrapLmFun(obj);
    if (!target) return undefined;
    if (lmIsEphemeralKey(prop)) {
      const id = strVal(target.$id);
      if (!hasEphemeralProp(id, prop)) return undefined;
      return $obj({ value: readEphemeralProp(id, prop) as unknown as Val });
    }
    if (isArr(target)) return undefined;
    if (isObj(target) && isJsGlobalObj(target)) return undefined;
    const entry = lookupHeapEntryRead(target.$id) ?? target;
    const key = lmUserKey(prop);
    if (!lmHeapHasOwn(entry as Record<string, unknown>, key)) return undefined;
    const raw = lmHeapGet(entry as Record<string, unknown>, key);
    if (isAccessorVal(raw)) {
      return $obj({
        get: (raw.$get ? deserialize(raw.$get) : null) as unknown as Val,
        set: (raw.$set ? deserialize(raw.$set) : null) as unknown as Val,
      });
    }
    return $obj({ value: deserialize(raw) as unknown as Val });
  };

  $Object.getPrototypeOf = function (obj: unknown) {
    const unwrapped = unwrapLmObj(obj);
    if (unwrapped) {
      if (isJsGlobalObj(unwrapped)) {
        const target = getJsGlobalTarget(liveHeapObjRead(unwrapped));
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

  /** User-facing eval ($eval in transpiled code): evaluates `source` through the LM
   * transpiler, so literals, free variables, and functions behave exactly as in
   * directly-entered code. The transpiler rewrites direct `eval(x)` calls to
   * `$eval.call(this, x)`, so the evaluated source sees the caller's `this`.
   * Non-string arguments pass through unchanged, as with JS's eval. */
  function $eval(this: unknown, source: unknown): unknown {
    if (typeof source !== 'string') return source;
    return evaluateSource(source, this);
  }

  function isClassFun(fun: Fun): boolean {
    return /^\s*class\s/.test(fun.$codeForShow);
  }

  /** The transpiled superclass reference (e.g. `$global.Morph`) for a class Fun,
   * recovered from the prototype chain: `$obj({...}, Super.prototype)` made the
   * delegation real, so the class's prototype entry's $protoId is the superclass's
   * prototype — scan $global for the class Fun that owns it. 'Object' (the class
   * transpiler's implicit super) for base classes. */
  function findSuperGlobalRef(clsFun: Fun): string {
    const protoId = liveHeapFunRead(clsFun).$prototypeId;
    const protoEntry = protoId ? lookupHeapEntryRead(protoId) : undefined;
    const superProtoId = protoEntry && isObj(protoEntry) ? protoEntry.$protoId : undefined;
    if (superProtoId && superProtoId !== 'object-prototype') {
      const globalEntry = lookupHeapEntryRead('global');
      if (globalEntry) {
        for (const key of lmHeapPropertyNames(globalEntry as unknown as Record<string, unknown>)) {
          if (!key.startsWith('@') || !/^[A-Za-z_$][\w$]*$/.test(key.slice(1))) continue;
          const v = (globalEntry as unknown as Record<string, unknown>)[key];
          if (!isRef(v) || v.$id === clsFun.$id) continue;
          const entry = lookupHeapEntryRead(v.$id);
          if (entry && isFun(entry) && entry.$prototypeId === superProtoId) {
            return `$global.${key.slice(1)}`;
          }
        }
      }
    }
    return 'Object';
  }

  /** Write a raw stored value onto an entry's own '@name' slot, with the same
   * bookkeeping as the obj-proxy set path. Used where a proxy set would be wrong:
   * installing a method or accessor record over an existing accessor slot (the set
   * trap would invoke the setter instead). */
  function setRawSlotValue(id: string, name: string, stored: Val | AccessorVal): void {
    const entry = lookupHeapEntry(id);
    if (!entry) throw new Error(`Livelymerge: no heap entry ${id}`);
    const key = lmUserKey(name);
    const oldV = lmHeapGet(entry as Record<string, unknown>, key);
    (entry as Record<string, unknown>)[key] = storedValFor(id, stored);
    matWriteThrough(id, key, stored);
    markEdgeDirtyIfRefs(id, oldV, stored);
  }

  /** Replace (or add) a class member from a class-fragment source string:
   *   replaceMethod('Ellipse', 'copyMorph() { ... }')
   *   replaceMethod('Morph', 'constructor(bounds) { ... }')
   *   replaceMethod('Morph', 'get transform() { ... }')
   *   replaceMethod('Color', 'static gray() { ... }')
   * Super-sends are rewritten against the class's actual superclass (recovered from
   * the prototype chain); the stored $codeForShow keeps the fragment as written.
   * Replacing the constructor keeps the live prototype (instances stay valid),
   * carries the statics over, updates the class source, and rebinds the global. */
  function $replaceMethod(className: unknown, fragmentSource: unknown): boolean {
    if (typeof className !== 'string' || typeof fragmentSource !== 'string') {
      throw new TypeError('replaceMethod(className, classFragment) takes two strings');
    }
    return change(() => {
      const clsProxy = ($global as Record<string, unknown>)[className];
      const clsFun = unwrapLmFun(clsProxy);
      if (!clsFun || !isClassFun(liveHeapFunRead(clsFun))) {
        throw new TypeError(`replaceMethod: ${className} is not a class`);
      }
      const superGlobal = findSuperGlobalRef(clsFun);
      let compiled = compileClassFragment(fragmentSource, { className, superGlobal });
      if (compiled.kind === 'constructor') {
        // The constructor Fun's show is the full class source; splice the new
        // constructor into it so toString() / isClass() stay current.
        const newClassSource = spliceMemberIntoClassSource(
          liveHeapFunRead(clsFun).$codeForShow,
          fragmentSource,
        );
        compiled = compileClassFragment(fragmentSource, {
          className,
          superGlobal,
          showSource: newClassSource,
        });
      }

      const runtimeParams = getRuntimeParams();
      const funProxy = new Function(...Object.keys(runtimeParams), `return (${compiled.funExpr});`)(
        ...Object.values(runtimeParams),
      ) as Proxy;

      if (compiled.kind === 'constructor') {
        // A new Fun is required — proxies memoize their compiled function, so the
        // old Fun's $code cannot change in place. Keep the live prototype object
        // (instances stay valid), copy the statics, rebind the global.
        const newFunEntry = funProxy.$unwrapped as Fun;
        const oldFunEntry = liveHeapFunRead(clsFun); // reads only: statics + $prototypeId
        for (const key of lmHeapPropertyNames(oldFunEntry)) {
          if (!key.startsWith('@')) continue;
          (newFunEntry as Record<string, unknown>)[key] = materializeStoredVal(
            (oldFunEntry as Record<string, unknown>)[key],
          );
        }
        newFunEntry.$prototypeId = oldFunEntry.$prototypeId;
        markEdgeDirty(newFunEntry.$id);
        if (newFunEntry.$prototypeId) {
          setRawSlotValue(newFunEntry.$prototypeId, 'constructor', toRef(funProxy));
        }
        ($global as Record<string, unknown>)[className] = funProxy;
        return true;
      }

      if (compiled.isStatic) {
        // Statics are own user props of the class Fun (no accessor interception there).
        (clsProxy as Record<string, unknown>)[compiled.name] = funProxy;
        return true;
      }

      const protoId = liveHeapFunRead(clsFun).$prototypeId;
      if (!protoId) {
        throw new Error(`replaceMethod: class ${className} has no prototype`);
      }
      if (compiled.kind === 'method') {
        setRawSlotValue(protoId, compiled.name, toRef(funProxy));
        // Keep the class-Fun mirror in sync: the class transpiler stores instance
        // methods on the class object too, and subclass super-sends resolve through
        // it ($global.Super.m.call(this, ...)); classStaticNames also relies on
        // mirror === prototype slot to tell mirrors from real statics.
        (clsProxy as Record<string, unknown>)[compiled.name] = funProxy;
        return true;
      }
      // Getter/setter: merge the new half with the other half of any existing
      // accessor record on the same slot.
      const protoEntry = lookupHeapEntryRead(protoId);
      const raw = protoEntry
        ? lmHeapGet(protoEntry as unknown as Record<string, unknown>, lmUserKey(compiled.name))
        : undefined;
      const existing = isAccessorVal(raw) ? raw : undefined;
      const acc: AccessorVal = { $type: 'accessor' };
      const newRef = toRef(funProxy);
      const keepRef = (ref: Ref | undefined): Ref | undefined =>
        ref ? { $type: 'ref', $id: ref.$id } : undefined;
      const getRef = compiled.kind === 'get' ? newRef : keepRef(existing?.$get);
      const setRef = compiled.kind === 'set' ? newRef : keepRef(existing?.$set);
      if (getRef) acc.$get = getRef;
      if (setRef) acc.$set = setRef;
      setRawSlotValue(protoId, compiled.name, acc);
      return true;
    });
  }

  function getRuntimeParams(): Record<string, unknown> {
    return {
      $global,
      $obj,
      $arr,
      $fun,
      $accessor,
      $eval,
      replaceMethod: $replaceMethod,
      Object: $Object,
      Array: $Array,
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
  function evaluateSource(source: string, thisArg?: unknown): unknown {
    return change(() => {
      const realCode = transpile(wrapForCompletionValue(source));
      if ((globalThis as any).debugEval) console.log('realCode', realCode);
      const runtimeParams = getRuntimeParams();
      const fn = new Function(...Object.keys(runtimeParams), realCode);
      return fn.call(thisArg, ...Object.values(runtimeParams));
    });
  }

  /** Diagnostic: every ref stored in the document or shadow heap whose target id
   * resolves to neither store. Run `runtime.findDanglingRefs()` from the devtools
   * console; each entry names the referrer, so damage can be traced to its source. */
  function findDanglingRefs(): string[] {
    const out: string[] = [];
    const tables: Array<[string, Record<string, Obj | Arr | Fun>]> = [
      ['doc', doc.objectTable as Record<string, Obj | Arr | Fun>],
      ['shadow', shadowTable],
    ];
    const exists = (id: string) =>
      Object.hasOwn(shadowTable, id) || doc.objectTable[id] !== undefined;
    const lookAt = (v: unknown, where: string) => {
      if (isRef(v) && !exists(strVal(v.$id))) out.push(`${strVal(v.$id)} <- ${where}`);
    };
    for (const [store, table] of tables) {
      for (const id of Object.keys(table)) {
        // Doc entries are read through their materialized (plain-string) copies.
        const entry = store === 'doc' ? materializedEntry(id)! : table[id];
        if (isObj(entry)) {
          for (const p of lmHeapPropertyNames(entry)) lookAt(entry[p], `${store} obj ${id} '${p}'`);
          if (entry.$protoId && !exists(entry.$protoId))
            out.push(`${entry.$protoId} <- ${store} obj ${id} $protoId`);
        } else if (isArr(entry)) {
          entry.$values.forEach((v, i) => lookAt(v, `${store} arr ${id}[${i}]`));
        } else if (isFun(entry)) {
          entry.$scopes.forEach((v, i) => lookAt(v, `${store} fun ${id} scope[${i}]`));
          if (entry.$prototypeId && !exists(entry.$prototypeId))
            out.push(`${entry.$prototypeId} <- ${store} fun ${id} $prototypeId`);
          for (const p of lmOwnUserPropertyKeys(entry))
            lookAt(lmGetOwn(entry, p), `${store} fun ${id} '@${p}'`);
        }
      }
    }
    return out;
  }

  // Remote replicas' writes bypass the local write barrier. When the doc handle
  // exposes an event emitter (automerge-repo DocHandle), mark remotely-patched
  // entries edge-dirty so the next GC refreshes their edge lists. Events emitted
  // synchronously by our own docHandle.change are filtered via inChangeCall; a
  // late-delivered local event just causes a harmless extra refresh.
  const emitter = docHandle as unknown as {
    on?: (event: string, cb: (payload: unknown) => void) => void;
  };
  if (typeof emitter.on === 'function') {
    emitter.on('change', (payload) => {
      if (inChangeCall) return;
      const patches = (payload as { patches?: Array<{ path?: unknown[] }> })?.patches;
      if (!Array.isArray(patches)) {
        noteExternalChanges(); // unknown event shape: invalidate everything
        return;
      }
      const ids: string[] = [];
      for (const patch of patches) {
        const path = patch?.path;
        if (Array.isArray(path) && path[0] === 'objectTable' && typeof path[1] === 'string') {
          ids.push(path[1]);
        }
      }
      noteExternalChanges(ids);
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
    findDanglingRefs,
    doc() {
      return doc;
    },
    noteExternalChanges,
    externalChangeCount() {
      return externalChangeCount;
    },
  };
}
