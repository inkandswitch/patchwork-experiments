import type { DocHandle } from '@automerge/automerge-repo';
import { makeDocumentProjection } from '@automerge/automerge-repo-solid-primitives';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { Square } from 'lucide-solid';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { PaperDoc, PaperPointerEventDetail, Vec2 } from '../../paper/types.js';

const TOOL_ID = 'paper-rectangle-draw';

// ─── Draw layer entry point ────────────────────────────────────────────────────

function rectangleDrawTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <RectangleDrawLayer handle={handle} element={element} />, element);
}

// ─── Draw layer ───────────────────────────────────────────────────────────────

function RectangleDrawLayer(props: { handle: DocHandle<PaperDoc>; element: HTMLElement }) {
  const doc = makeDocumentProjection<PaperDoc>(props.handle);

  const contactUrl = () => (window as any).accountDocHandle?.doc()?.contactUrl as string | undefined;
  const isActive = () => {
    const url = contactUrl();
    return url ? doc.userState?.[url]?.selectedTool === TOOL_ID : false;
  };

  let dragShapeId: string | undefined;
  let startCanvas: Vec2 | undefined;
  const [preview, setPreview] = createSignal<{ x: number; y: number; w: number; h: number } | null>(null);

  function onPointerDown(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive()) return;
    e.stopPropagation();

    const { viewport, x, y } = e.detail;
    startCanvas = viewport.screenToCanvas(x, y);
    dragShapeId = crypto.randomUUID();

    props.handle.change((d) => {
      d.shapes[dragShapeId!] = {
        id: dragShapeId!,
        type: 'rectangle',
        x: startCanvas!.x,
        y: startCanvas!.y,
        w: 1,
        h: 1,
        fill: '#e2e8f0',
        stroke: '#475569',
        strokeWidth: 2,
        zIndex: Object.keys(d.shapes).length,
      };
    });

    setPreview({ x: startCanvas.x, y: startCanvas.y, w: 1, h: 1 });
  }

  function onPointerMove(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive() || !dragShapeId || !startCanvas) return;
    e.stopPropagation();

    const { viewport, x, y } = e.detail;
    const current = viewport.screenToCanvas(x, y);
    const rx = Math.min(startCanvas.x, current.x);
    const ry = Math.min(startCanvas.y, current.y);
    const rw = Math.max(1, Math.abs(current.x - startCanvas.x));
    const rh = Math.max(1, Math.abs(current.y - startCanvas.y));

    props.handle.change((d) => {
      const s = d.shapes[dragShapeId!];
      if (!s) return;
      s.x = rx;
      s.y = ry;
      (s as any).w = rw;
      (s as any).h = rh;
    });

    setPreview({ x: rx, y: ry, w: rw, h: rh });
  }

  function onPointerUp(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive()) return;
    if (dragShapeId) e.stopPropagation();

    if (dragShapeId) {
      const p = preview();
      if (p && p.w < 4 && p.h < 4) {
        props.handle.change((d) => { delete d.shapes[dragShapeId!]; });
      }
    }

    dragShapeId = undefined;
    startCanvas = undefined;
    setPreview(null);
  }

  onMount(() => {
    props.element.addEventListener('paper:pointerdown', onPointerDown as EventListener);
    props.element.addEventListener('paper:pointermove', onPointerMove as EventListener);
    props.element.addEventListener('paper:pointerup', onPointerUp as EventListener);

    onCleanup(() => {
      props.element.removeEventListener('paper:pointerdown', onPointerDown as EventListener);
      props.element.removeEventListener('paper:pointermove', onPointerMove as EventListener);
      props.element.removeEventListener('paper:pointerup', onPointerUp as EventListener);
    });
  });

  return <></>;
}

// ─── Button entry point ───────────────────────────────────────────────────────

function rectangleButtonTool(_handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <Square size={16} />, element);
}

// ─── Plugins ──────────────────────────────────────────────────────────────────

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool' as const,
    id: TOOL_ID,
    name: 'Rectangle',
    tags: ['paper-layer'],
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return rectangleDrawTool;
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: `${TOOL_ID}-button`,
    name: 'Rectangle',
    toolId: TOOL_ID,
    tags: ['paper-tool-button'],
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return rectangleButtonTool;
    },
  },
];
