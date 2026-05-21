import type { AutomergeUrl, DocHandle } from '@automerge/automerge-repo';
import { useDocHandle } from '@automerge/automerge-repo-react-hooks';
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
import { toolify } from './react-util';
import type { LivelymergeDoc, Obj, Ref, Referent } from './types';
import './styles.css';

// TODO: stop requesting animation frame after the UI unmounts
// TODO: why doesn't toString work when it's a method on Objs? (something to do w/ Proxy)
// TODO: move workspace contents to an Obj (shouldn't be special state)

interface Impl {
  change(fn: () => void): void;
  _change(fn: () => void): void;
  newObj(prototype?: Obj): Obj;
}

const vanillaImpl: Impl = {
  newObj(prototype?: Obj) {
    let obj: Obj;
    if (prototype) {
      obj = Object.create(prototype);
      obj.proto = prototype;
      obj._protoId = obj._id;
    } else {
      obj = Object.create(null);
    }
    obj._id = Math.random();
    return obj;
  },
  change(fn: () => void): void {
    return this._change(fn);
  },
  _change(fn: () => void): void {
    if (!world) {
      world = w = Object.create(null);
      (window as any).world = (window as any).w = world;
      world.proto = null;
      world._protoId = null;
      world._id = 0;
    }
    return fn();
  },
};

let docHandle: DocHandle<LivelymergeDoc>;
let doc: LivelymergeDoc;
let newObjects: Map<number, Obj> | null = null;
let newArrays: Set<any[]> | null = null;
let proxies: Map<number, any> | null = null;
let world: any, w: any;

let inChangeCall = false;

const automergeImpl: Impl = {
  newObj(prototype?: Obj): Obj {
    if (newObjects == null) {
      newObjects = new Map();
    }
    const obj: Obj = {
      type: 'obj',
      _id: Math.random(),
      _protoId: prototype != null ? prototype[UNWRAPPED as any]._id : -1,
    };
    console.log('>> fresh newObj', obj._id);
    newObjects.set(obj._id, obj);
    return proxify(obj);
  },
  change(fn: () => void) {
    if (inChangeCall) {
      fn();
      return;
    }

    let exception: any;
    newObjects = null;
    newArrays = null;
    proxies = null;
    this._change(() => {
      world = w = proxify(doc.objectTable[0], 0);
      (window as any).world = (window as any).w = world;
      inChangeCall = true;
      try {
        fn();
      } catch (e) {
        exception = e;
        debugger;
      } finally {
        gc();
        inChangeCall = false;
      }
    });
    if (exception) {
      console.error(exception);
      if (exception instanceof Error) {
        console.error(exception.stack);
      }
      throw exception;
    }
  },
  _change(fn: () => void) {
    docHandle.change((_doc) => {
      doc = _doc;
      (window as any).doc = doc;
      fn();
    });
  },
};

let impl = automergeImpl;

function newObj(prototype?: Obj) {
  return impl.newObj(prototype);
}
(window as any).newObj = newObj;

// objects

function isObj(value: any): value is Obj {
  return typeof value === 'object' && value?.type === 'obj';
}

function isRef(value: any): value is Ref {
  return (
    typeof value === 'object' && value != null && (value.type === 'ref' || value.type === 'obj ref')
  );
}

function toRef(id: number): Ref {
  return { type: 'ref', id };
}

function toObjRef(obj: Obj): Ref {
  return toRef(obj._id);
}

function referentById(id: number): Referent {
  if (newObjects?.has(id)) {
    return newObjects.get(id)!;
  }
  for (const xs of newArrays ?? []) {
    if ((xs as any)._id === id) {
      return xs;
    }
  }
  const ans = doc.objectTable[id];
  if (!ans) {
    console.error('no object with id', id);
    debugger;
    throw new Error('no object with id ' + id);
  }
  return ans;
}

// arrays

function toArrayRef(xs: any[]): Ref {
  let id = (xs as any)._id;
  if (typeof id === 'number') {
    return toRef(id);
  }

  id = Math.random();
  if (!newArrays) {
    newArrays = new Set();
  }
  newArrays.add(xs);
  console.log('>> new array with id', id, 'added to newArrays');
  Object.defineProperty(xs, '_id', { value: id });
  return toRef(id);
}

// functions

type Func = {
  type: 'func';
  code: string; // stringified function
};

function isFunc(value: any): value is Func {
  return typeof value === 'object' && value?.type === 'func';
}

const functionCache = new Map<string, () => any>();

function toFunc(f: () => void): Func {
  const code = `(${f.toString()})`;
  functionCache.set(code, f);
  return { type: 'func', code };
}

// serialization / deserialization

const UNWRAPPED = Symbol('proxy-target');

/** List index or length — stored array data (including Automerge lists). */
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

/** Plain JS arrays staged in newArrays during change() — safe for Array.prototype methods. */
function isStagedPlainArray(target: any): target is any[] {
  return Array.isArray(target) && (newArrays?.has(target) ?? false);
}

