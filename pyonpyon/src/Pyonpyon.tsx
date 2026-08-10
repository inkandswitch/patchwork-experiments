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
import { createRoot } from 'react-dom/client';
import { RepoContext } from '@automerge/automerge-repo-react-hooks';
import type { ToolElement, ToolImplementation } from '@inkandswitch/patchwork-plugins';
import type {
  Obj,
  ObjectTable,
  PyonpyonDoc,
  Ref,
  SArr,
  SFun,
  SMap,
  SObj,
  SSet,
  SVal,
} from './types';
import './styles.css';
import { updateObject } from './am-updates';

let docHandle: DocHandle<PyonpyonDoc>;
let objProto = Object.create(null);
let w = Object.create(objProto);
let alreadyInitialized = false;

function newObj(prototype?: Obj) {
  return Object.create(prototype ?? objProto);
}
(window as any).newObj = newObj;

function save() {
  let nextId = 0;
  let objProtoId = -1;
  let wId = -1;
  let objectTable: ObjectTable = {};
  const objectIds = new Map<Obj, number>();
  console.log('serializing state...');
  serialize(w);
  // console.log('pre save');
  // console.log('objProto', objProto);
  // console.log('w', w);
  // console.log('during save');
  // console.log('objProtoId', objProtoId);
  // console.log('wId', wId);
  // console.log('objectTable', objectTable);
  console.log('calling doc.change...');
  docHandle.change((doc) => {
    // Never run "replace/delete missing keys" logic on the root doc,
    // or we'll remove required metadata like "@patchwork".
    doc.objProtoId = objProtoId;
    doc.wId = wId;
    updateObject(doc.objectTable as Record<string, any>, objectTable as Record<string, any>);
  });
  console.log('save done.');

  function serialize(v: any): SVal {
    if (objectIds.has(v)) {
      return { type: 'ref', id: objectIds.get(v)! };
    }

    switch (typeof v) {
      case 'number':
      case 'boolean':
      case 'string':
        return v;
      case 'function': {
        const id = nextId++;
        objectTable[id] = { type: 'fun', id, code: v.toString() };
        objectIds.set(v, id);
        return { type: 'ref', id };
      }
      case 'object':
        if (Array.isArray(v)) {
          const id = nextId++;
          const sobj: SArr = (objectTable[id] = { type: 'arr', id, elements: [] });
          objectIds.set(v, id);
          for (const e of v) {
            sobj.elements.push(serialize(e));
          }
          return { type: 'ref', id };
        } else if (v instanceof Set) {
          const id = nextId++;
          const sobj: SSet = (objectTable[id] = { type: 'set', id, elements: [] });
          objectIds.set(v, id);
          for (const e of v) {
            sobj.elements.push(serialize(e));
          }
          return { type: 'ref', id };
        } else if (v instanceof Map) {
          const id = nextId++;
          const sobj: SMap = (objectTable[id] = { type: 'map', id, keys: [], values: [] });
          objectIds.set(v, id);
          for (const [key, val] of v) {
            sobj.keys.push(serialize(key));
            sobj.values.push(serialize(val));
          }
          return { type: 'ref', id };
        } else if ((v && v === objProto) || Object.prototype.isPrototypeOf.call(objProto!, v)) {
          const id = nextId++;
          const sobj: SObj = (objectTable[id] = { type: 'obj', id, props: {} });
          objectIds.set(v, id);

          // If this is not the obj prototype, serialize its prototype and write that guy's id to sobj
          if (v !== objProto) {
            sobj.protoId = (serialize(Object.getPrototypeOf(v)) as Ref).id;
          }

          // If this is one of the two "special objects", update doc to keep track of its id
          if (v === objProto) {
            objProtoId = id;
          } else if (v === w) {
            wId = id;
          }

          // Serialize this object's properties
          for (const [p, pv] of Object.entries(v)) {
            sobj.props[p] = serialize(pv);
          }
          return { type: 'ref', id };
        } else {
          return null;
        }
      default:
        return null;
    }
  }
}

