import type { DocHandle } from '@automerge/automerge-repo';
import { makeDocumentProjection } from '@automerge/automerge-repo-solid-primitives';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { Pencil } from 'lucide-solid';
import { onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { PaperDoc, PaperPointerEventDetail } from '../../paper/types.js';

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
  let localPoints: [number, number][] = [];

  function onPointerDown(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive()) return;
    e.stopPropagation();

    const { viewport, x, y } = e.detail;
    const pt = viewport.screenToCanvas(x, y);
    dragShapeId = crypto.randomUUID();
    localPoints = [[pt.x, pt.y]];

    props.handle.change((d) => {
      d.shapes[dragShapeId!] = {
        id: dragShapeId!,
        type: 'line',
        x: pt.x,
        y: pt.y,
        points: [[pt.x, pt.y]],
        stroke: '#475569',
        strokeWidth: 2,
        zIndex: Object.keys(d.shapes).length,
      };
    });
  }

  function onPointerMove(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive() || !dragShapeId) return;
    e.stopPropagation();

    const { viewport, x, y } = e.detail;
    const pt = viewport.screenToCanvas(x, y);
    localPoints.push([pt.x, pt.y]);

    props.handle.change((d) => {
      const s = d.shapes[dragShapeId!];
      if (!s) return;
      (s as any).points.push([pt.x, pt.y]);
      s.x = Math.min(s.x, pt.x);
      s.y = Math.min(s.y, pt.y);
    });
  }

  function onPointerUp(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive()) return;
    if (dragShapeId) e.stopPropagation();

    if (dragShapeId && localPoints.length < 3) {
      props.handle.change((d) => { delete d.shapes[dragShapeId!]; });
    }

    dragShapeId = undefined;
    localPoints = [];
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