/** Values in objectTable that are arrays (plain JS or Automerge list). */
function isArrayReferent(value: any): boolean {
  if (value == null || typeof value !== 'object' || isObj(value)) {
    return false;
  }
  if (Array.isArray(value)) {
    return true;
  }
  try {
    return typeof value.length === 'number';
  } catch {
    return false;
  }
}

function _serialize(value: any): any {
  if (typeof value === 'function') {
    return toFunc(value);
  } else if (isObj(value)) {
    return toObjRef(value);
  } else if (Array.isArray(value)) {
    return toArrayRef(value);
  } else if (typeof value === 'object' && value && value[UNWRAPPED]) {
    return value[UNWRAPPED];
  } else {
    return value;
  }
}

function _deserialize(serializedValue: any): any {
  if (isFunc(serializedValue)) {
    const code = serializedValue.code;
    const cached = functionCache.get(code);
    // console.log('deserializing function', code, cached);
    if (cached) {
      return cached;
    }
    try {
      const f = eval(code) as () => any;
      functionCache.set(code, f);
      return f;
    } catch (eee) {
      console.error(eee);
      debugger;
      throw eee;
    }
  } else if (isRef(serializedValue)) {
    return proxify(referentById(serializedValue.id), serializedValue.id);
  } else {
    return serializedValue;
  }
}

function objById(id: number): Obj {
  return referentById(id) as Obj;
}

// proxies

const IS_LM_PROXY = Symbol('is-lm-proxy');

function proxifyArray(referent: any, objectTableId: number) {
  if (proxies?.has(objectTableId)) {
    return proxies.get(objectTableId)!;
  }

  // Do not use an Automerge list as the Proxy target — the engine may call
  // getOwnPropertyDescriptor("push") on it, which Automerge does not support.
  const proxyTarget = isStagedPlainArray(referent) ? referent : [];

  const proxy = new Proxy(proxyTarget, {
    set(_fake, prop, value) {
      (referent as any)[prop] = _serialize(value);
      return true;
    },
    get(_fake, prop) {
      switch (prop) {
        case IS_LM_PROXY:
          return true;
        case UNWRAPPED:
          return toRef(objectTableId);

        // override array methods
        case 'at': {
          return function (index: number) {
            return _deserialize(referent.at(index));
          };
        }
        case 'push': {
          return function () {
            for (const arg of arguments) {
              referent.push(_serialize(arg));
            }
            return referent.length;
          };
        }
        case 'pop': {
          return function () {
            return _deserialize(referent.pop());
          };
        }
        case 'unshift': {
          return function () {
            for (const arg of arguments) {
              referent.unshift(_serialize(arg));
            }
            return referent.length;
          };
        }
        case 'shift': {
          return function () {
            return _deserialize(referent.shift());
          };
        }
        case 'forEach': {
          return function (callbackFn: (value: any, index: number) => void, thisArg?: any) {
            referent.map(_deserialize).forEach(callbackFn, thisArg);
          };
        }
        case 'map': {
          return function (callbackFn: (value: any) => any, thisArg?: any) {
            return referent.map(_deserialize).map(callbackFn, thisArg);
          };
        }
        case 'slice': {
          return function (startIdx: number, endIdx?: number) {
            return referent.slice(startIdx, endIdx).map(_deserialize);
          };
        }
        case 'splice': {
          return function (startIdx: number, deleteCount = 0, ...args: any[]) {
            return referent
              .splice(startIdx, deleteCount, ...args.map(_serialize))
              .map(_deserialize);
          };
        }
        case 'concat': {
          return function (...args: any[]) {
            return referent.concat(...args.map(_serialize)).map(_deserialize);
          };
        }
        case 'join': {
          return function (separator?: string) {
            return referent.join(separator);
          };
        }
        case 'sort': {
          return function (compareFn?: (a: any, b: any) => number) {
            return referent.map(_deserialize).sort(compareFn);
          };
        }
        case 'toReversed': {
          return function () {
            return referent.map(_deserialize).toReversed();
          };
        }
      }

      if (isArrayIndexKey(prop)) {
        return _deserialize(referent[prop as any]);
      }
      if (isStagedPlainArray(referent)) {
        const protoVal = (Array.prototype as any)[prop];
        return typeof protoVal === 'function' ? protoVal : _deserialize(protoVal);
      }
      const v = (referent as any)[prop];
      return typeof v === 'function' ? v : _deserialize(v);
    },
    getOwnPropertyDescriptor(_fake, prop) {
      if (prop === UNWRAPPED) {
        return undefined;
      }
      if (isStagedPlainArray(referent)) {
        return (
          Object.getOwnPropertyDescriptor(referent, prop) ??
          Object.getOwnPropertyDescriptor(Array.prototype, prop)
        );
      }
      if (isArrayIndexKey(prop)) {
        if (prop === 'length') {
          return {
            value: referent.length,
            writable: true,
            enumerable: false,
            configurable: false,
          };
        }
        const idx = typeof prop === 'string' ? Number(prop) : prop;
        if (typeof idx === 'number' && idx >= 0 && idx < referent.length) {
          return {
            value: _deserialize(referent[idx]),
            writable: true,
            enumerable: true,
            configurable: true,
          };
        }
        return undefined;
      }
      if (typeof prop === 'string') {
        const v = (referent as any)[prop];
        if (typeof v === 'function') {
          return {
            configurable: true,
            enumerable: false,
            writable: true,
            value: v,
          };
        }
      }
      return undefined;
    },
  });

  if (!proxies) {
    proxies = new Map();
  }
  proxies.set(objectTableId, proxy);

  return proxy;
}

