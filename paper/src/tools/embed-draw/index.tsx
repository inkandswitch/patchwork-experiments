import type { DocHandle } from '@automerge/automerge-repo';
import { makeDocumentProjection } from '@automerge/automerge-repo-solid-primitives';
import {
  createDocOfDatatype2,
  getRegistry,
} from '@inkandswitch/patchwork-plugins';
import type {
  DatatypeDescription,
  LoadedDatatype,
  Plugin,
} from '@inkandswitch/patchwork-plugins';
import { LayoutGrid } from 'lucide-solid';
import { createEffect, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { getPaperViewport } from '../../paper/get-paper-viewport.js';
import type { PaperDoc, PaperPointerEventDetail, Vec2 } from '../../paper/types.js';
import { openMenu } from '../../shapes/embed/menu.js';

const TOOL_ID = 'paper-embed-draw';

// ─── Draw layer entry point ────────────────────────────────────────────────────

function embedDrawTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <EmbedDrawLayer handle={handle} element={element} />, element);
}

// ─── Draw layer ───────────────────────────────────────────────────────────────

function EmbedDrawLayer(props: { handle: DocHandle<PaperDoc>; element: HTMLElement }) {
  const doc = makeDocumentProjection<PaperDoc>(props.handle);

  const contactUrl = () => (window as any).accountDocHandle?.doc()?.contactUrl as string | undefined;
  const isActive = () => {
    const url = contactUrl();
    return url ? doc.userState?.[url]?.selectedTool === TOOL_ID : false;
  };

  let pendingDatatypeId: string | undefined;
  let dragShapeId: string | undefined;
  let startCanvas: Vec2 | undefined;
  let lastW = 1;
  let lastH = 1;
  let closeMenuFn: (() => void) | undefined;

  function openDatatypePicker() {
    closeMenuFn?.();
    const datatypes = getRegistry<DatatypeDescription>('patchwork:datatype')
      .all()
      .filter((d) => !(d as any).unlisted);
    const anchor =
      document.querySelector<HTMLElement>('.paper-tool-btn--active') ?? props.element;
    closeMenuFn = openMenu(
      anchor,
      datatypes.map((d) => ({ id: d.id, name: d.name })),
      (id) => {
        pendingDatatypeId = id;
        closeMenuFn = undefined;
      },
    );
  }

  // Open the datatype picker whenever this tool becomes active
  createEffect((prev: boolean) => {
    const active = isActive();
    if (active && !prev) {
      setTimeout(openDatatypePicker, 0);
    }
    if (!active) {
      closeMenuFn?.();
      closeMenuFn = undefined;
      pendingDatatypeId = undefined;
    }
    return active;
  }, false);

  onCleanup(() => closeMenuFn?.());

  // ── Pointer event handlers ─────────────────────────────────────────────────

  function onPointerDown(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive()) return;
    e.stopPropagation();

    if (!pendingDatatypeId) {
      setTimeout(openDatatypePicker, 0);
      return;
    }

    const { viewport, x, y } = e.detail;
    startCanvas = viewport.screenToCanvas(x, y);
    dragShapeId = crypto.randomUUID();
    lastW = 1;
    lastH = 1;
    const datatypeId = pendingDatatypeId;

    props.handle.change((d) => {
      d.shapes[dragShapeId!] = {
        id: dragShapeId!,
        type: 'embed',
        x: startCanvas!.x,
        y: startCanvas!.y,
        zIndex: Object.keys(d.shapes).length,
        docType: datatypeId,
        toolId: '',
        width: 1,
        height: 1,
      };
    });
  }

  function onPointerMove(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive() || !dragShapeId || !startCanvas) return;
    e.stopPropagation();

    const { viewport, x, y } = e.detail;
    const current = viewport.screenToCanvas(x, y);
    const rx = Math.min(startCanvas.x, current.x);
    const ry = Math.min(startCanvas.y, current.y);
    lastW = Math.max(1, Math.abs(current.x - startCanvas.x));
    lastH = Math.max(1, Math.abs(current.y - startCanvas.y));

    props.handle.change((d) => {
      const s = d.shapes[dragShapeId!];
      if (!s) return;
      s.x = rx;
      s.y = ry;
      (s as any).width = lastW;
      (s as any).height = lastH;
    });
  }

  function onPointerUp(e: CustomEvent<PaperPointerEventDetail>) {
    if (!isActive()) return;
    if (dragShapeId) e.stopPropagation();

    const id = dragShapeId;
    const datatypeId = pendingDatatypeId;
    const w = lastW;
    const h = lastH;

    dragShapeId = undefined;
    startCanvas = undefined;
    lastW = 1;
    lastH = 1;

    if (!id || !datatypeId) return;

    if (w < 4 || h < 4) {
      props.handle.change((d) => { delete d.shapes[id]; });
      return;
    }

    const url = contactUrl();
    if (url) {
      props.handle.change((d) => {
        if (d.userState?.[url]) d.userState[url].selectedTool = 'paper-select';
      });
    }

    placeEmbed(id, datatypeId);
  }

  async function placeEmbed(id: string, datatypeId: string) {
    try {
      const loaded = await getRegistry<DatatypeDescription>('patchwork:datatype').load(datatypeId) as LoadedDatatype<any> | undefined;
      if (!loaded) return;
      const docHandle = await createDocOfDatatype2(loaded, (window as any).repo);
      props.handle.change((d) => {
        const s = d.shapes[id];
        if (s) (s as any).docUrl = docHandle.url;
      });
    } catch (err) {
      console.error('[EmbedDrawLayer] failed to create doc', err);
      props.handle.change((d) => { delete d.shapes[id]; });
    }
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

function embedDrawButtonTool(_handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <LayoutGrid size={16} />, element);
}

// ─── Plugins ──────────────────────────────────────────────────────────────────

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool' as const,
    id: TOOL_ID,
    name: 'Embed',
    tags: ['paper-layer'],
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return embedDrawTool;
    },
  },
  {
    type: 'patchwork:tool' as const,
    id: `${TOOL_ID}-button`,
    name: 'Embed',
    toolId: TOOL_ID,
    tags: ['paper-tool-button'],
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return embedDrawButtonTool;
    },
  },
];
