import type { DocHandle } from '@automerge/automerge-repo';
import { makeDocumentProjection } from '@automerge/automerge-repo-solid-primitives';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { MousePointer } from 'lucide-solid';
import { Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { PaperDoc, PaperPointerEventDetail, Rect, Vec2, ViewportElement } from '../../paper/types.js';
import './select.css';

const TOOL_ID = 'paper-select';

const SELECTION_FILTER =
  'drop-shadow(0 0 2px rgba(26,115,232,0.9)) drop-shadow(0 0 5px rgba(26,115,232,0.4))';

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

  let startCanvas: Vec2 | undefined;
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

    const { viewport, x, y } = e.detail;
    startCanvas = viewport.screenToCanvas(x, y);
    setDragRect({ x: startCanvas.x, y: startCanvas.y, w: 1, h: 1 });

    const url = contactUrl();
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
    const rx = Math.min(startCanvas.x, current.x);
    const ry = Math.min(startCanvas.y, current.y);
    const rw = Math.max(1, Math.abs(current.x - startCanvas.x));
    const rh = Math.max(1, Math.abs(current.y - startCanvas.y));

    setDragRect({ x: rx, y: ry, w: rw, h: rh });
  }

  function onPointerUp(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive()) return;
    if (startCanvas) e.stopPropagation();

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

    startCanvas = undefined;
    setDragRect(null);
  }

  onMount(() => {
    const viewport = props.element.closest('.paper-viewport') as ViewportElement | null;
    if (!viewport) return;

    viewport.addEventListener('paper:pointerdown', onPointerDown as EventListener);
    viewport.addEventListener('paper:pointermove', onPointerMove as EventListener);
    viewport.addEventListener('paper:pointerup', onPointerUp as EventListener);

    onCleanup(() => {
      viewport.removeEventListener('paper:pointerdown', onPointerDown as EventListener);
      viewport.removeEventListener('paper:pointermove', onPointerMove as EventListener);
      viewport.removeEventListener('paper:pointerup', onPointerUp as EventListener);
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