function load() {
  const { objProtoId, wId, objectTable } = docHandle.doc();
  const objById = new Map<number, any>();
  // console.log('load');
  // console.log('objProtoId', objProtoId);
  // console.log('wId', wId);
  // console.log('objectTable', objectTable);
  console.log('deserializing...');
  deserialize(objectTable[wId]);
  // console.log('objProto', objProto);
  // console.log('w', w);
  // if (w?.init) {
  //   console.log('calling init...');
  //   w.init();
  // }
  console.log('load done.');

  function deserialize(s: SVal | SObj | SArr | SSet | SMap | SFun) {
    // console.log('deserializing', s);
    if (typeof s === 'number' || typeof s === 'boolean' || typeof s === 'string' || s === null) {
      return s;
    } else if (objById.has(s.id)) {
      return objById.get(s.id)!;
    } else if (s.type === 'ref') {
      return deserialize(objectTable[s.id]);
    } else if (s.type === 'arr') {
      const obj: any[] = [];
      objById.set(s.id, obj);
      for (const e of s.elements) {
        obj.push(deserialize(e));
      }
      return obj;
    } else if (s.type === 'set') {
      const obj = new Set();
      objById.set(s.id, obj);
      for (const e of s.elements) {
        obj.add(deserialize(e));
      }
      return obj;
    } else if (s.type === 'map') {
      const obj = new Map();
      objById.set(s.id, obj);
      for (let idx = 0; idx < s.keys.length; idx++) {
        const k = deserialize(s.keys[idx]);
        const v = deserialize(s.values[idx]);
        obj.set(k, v);
      }
      return obj;
    } else if (s.type === 'fun') {
      const obj = doCatchingErrors(() => eval(`(${s.code})`));
      objById.set(s.id, obj);
      return obj;
    } else if (s.type === 'obj') {
      let obj: Obj;
      if (s.protoId === undefined) {
        if (s.id !== objProtoId) {
          throw new Error('whaaaa?!?!');
        }
        obj = objProto = Object.create(null);
      } else {
        const pobj = deserialize(objectTable[s.protoId]);
        obj = Object.create(pobj);
        if (s.id === wId) {
          // console.log('just created a new w');
          w = obj;
        }
      }
      objById.set(s.id, obj);
      for (const [p, pv] of Object.entries(s.props)) {
        obj[p] = deserialize(pv);
      }
      return obj;
    } else {
      console.error('fatal: invalid argument to _deserialize', s);
      throw new Error('see console');
    }
  }
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
    result = eval(code);
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

export const PyonpyonEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  docHandle = useDocHandle<PyonpyonDoc>(docUrl, { suspense: true })!;
  (window as any).handle = docHandle; // needed for historical reasons, will go away once we update alldefs

  const canvasRef = useRef<HTMLCanvasElement>(null);

  /** Shell stays mounted during close height animation; cleared after transition ends. */
  const [drawerInDom, setDrawerInDom] = useState(false);
  /** When true, drawer height is `drawerHeight`; when false, height is 0 (animated). */
  const [drawerExpanded, setDrawerExpanded] = useState(false);
  const [drawerHeight, setDrawerHeight] = useState(DEFAULT_DRAWER_HEIGHT);
  const [dragging, setDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  const editorMountRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const openRafRef = useRef<number | null>(null);
  const saveInFlightRef = useRef(false);
  const saveSuccessTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveHandlerRef = useRef<() => void>(() => {});
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
          {
            key: 'Mod-s',
            run: () => {
              saveHandlerRef.current();
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
      load();
      // if (typeof w?.init === 'function') {
      //   w.init('clean start');
      // }
      if (typeof w?.initUI === 'function') {
        w.initUI();
      }
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
      if (saveSuccessTimerRef.current != null) {
        clearTimeout(saveSuccessTimerRef.current);
        saveSuccessTimerRef.current = null;
      }
    },
    [],
  );

  const showSaveSuccessNotice = useCallback(() => {
    setShowSaveSuccess(true);
    if (saveSuccessTimerRef.current != null) {
      clearTimeout(saveSuccessTimerRef.current);
    }
    saveSuccessTimerRef.current = setTimeout(() => {
      saveSuccessTimerRef.current = null;
      setShowSaveSuccess(false);
    }, 1600);
  }, []);

  const handleSave = useCallback(() => {
    if (saveInFlightRef.current) {
      return;
    }
    saveInFlightRef.current = true;
    setIsSaving(true);
    window.requestAnimationFrame(() => {
      try {
        save();
        showSaveSuccessNotice();
      } catch (error) {
        console.error('error saving', error);
        debugger;
      } finally {
        saveInFlightRef.current = false;
        setIsSaving(false);
      }
    });
  }, [showSaveSuccessNotice]);
  saveHandlerRef.current = handleSave;

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
    <div className="pyonpyon">
      <canvas ref={canvasRef} className="pyonpyon-canvas canvas" />
      <div className="toast-slot">
        <div className="toast" data-visible={showSaveSuccess || undefined} role="status" aria-live="polite">
          Save succeeded
        </div>
      </div>

      {!drawerInDom && (
        <div className="drawer-launcher">
          <button type="button" className="button" onClick={openDrawer}>
            <span className="glyph">▲</span>
            Workspace
          </button>
          <button
            type="button"
            className="button"
            data-busy={isSaving || undefined}
            onClick={handleSave}
            disabled={isSaving}
            aria-busy={isSaving}
          >
            Save
          </button>
        </div>
      )}

      {drawerInDom && (
        <div
          className="drawer"
          style={{
            height: drawerShellHeight,
            transition: dragging ? 'none' : 'height 0.32s cubic-bezier(0.32, 0.72, 0, 1)',
          }}
          onTransitionEnd={onDrawerTransitionEnd}
        >
          <div className="drawer-body">
            <div className="drawer-bar">
              <div
                role="separator"
                aria-orientation="horizontal"
                aria-label="Resize editor panel"
                className="drawer-grab"
                onPointerDown={onHandlePointerDown}
                onPointerMove={onHandlePointerMove}
                onPointerUp={onHandlePointerUp}
                onPointerCancel={onHandlePointerUp}
              >
                <span className="drawer-grab__pill" />
              </div>
              <button
                type="button"
                className="button button--ghost"
                aria-label="Collapse workspace"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={closeDrawer}
              >
                <span className="glyph glyph--sm">▼</span>
                Close
              </button>
              <button
                type="button"
                className="button button--ghost"
                data-busy={isSaving || undefined}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={handleSave}
                disabled={isSaving}
                aria-busy={isSaving}
              >
                Save
              </button>
            </div>
            <div ref={editorMountRef} className="drawer-editor" />
          </div>
        </div>
      )}
    </div>
  );
};

export function renderPyonpyonEditor(
  handle: { url: AutomergeUrl },
  element: ToolElement
): ReturnType<ToolImplementation> {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <PyonpyonEditor docUrl={handle.url} />
    </RepoContext.Provider>
  );
  return () => root.unmount();
}
