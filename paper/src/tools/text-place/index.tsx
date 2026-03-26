import type { DocHandle } from '@automerge/automerge-repo';
import { makeDocumentProjection } from '@automerge/automerge-repo-solid-primitives';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { Type } from 'lucide-solid';
import { onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { getPaperViewport } from '../../paper/get-paper-viewport.js';
import type { PaperDoc, PaperPointerEventDetail } from '../../paper/types.js';

const TOOL_ID = 'paper-text-place';

// ─── Button entry point ───────────────────────────────────────────────────────

function textButtonTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <TextButtonUI handle={handle} element={element} />, element);
}

// ─── Button UI ────────────────────────────────────────────────────────────────

function TextButtonUI(props: { handle: DocHandle<PaperDoc>; element: HTMLElement }) {
  const doc = makeDocumentProjection<PaperDoc>(props.handle);
  const contactUrl = () =>
    (window as any).accountDocHandle?.doc()?.contactUrl as string | undefined;
  const isActive = () => {
    const url = contactUrl();
    return url ? doc.userState?.[url]?.selectedTool === TOOL_ID : false;
  };

  function onPointerDown(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive()) return;
    e.stopPropagation();

    const { viewport, x, y } = e.detail;
    const canvasPos = viewport.screenToCanvas(x, y);
    const id = crypto.randomUUID();

    props.handle.change((d) => {
      d.shapes[id] = {
        id,
        type: 'text',
        x: canvasPos.x,
        y: canvasPos.y,
        zIndex: Object.keys(d.shapes).length,
        text: '',
      };
    });
  }

  onMount(() => {
    const viewport = getPaperViewport(props.element);
    if (!viewport) return;
    viewport.addEventListener('paper:pointerdown', onPointerDown as EventListener);
    onCleanup(() => {
      viewport.removeEventListener('paper:pointerdown', onPointerDown as EventListener);
    });
  });

  return <Type size={16} />;
}

// ─── Plugins ──────────────────────────────────────────────────────────────────

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool' as const,
    id: TOOL_ID,
    name: 'Text',
    toolId: TOOL_ID,
    tags: ['paper-tool-button'],
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return textButtonTool;
    },
  },
];
