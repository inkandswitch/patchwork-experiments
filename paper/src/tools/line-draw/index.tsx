import type { DocHandle } from '@automerge/automerge-repo';
import { makeDocumentProjection } from '@automerge/automerge-repo-solid-primitives';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { Minus } from 'lucide-solid';
import { onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { PaperDoc, PaperPointerEventDetail, Vec2, ViewportElement } from '../../paper/types.js';

const TOOL_ID = 'paper-line-draw';

// ─── Draw layer entry point ────────────────────────────────────────────────────

function lineDrawTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <LineDrawLayer handle={handle} element={element} />, element);
}

// ─── Draw layer ───────────────────────────────────────────────────────────────

function LineDrawLayer(props: { handle: DocHandle<PaperDoc>; element: HTMLElement }) {
  const doc = makeDocumentProjection<PaperDoc>(props.handle);

  const contactUrl = () => (window as any).accountDocHandle?.doc()?.contactUrl as string | undefined;
  const isActive = () => {
    const url = contactUrl();
    return url ? doc.userState?.[url]?.selectedTool === TOOL_ID : false;
  };

  let dragShapeId: string | undefined;
  let startCanvas: Vec2 | undefined;

  function onPointerDown(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive()) return;
    e.stopPropagation();

    const { viewport, x, y } = e.detail;
    startCanvas = viewport.screenToCanvas(x, y);
    dragShapeId = `line-${Date.now()}`;

    props.handle.change((d) => {
      d.shapes[dragShapeId!] = {
        id: dragShapeId!,
        type: 'line',
        x: startCanvas!.x,
        y: startCanvas!.y,
        x1: startCanvas!.x,
        y1: startCanvas!.y,
        x2: startCanvas!.x,
        y2: startCanvas!.y,
        stroke: '#475569',
        strokeWidth: 2,
        zIndex: Object.keys(d.shapes).length,
      };
    });
  }

  function onPointerMove(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive() || !dragShapeId || !startCanvas) return;
    e.stopPropagation();

    const { viewport, x, y } = e.detail;
    const current = viewport.screenToCanvas(x, y);

    props.handle.change((d) => {
      const s = d.shapes[dragShapeId!];
      if (!s) return;
      s.x = Math.min(startCanvas!.x, current.x);
      s.y = Math.min(startCanvas!.y, current.y);
      (s as any).x2 = current.x;
      (s as any).y2 = current.y;
    });
  }

  function onPointerUp(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive()) return;
    if (dragShapeId) e.stopPropagation();

    if (dragShapeId && startCanvas) {
      const shapes = props.handle.docSync()?.shapes;
      const s = shapes?.[dragShapeId];
      if (s) {
        const dx = (s as any).x2 - startCanvas.x;
        const dy = (s as any).y2 - startCanvas.y;
        if (Math.sqrt(dx * dx + dy * dy) < 4) {
          props.handle.change((d) => { delete d.shapes[dragShapeId!]; });
        }
      }
    }

    dragShapeId = undefined;
    startCanvas = undefined;
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

  return <></>;
}

// ─── Button entry point ───────────────────────────────────────────────────────

function lineButtonTool(_handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <Minus size={16} />, element);
}

// ─── Plugins ──────────────────────────────────────────────────────────────────

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool' as const,
    id: TOOL_ID,
    name: 'Line',
    tags: ['paper-layer'],
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return lineDrawTool;
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: `${TOOL_ID}-button`,
    name: 'Line',
    toolId: TOOL_ID,
    tags: ['paper-tool-button'],
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return lineButtonTool;
    },
  },
];
