import type { DocHandle } from '@automerge/automerge-repo';
import { makeDocumentProjection } from '@automerge/automerge-repo-solid-primitives';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { Pencil } from 'lucide-solid';
import { onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { getPaperViewport } from '../../paper/get-paper-viewport.js';
import type { PaperDoc, PaperPointerEventDetail } from '../../paper/types.js';

const TOOL_ID = 'paper-line-draw';

// ─── Draw layer entry point ────────────────────────────────────────────────────

function lineDrawTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <LineDrawLayer handle={handle} element={element} />, element);
}

// ─── Draw layer ───────────────────────────────────────────────────────────────

function LineDrawLayer(props: { handle: DocHandle<PaperDoc>; element: HTMLElement }) {
  const doc = makeDocumentProjection<PaperDoc>(props.handle);

  const contactUrl = () =>
    (window as any).accountDocHandle?.doc()?.contactUrl as string | undefined;
  const isActive = () => {
    const url = contactUrl();
    return url ? doc.userState?.[url]?.selectedTool === TOOL_ID : false;
  };

  let dragShapeId: string | undefined;
  let dragOrigin: { x: number; y: number } | undefined;
  let localPoints: [number, number][] = [];

  function onPointerDown(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive()) return;
    e.stopPropagation();

    const { viewport, x, y } = e.detail;
    const pt = viewport.screenToCanvas(x, y);
    dragShapeId = crypto.randomUUID();
    dragOrigin = { x: pt.x, y: pt.y };
    localPoints = [[0, 0]];

    props.handle.change((d) => {
      d.shapes[dragShapeId!] = {
        id: dragShapeId!,
        type: 'line',
        x: pt.x,
        y: pt.y,
        points: [[0, 0]],
        stroke: '#475569',
        strokeWidth: 2,
        zIndex: Object.keys(d.shapes).length,
      };
    });
  }

  function onPointerMove(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive() || !dragShapeId || !dragOrigin) return;
    e.stopPropagation();

    const { viewport, x, y } = e.detail;
    const pt = viewport.screenToCanvas(x, y);
    const rel: [number, number] = [pt.x - dragOrigin.x, pt.y - dragOrigin.y];
    localPoints.push(rel);

    props.handle.change((d) => {
      const s = d.shapes[dragShapeId!];
      if (!s) return;
      (s as any).points.push(rel);
    });
  }

  function onPointerUp(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive()) return;
    if (dragShapeId) e.stopPropagation();

    if (dragShapeId && localPoints.length < 3) {
      props.handle.change((d) => {
        delete d.shapes[dragShapeId!];
      });
    }

    dragShapeId = undefined;
    dragOrigin = undefined;
    localPoints = [];
  }

  onMount(() => {
    const viewport = getPaperViewport(props.element);
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
  return render(() => <Pencil size={16} />, element);
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
