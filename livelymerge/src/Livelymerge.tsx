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
import type { LivelymergeDoc, Obj, ObjRef } from './types';
import './styles.css';

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
      world = Object.create(null);
      (window as any).world = world;
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
let proxies: Map<number, Obj> | null = null;
let world: any;

const automergeImpl: Impl = {
  newObj(prototype?: Obj): Obj {
    if (newObjects == null) {
      newObjects = new Map();
    }
    const obj: Obj = { type: 'obj', _id: Math.random() };
    if (prototype !== undefined) {
      obj._protoId = prototype[UNWRAPPED as any]._id;
    }
    newObjects.set(obj._id, obj);
    return proxify(obj);
  },
  change(fn: () => void) {
    let exception: any;
    newObjects = null;
    proxies = null;
    this._change(() => {
      world = proxify(doc.objectTable[0]);
      (window as any).world = world;
      try {
        fn();
      } catch (e) {
        exception = e;
      } finally {
        gc();
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

function isObjRef(value: any): value is ObjRef {
  return typeof value === 'object' && value?.type === 'obj ref';
}

function toObjRef(obj: Obj): ObjRef {
  // console.log("creating ref to", obj, "with id", obj._id);
  return {
    type: 'obj ref',
    id: obj._id,
  };
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

function _serialize(value: any): any {
  if (typeof value === 'function') {
    return toFunc(value);
  } else if (isObj(value)) {
    return toObjRef(value);
  } else if (Array.isArray(value)) {
    return value.map(_serialize);
  } else if (typeof value === 'object' && value && value[UNWRAPPED]) {
    return value[UNWRAPPED];
  } else {
    return value;
  }
}

function _deserizalize(serializedValue: any): any {
  if (isFunc(serializedValue)) {
    const cached = functionCache.get(serializedValue.code);
    if (cached) {
      return cached;
    }
    const f = eval(serializedValue.code) as () => any;
    functionCache.set(serializedValue.code, f);
    return f;
  } else if (isObjRef(serializedValue)) {
    return proxify(objById(serializedValue.id));
  } else if (Array.isArray(serializedValue)) {
    return proxify(serializedValue);
  } else {
    return serializedValue;
  }
}

function objById(id: number) {
  return newObjects?.has(id) ? newObjects.get(id)! : doc.objectTable[id];
}

// the proxy

function proxify(value: any) {
  if (isObj(value) && proxies?.has(value._id)) {
    return proxies.get(value._id)!;
  }

  const proxy = new Proxy(value, {
    set(obj, prop, value) {
      const sv = _serialize(value);
      obj[prop] = sv;
      // console.log(
      //   "proxy set",
      //   obj._id,
      //   ".",
      //   prop,
      //   "to",
      //   value,
      //   sv,
      //   doc.objectTable[obj._id]
      // );
      return true;
    },
    get(target, prop, receiver) {
      if (prop === UNWRAPPED) {
        return target;
      }
      // console.log("looking for", prop, "in", target._id);
      let obj = target;
      while (true) {
        if (prop in obj) {
          // console.log("found", prop, "in", target._id, "ancestor", obj._id);
          return _deserizalize(obj[prop]);
        } else if ('_protoId' in obj) {
          // console.log(
          //   "didnt find",
          //   prop,
          //   "in",
          //   obj._id,
          //   "so looking for it in",
          //   obj._protoId
          // );
          obj = objById(obj._protoId);
        } else {
          // console.log(
          //   "bottomed out while looking for",
          //   prop,
          //   "in",
          //   target._id,
          //   obj._id
          // );
          return undefined;
        }
      }
    },
  });

  if (isObj(value)) {
    if (!proxies) {
      proxies = new Map();
    }
    proxies.set(value._id, proxy);
  }

  return proxy;
}

function gc() {
  // console.log("doing gc");
  const visited = {} as any;
  function visit(id: number) {
    if (visited[id]) {
      return;
    }
    // console.log("visited", id);
    visited[id] = true;

    // if it's a new object, put it in the OT
    if (newObjects?.has(id)) {
      doc.objectTable[id] = newObjects.get(id)!;
    }

    const obj = doc.objectTable[id];
    if (!obj) {
      console.log('BAD: object with id', id, 'not found');
      console.log('   newObjects: ', newObjects);
      return;
    }
    for (const v of Object.values(obj)) {
      lookAt(v);
    }
  }
  function lookAt(v: any) {
    // console.log("looking at", v);
    if (Array.isArray(v)) {
      console.log('REALLY BAD: a JS array is referenced by one of our objects', v);
      // v.forEach(lookAt);
    } else if (isObjRef(v)) {
      visit(v.id);
    }
  }

  visit(0);
  // console.log("visited", visited);
  let numReclaimed = 0;
  for (const id of Object.keys(doc.objectTable)) {
    if (!visited[id]) {
      delete doc.objectTable[id];
      numReclaimed++;
    }
  }
  newObjects = null;
  if ((window as any).debugGC) {
    console.log('reclaimed', numReclaimed, 'objects');
  }
}

/*
// TODO: Livelymerge equivalent...
let objProto = Object.create(null);
let w = Object.create(objProto);
*/
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
    result = eval(code);
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
  docHandle = useDocHandle<LivelymergeDoc>(docUrl)!;
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
      // TODO: why doesn't this work at load time?
      // world.initUI?.();
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
