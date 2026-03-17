import type { DocHandle } from '@automerge/automerge-repo';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { PaperDoc, PaperDragEventDetail, BaseShape } from '../../paper/types.js';

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 300;
const GAP = 20;

// ─── Entry point ──────────────────────────────────────────────────────────────

function dropHandlerTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <DropHandlerLayer handle={handle} element={element} />, element);
}

// ─── Drop handler layer ───────────────────────────────────────────────────────

function DropHandlerLayer(props: { handle: DocHandle<PaperDoc>; element: HTMLElement }) {
  onMount(() => {
    props.element.addEventListener('paper:drop', onDrop as EventListener);
  });

  function onDrop(e: CustomEvent<PaperDragEventDetail>) {
    const { canvasX, canvasY, patchworkUrls } = e.detail;
    if (!patchworkUrls || patchworkUrls.length === 0) return;

    props.handle.change((d) => {
      const maxZIndex = Object.values(d.shapes).reduce(
        (max, s) => Math.max(max, (s as BaseShape).zIndex),
        -1,
      );
      for (let i = 0; i < patchworkUrls.length; i++) {
        const id = `embed-${Date.now()}-${i}`;
        d.shapes[id] = {
          id,
          type: 'embed',
          x: canvasX + i * (DEFAULT_WIDTH + GAP),
          y: canvasY,
          width: DEFAULT_WIDTH,
          height: DEFAULT_HEIGHT,
          zIndex: maxZIndex + 1 + i,
          docUrl: patchworkUrls[i],
        };
      }
    });
  }

  return null;
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool' as const,
    id: 'paper-drop-handler',
    name: 'Drop Handler',
    tags: ['paper-layer'],
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return dropHandlerTool;
    },
  },
];
