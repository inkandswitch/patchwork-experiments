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
let w: any;

let inChangeCall = false;

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
      w = (window as any).world = deserialize(doc.objectTable[0]);
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

function newObj(proto?: Proxy) {
  return $obj({}, proto);
}
(window as any).newObj = newObj;

function $obj(obj: Record<string, Val>, proto?: Proxy) {
  const $id = Math.random().toString();
  const entry: Obj = {
    $type: 'obj',
    $id,
    $protoId: proto?.$id ?? '-1',
  };
  for (const [k, v] of Object.entries(obj)) {
    entry[k] = toVal(v);
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

function livelyArrayFromArgs(args: any[]): Proxy {
  if (args.length === 1 && typeof args[0] === 'number') {
    const n = args[0];
    const len = n >>> 0;
    if (len !== n) {
      throw new RangeError('Invalid array length');
    }
    return $arr(Array.from({ length: len }));
  }
  return $arr(args);
}

function livelyArrayIsArray(x: unknown): boolean {
  return isProxy(x) && isArr(x.$unwrapped);
}

interface LivelyArrayConstructor {
  (...args: any[]): Proxy;
  isArray(x: unknown): boolean;
  from(
    iterable: Iterable<any> | ArrayLike<any>,
    mapFn?: (value: any, index: number) => any,
    thisArg?: any,
  ): Proxy;
  of(...items: any[]): Proxy;
}

const LivelyArray = function Array(...args: any[]) {
  return livelyArrayFromArgs(args);
} as LivelyArrayConstructor;

LivelyArray.isArray = livelyArrayIsArray;

LivelyArray.from = function (
  iterable: Iterable<any> | ArrayLike<any>,
  mapFn?: (value: any, index: number) => any,
  thisArg?: any,
) {
  const items = mapFn ? Array.from(iterable, mapFn, thisArg) : Array.from(iterable);
  return $arr(items);
};

LivelyArray.of = function (...items: any[]) {
  return $arr(items);
};

Object.defineProperty(LivelyArray, Symbol.hasInstance, {
  value: (x: unknown) => livelyArrayIsArray(x),
});

const scopesToFnCache = new Map<string, (...args: any[]) => () => any>();

function $fun($code: string, scopes: Proxy[] = []) {
  let scopesToFn = scopesToFnCache.get($code);
  if (!scopesToFn) {
    scopesToFn = new Function('return ' + $code)() as (...args: any[]) => () => any;
    scopesToFnCache.set($code, scopesToFn);
  }

  const $id = Math.random().toString();
  const entry: Fun = {
    $type: 'fun',
    $id,
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
      (obj as any)['@' + (prop as string)] = toVal(value);
      return true;
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
          return !obj.$protoId ? null : deserialize(doc.objectTable[obj.$protoId]);
      }

      prop = '@' + (prop as string);
      let o = obj;
      while (o) {
        if (Object.hasOwn(o, prop)) {
          return deserialize((o as any)[prop]);
        } else if (o.$protoId) {
          o = doc.objectTable[o.$protoId] as Obj;
        } else {
          break;
        }
      }

      if (prop === 'toString') {
        return () => `[obj ${obj.$id}]`;
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
  if (isProxy(value)) return value.toString();
  try {
    return '' + value;
  } catch {
    return `[${typeof value}]`;
  }
}

function proxifyFun(fun: Fun): Proxy {
  let p = proxies?.get(fun.$id);
  if (p) {
    return p;
  }

  let _ref: Ref | null = null;
  const ref = () => {
    if (!_ref) {
      _ref = { $type: 'ref', $id: fun.$id };
    }
    return _ref;
  };

  let _fn: (() => any) | null = null;
  const fn: () => (...args: any[]) => any = () => {
    if (!_fn) {
      _fn = scopesToFnCache.get(fun.$code)!(...fun.$scopes.map(deserialize));
    }
    return _fn;
  };

  p = new Proxy(() => null, {
    set(_, prop, value) {
      throw new Error('setting function properties is a no-no!');
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
        case 'toString':
          return () => `[fun ${fun.$id}]`;
      }
      return undefined;
    },
    apply(_, thisArg, args) {
      return fn().apply(thisArg, args);
    },
  }) as unknown as Proxy;
  ensureProxies().set(fun.$id, p);
  return p;
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
    } else {
      throw new Error('WAT');
    }
  }

  function lookAt(v: Val) {
    if (isRef(v)) {
      visit(v.$id);
    }
  }

  visit('0');
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
      result = (window as any).result = new Function(
        'w',
        '$obj',
        '$arr',
        '$fun',
        'newObj',
        'Array',
        // TODO: setTimeout, setInterval
        realCode,
      )(w, $obj, $arr, $fun, newObj, LivelyArray);
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
