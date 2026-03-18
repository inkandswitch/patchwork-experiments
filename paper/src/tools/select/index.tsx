import type { DocHandle } from '@automerge/automerge-repo';
import { makeDocumentProjection } from '@automerge/automerge-repo-solid-primitives';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { MousePointer } from 'lucide-solid';
import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { PaperDoc, PaperPointerEventDetail, Rect, Vec2, ViewportElement } from '../../paper/types.js';
import './select.css';

const TOOL_ID = 'paper-select';
const HIT_SIZE = 8;

const SELECTION_FILTER =
  'drop-shadow(0 0 2px rgba(26,115,232,0.9)) drop-shadow(0 0 5px rgba(26,115,232,0.4))';

type DragMode = 'marquee' | 'move' | null;

// ─── Select layer entry point ─────────────────────────────────────────────────

function selectTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <SelectLayer handle={handle} element={element} />, element);
}

// ─── Select layer ─────────────────────────────────────────────────────────────

function SelectLayer(props: { handle: DocHandle<PaperDoc>; element: HTMLElement }) {
  const doc = makeDocumentProjection<PaperDoc>(props.handle);

  const contactUrl = () => (window as any).accountDocHandle?.doc()?.contactUrl as string | undefined;
  const isActive = () => {
    const url = contactUrl();
    return url ? doc.userState?.[url]?.selectedTool === TOOL_ID : false;
  };

  let dragMode: DragMode = null;
  let startCanvas: Vec2 | undefined;
  let shapeOrigins = new Map<string, Vec2>();
  const [dragRect, setDragRect] = createSignal<Rect | null>(null);

  // ── Highlight selected shapes imperatively ─────────────────────────────────

  const appliedFilters = new Map<string, string>();

  createEffect(() => {
    const url = contactUrl();
    const selection = url ? doc.userState?.[url]?.selection ?? {} : {};
    const selected = new Set(Object.keys(selection));

    for (const [id, origFilter] of appliedFilters) {
      if (!selected.has(id)) {
        const el = document.querySelector<HTMLElement>(`[data-shape-id="${id}"]`);
        if (el) el.style.filter = origFilter;
        appliedFilters.delete(id);
      }
    }

    for (const id of selected) {
      if (!appliedFilters.has(id)) {
        const el = document.querySelector<HTMLElement>(`[data-shape-id="${id}"]`);
        if (el) {
          appliedFilters.set(id, el.style.filter);
          el.style.filter = SELECTION_FILTER;
        }
      }
    }
  });

  onCleanup(() => {
    for (const [id, origFilter] of appliedFilters) {
      const el = document.querySelector<HTMLElement>(`[data-shape-id="${id}"]`);
      if (el) el.style.filter = origFilter;
    }
    appliedFilters.clear();
  });

  // ── Pointer event handlers ─────────────────────────────────────────────────

  function onPointerDown(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive()) return;
    e.stopPropagation();

    const { viewport, x, y, shiftKey } = e.detail;
    const canvasPos = viewport.screenToCanvas(x, y);
    const url = contactUrl();
    const selection = url ? doc.userState?.[url]?.selection ?? {} : {};

    const hitRect: Rect = {
      x: canvasPos.x - HIT_SIZE / 2,
      y: canvasPos.y - HIT_SIZE / 2,
      w: HIT_SIZE,
      h: HIT_SIZE,
    };
    const shapesAtPoint = viewport.getShapesInRect(hitRect);
    const hitShape = shapesAtPoint.at(-1); // last = highest zIndex
    const hitId = hitShape?.dataset.shapeId;

    if (shiftKey && hitId) {
      // Toggle the hit shape in/out of the existing selection — no drag
      props.handle.change((d) => {
        if (!d.userState) d.userState = {};
        if (!d.userState[url!]) d.userState[url!] = {};
        const sel = d.userState[url!].selection ?? {};
        if (sel[hitId]) {
          delete sel[hitId];
        } else {
          sel[hitId] = true;
        }
        d.userState[url!].selection = sel;
      });
      dragMode = null;
      return;
    }

    if (hitId && selection[hitId]) {
      // Clicked inside current selection → move all selected shapes
      dragMode = 'move';
      startCanvas = canvasPos;
      shapeOrigins.clear();
      for (const id of Object.keys(selection)) {
        const s = doc.shapes?.[id];
        if (s) shapeOrigins.set(id, { x: s.x, y: s.y });
      }
      return;
    }

    if (hitId) {
      // Clicked an unselected shape → select it alone and start moving it
      dragMode = 'move';
      startCanvas = canvasPos;
      shapeOrigins.clear();
      const s = doc.shapes?.[hitId];
      if (s) shapeOrigins.set(hitId, { x: s.x, y: s.y });
      props.handle.change((d) => {
        if (!d.userState) d.userState = {};
        if (!d.userState[url!]) d.userState[url!] = {};
        d.userState[url!].selection = { [hitId]: true };
      });
      return;
    }

    // Clicked empty space → clear selection and start marquee
    dragMode = 'marquee';
    startCanvas = canvasPos;
    setDragRect({ x: canvasPos.x, y: canvasPos.y, w: 1, h: 1 });
    if (url) {
      props.handle.change((d) => {
        if (!d.userState) d.userState = {};
        if (!d.userState[url]) d.userState[url] = {};
        d.userState[url].selection = {};
      });
    }
  }

  function onPointerMove(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive() || !startCanvas) return;
    e.stopPropagation();

    const { viewport, x, y } = e.detail;
    const current = viewport.screenToCanvas(x, y);

    if (dragMode === 'move') {
      const dx = current.x - startCanvas.x;
      const dy = current.y - startCanvas.y;
      props.handle.change((d) => {
        for (const [id, orig] of shapeOrigins) {
          if (d.shapes[id]) {
            d.shapes[id].x = orig.x + dx;
            d.shapes[id].y = orig.y + dy;
          }
        }
      });
      return;
    }

    const rx = Math.min(startCanvas.x, current.x);
    const ry = Math.min(startCanvas.y, current.y);
    const rw = Math.max(1, Math.abs(current.x - startCanvas.x));
    const rh = Math.max(1, Math.abs(current.y - startCanvas.y));
    setDragRect({ x: rx, y: ry, w: rw, h: rh });
  }

  function onPointerUp(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive()) return;
    if (startCanvas) e.stopPropagation();

    if (dragMode === 'marquee') {
      const rect = dragRect();
      const { viewport } = e.detail;
      const url = contactUrl();
      if (rect && url) {
        const newSelection = computeSelection(rect, viewport);
        props.handle.change((d) => {
          if (!d.userState) d.userState = {};
          if (!d.userState[url]) d.userState[url] = {};
          d.userState[url].selection = newSelection;
        });
      }
    }

    dragMode = null;
    startCanvas = undefined;
    shapeOrigins.clear();
    setDragRect(null);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!isActive()) return;
    if (e.key !== 'Backspace' && e.key !== 'Delete') return;
    const url = contactUrl();
    const selection = url ? doc.userState?.[url]?.selection ?? {} : {};
    if (Object.keys(selection).length === 0) return;
    e.preventDefault();
    props.handle.change((d) => {
      for (const id of Object.keys(selection)) delete d.shapes[id];
      if (url && d.userState?.[url]) d.userState[url].selection = {};
    });
  }

  onMount(() => {
    props.element.addEventListener('paper:pointerdown', onPointerDown as EventListener);
    props.element.addEventListener('paper:pointermove', onPointerMove as EventListener);
    props.element.addEventListener('paper:pointerup', onPointerUp as EventListener);
    window.addEventListener('keydown', onKeyDown);

    onCleanup(() => {
      props.element.removeEventListener('paper:pointerdown', onPointerDown as EventListener);
      props.element.removeEventListener('paper:pointermove', onPointerMove as EventListener);
      props.element.removeEventListener('paper:pointerup', onPointerUp as EventListener);
      window.removeEventListener('keydown', onKeyDown);
    });
  });

  return (
    <Show when={dragRect()}>
      {(rect) => (
        <div
          class="paper-selection-drag"
          style={{
            left: `${rect().x}px`,
            top: `${rect().y}px`,
            width: `${rect().w}px`,
            height: `${rect().h}px`,
          }}
        />
      )}
    </Show>
  );
}

function computeSelection(rect: Rect, viewport: ViewportElement): Record<string, true> {
  const result: Record<string, true> = {};
  for (const el of viewport.getShapesInRect(rect)) {
    const id = el.dataset.shapeId;
    if (id) result[id] = true;
  }
  return result;
}

// ─── Button entry point ───────────────────────────────────────────────────────

function selectButtonTool(_handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <MousePointer size={16} />, element);
}

// ─── Plugins ──────────────────────────────────────────────────────────────────

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool' as const,
    id: TOOL_ID,
    name: 'Select',
    tags: ['paper-layer'],
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return selectTool;
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: `${TOOL_ID}-button`,
    name: 'Select',
    toolId: TOOL_ID,
    tags: ['paper-tool-button'],
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return selectButtonTool;
    },
  },
];
