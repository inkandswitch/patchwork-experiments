import type { AutomergeUrl } from '@automerge/automerge-repo';
import { useDocument } from '@automerge/automerge-repo-react-hooks';
import { javascript } from '@codemirror/lang-javascript';
import { EditorState, Prec } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { EditorView, basicSetup } from 'codemirror';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as DomPointerEvent,
  type TransitionEvent,
} from 'react';
import { toolify } from './react-util';
import type { PyonpyonDoc } from './types';
import './styles.css';

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
  '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' },
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

const doItKeymap = Prec.highest(
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
);

export const PyonpyonEditor = ({ docUrl }: { docUrl: AutomergeUrl }) => {
  const [doc] = useDocument<PyonpyonDoc>(docUrl, { suspense: true });
  const title = doc.title?.trim() || 'Pyonpyon';
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

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const dpr = window.devicePixelRatio ?? 1;
      const { width, height } = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(width * dpr));
      const h = Math.max(1, Math.floor(height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '16px system-ui, sans-serif';
      ctx.fillText(title, width / 2, height / 2);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, [title]);

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

  useLayoutEffect(() => {
    if (!drawerInDom) return;

    const parent = editorMountRef.current;
    if (!parent) return;

    const view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [basicSetup, javascript(), codeMirrorTheme, doItKeymap],
      }),
      parent,
    });

    return () => {
      view.destroy();
    };
  }, [drawerInDom]);

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

  const handleSave = useCallback(() => {
    // Wire to Automerge / workspace persistence when the doc shape supports it.
  }, []);

  const onDrawerTransitionEnd = useCallback((e: TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || e.propertyName !== 'height') return;
    // Must use ref: when the *open* height transition ends, a stale closure can still see expanded=false and tear the drawer down.
    if (!drawerExpandedRef.current) {
      finalizeDrawerShellRemoval();
    }
  }, [finalizeDrawerShellRemoval]);

  const onHandlePointerDown = useCallback((e: DomPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startY: e.clientY, startHeight: drawerHeight };
    setDragging(true);
  }, [drawerHeight]);

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
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-base-100">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      </div>

      {!drawerInDom && (
        <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-center gap-2 border-t border-base-300/50 bg-base-100 py-2 shadow-[0_-2px_12px_rgba(0,0,0,0.06)]">
          <button type="button" className="btn btn-sm btn-ghost gap-1 shadow-sm" onClick={openDrawer}>
            <span className="text-base leading-none">▲</span>
            Workspace
          </button>
          <button type="button" className="btn btn-sm btn-ghost shadow-sm" onClick={handleSave}>
            Save
          </button>
        </div>
      )}

      {drawerInDom && (
        <div
          className="flex shrink-0 flex-col overflow-hidden border-t border-base-300 bg-base-200 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]"
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
                <button
                  type="button"
                  className="btn btn-ghost btn-xs shrink-0"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={handleSave}
                >
                  Save
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

export const renderPyonpyonEditor = toolify(PyonpyonEditor);
