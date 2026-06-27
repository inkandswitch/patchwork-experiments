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

import { type LivelymergeDoc } from './types';
import { createRoot } from 'react-dom/client';
import type { ToolElement, ToolImplementation } from '@inkandswitch/patchwork-plugins';
import './styles.css';
import { createLivelymergeRuntime, type LivelymergeRuntime } from './livelymergeRuntime';

let runtime: LivelymergeRuntime;
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
  let { from, to, head } = view.state.selection.main;
  if (from === to) {
    const line = view.state.doc.lineAt(head);
    from = line.from;
    to = line.to;
  }

  const code = view.state.sliceDoc(from, to);
  console.log('doIt', code, print);
  let result: any;
  try {
    result = runtime.eval(code);
    console.log('result', result);
  } catch (error) {
    result = `{ERROR: ${runtime.formatEvalResult(error)}}`;
    console.error('error', error);
  }

  if (!print) {
    return;
  }

  const insert = ` ==> ${runtime.formatEvalResult(result)}`;
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
  const docHandle = useDocHandle<LivelymergeDoc>(docUrl, { suspense: true })!;
  (window as any).runtime = runtime = createLivelymergeRuntime(docHandle);
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

    (window as any).canvas = canvas;
    (window as any).ctx = canvas.getContext('2d');

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
      delete (window as any).canvas;
      delete (window as any).ctx;
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
    if (!alreadyInitialized) {
      doCatchingErrors(() => {
        runtime.change(() => {
          const g = (globalThis as any).$global;
          if (typeof g?.initUI === 'function') {
            g.initUI();
          }
        });
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