function proxifyObj(value: Obj) {
  if (!isObj(value)) {
    console.error(value);
    debugger;
    throw new Error('proxifyObj: value is not an object');
  }

  if (proxies?.has(value._id)) {
    return proxies.get(value._id)!;
  }

  const proxy = new Proxy(value, {
    set(obj, prop, value) {
      const sv = _serialize(value);
      (obj as any)[prop] = sv;
      return true;
    },
    get(target, prop) {
      switch (prop) {
        case IS_LM_PROXY:
          return true;
        case UNWRAPPED:
          return target;
        case '__proto__':
          if (target._protoId != null) {
            return _deserialize({ type: 'ref', id: target._protoId });
          }
          return null;
        case 'getLmId': {
          return function () {
            return target._id;
          };
        }
      }

      let obj: Obj = target;
      while (true) {
        if (obj != null && prop in obj) {
          return _deserialize((obj as any)[prop]);
        } else if (obj != null && '_protoId' in obj) {
          obj = objById(obj._protoId!);
        } else {
          return undefined;
        }
      }
    },
  });

  if (!proxies) {
    proxies = new Map();
  }
  proxies.set(value._id, proxy);

  return proxy;
}

function proxify(value: Referent, objectTableId?: number) {
  if (isArrayReferent(value) && !isObj(value)) {
    return proxifyArray(value, objectTableId ?? (value as any)._id);
  } else if (isObj(value)) {
    return proxifyObj(value);
  } else {
    console.error(value);
    debugger;
    throw new Error('proxify: value is not an object or array');
  }
}

function gc() {
  for (const xs of newArrays ?? []) {
    const id: number = (xs as any)._id;
    console.log('>> storing array with id', id, 'in object table');
    doc.objectTable[id] = xs.map(_serialize);
  }

  const visited = {} as Record<number, boolean>;
  function visit(id: number) {
    if (visited[id]) {
      return;
    }
    visited[id] = true;

    if (newObjects?.has(id)) {
      console.log('>> storing object with id', id, 'from newObjects');
      doc.objectTable[id] = newObjects.get(id)!;
    }

    const referent = doc.objectTable[id];
    if (!referent) {
      console.log('BAD: referent with id', id, 'not found');
      console.log('   newObjects: ', newObjects);
      return;
    }

    if (isObj(referent)) {
      for (const v of Object.values(referent)) {
        if ((window as any).debugGC) console.log('w');
        lookAt(v);
      }
      if (referent._protoId != null) {
        visit(referent._protoId);
      }
    } else {
      for (let i = 0; i < referent.length; i++) {
        lookAt(referent[i]);
      }
    }
  }
  function lookAt(v: any) {
    if (isRef(v)) {
      visit(v.id);
    }
  }

  visit(0);
  let numReclaimed = 0;
  for (const id of Object.keys(doc.objectTable)) {
    if (!visited[+id]) {
      delete doc.objectTable[id];
      numReclaimed++;
    }
  }
  newObjects = null;
  newArrays = null;
  if ((window as any).debugGC) {
    console.log('reclaimed', numReclaimed, 'objects');
  }
}

let alreadyInitialized = false;

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
    impl.change(() => {
      console.log('evaluating', code);
      result = eval(code);
      (window as any).result = result;
    });
    console.log('result', result);
  } catch (error) {
    result = `{ERROR: ${String(error)}}`;
    console.error('error', error);
  }

  if (!print) {
    return;
  }

  // insert the result into the editor, and select it
  const insert = ` ==> ${result}`;
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

export const LivelymergeEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  docHandle = useDocHandle<LivelymergeDoc>(docUrl, { suspense: true })!;
  (window as any).handle = docHandle; // needed for historical reasons, will go away once we update alldefs

  const title = docHandle.doc().title.trim() || 'Livelymerge';
  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** Shell stays mounted during close height animation; cleared after transition ends. */
  const [drawerInDom, setDrawerInDom] = useState(false);
  /** When true, drawer height is `drawerHeight`; when false, height is 0 (animated). */
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const [drawerHeight, setDrawerHeight] = useState(DEFAULT_DRAWER_HEIGHT);
  const [dragging, setDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

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
    if (!alreadyInitialized) {
      impl.change(() => {
        world.initUI?.();
      });
      alreadyInitialized = true;
    }
  }, [docUrl]);

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

export const renderLivelymergeEditor = toolify(LivelymergeEditor);
