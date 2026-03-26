import type { DocHandle } from '@automerge/automerge-repo';
import { makeDocumentProjection } from '@automerge/automerge-repo-solid-primitives';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { For, createMemo, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import type { BaseShape, PaperDoc, Vec2, ViewportElement } from '../../paper/types.js';

const H = 12; // handle size in px — fully outside the bounding box
const MIN_SIZE = 10;

type HandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type HandleDef = {
  type: HandleType;
  cursor: string;
  top?: string;
  bottom?: string;
  left?: string;
  right?: string;
  width?: string;
  height?: string;
};

const HANDLES: HandleDef[] = [
  { type: 'nw', cursor: 'nwse-resize', top: `-${H}px`, left: `-${H}px`, width: `${H}px`, height: `${H}px` },
  { type: 'ne', cursor: 'nesw-resize', top: `-${H}px`, right: `-${H}px`, width: `${H}px`, height: `${H}px` },
  { type: 'se', cursor: 'nwse-resize', bottom: `-${H}px`, right: `-${H}px`, width: `${H}px`, height: `${H}px` },
  { type: 'sw', cursor: 'nesw-resize', bottom: `-${H}px`, left: `-${H}px`, width: `${H}px`, height: `${H}px` },
  { type: 'n', cursor: 'ns-resize', top: `-${H}px`, left: '0', right: '0', height: `${H}px` },
  { type: 's', cursor: 'ns-resize', bottom: `-${H}px`, left: '0', right: '0', height: `${H}px` },
  { type: 'w', cursor: 'ew-resize', top: '0', bottom: '0', left: `-${H}px`, width: `${H}px` },
  { type: 'e', cursor: 'ew-resize', top: '0', bottom: '0', right: `-${H}px`, width: `${H}px` },
];

type DragState = {
  shapeId: string;
  handleType: HandleType;
  pointerId: number;
  origX: number;
  origY: number;
  origW: number;
  origH: number;
  originCanvas: Vec2;
  handleEl: HTMLElement;
};

// ─── Entry point ──────────────────────────────────────────────────────────────

function resizeTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <ResizeLayer handle={handle} element={element} />, element);
}

// ─── Resize layer ─────────────────────────────────────────────────────────────

function ResizeLayer(props: { handle: DocHandle<PaperDoc>; element: HTMLElement }) {
  const doc = makeDocumentProjection<PaperDoc>(props.handle);

  const resizableShapes = createMemo(() =>
    Object.values(doc.shapes ?? {}).filter((s) => 'width' in s && 'height' in s),
  );

  let drag: DragState | null = null;

  function onPointerMove(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const viewport = drag.handleEl.closest('.paper-viewport') as ViewportElement | null;
    if (!viewport) return;
    const pos = viewport.screenToCanvas(e.clientX, e.clientY);
    const dx = pos.x - drag.originCanvas.x;
    const dy = pos.y - drag.originCanvas.y;
    const patch = computeResize(drag.handleType, drag.origX, drag.origY, drag.origW, drag.origH, dx, dy);
    props.handle.change((d) => {
      const s = d.shapes[drag!.shapeId];
      if (s) {
        s.x = patch.x;
        s.y = patch.y;
        (s as any).width = patch.width;
        (s as any).height = patch.height;
      }
    });
  }

  function onPointerUp() {
    drag = null;
  }

  onMount(() => {
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    onCleanup(() => {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
    });
  });

  return (
    <For each={resizableShapes()}>
      {(shape) => {
        const s = () => doc.shapes[shape.id] as BaseShape & { width: number; height: number };
        return (
          <div
            style={{
              position: 'absolute',
              top: '0',
              left: '0',
              transform: `translate(${s().x}px,${s().y}px)`,
              width: `${s().width}px`,
              height: `${s().height}px`,
              'pointer-events': 'none',
              'z-index': s().zIndex + 1,
            }}
          >
            <For each={HANDLES}>
              {(def) => (
                <div
                  style={handleStyle(def)}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const current = s();
                    const viewport = e.currentTarget.closest(
                      '.paper-viewport',
                    ) as ViewportElement | null;
                    if (!viewport) return;
                    const originCanvas = viewport.screenToCanvas(e.clientX, e.clientY);
                    drag = {
                      shapeId: shape.id,
                      handleType: def.type,
                      pointerId: e.pointerId,
                      origX: current.x,
                      origY: current.y,
                      origW: current.width,
                      origH: current.height,
                      originCanvas,
                      handleEl: e.currentTarget,
                    };
                  }}
                />
              )}
            </For>
          </div>
        );
      }}
    </For>
  );
}

function handleStyle(def: HandleDef): Record<string, string> {
  return {
    position: 'absolute',
    cursor: def.cursor,
    'pointer-events': 'auto',
    ...(def.top !== undefined && { top: def.top }),
    ...(def.bottom !== undefined && { bottom: def.bottom }),
    ...(def.left !== undefined && { left: def.left }),
    ...(def.right !== undefined && { right: def.right }),
    ...(def.width !== undefined && { width: def.width }),
    ...(def.height !== undefined && { height: def.height }),
  };
}

function computeResize(
  type: HandleType,
  origX: number,
  origY: number,
  origW: number,
  origH: number,
  dx: number,
  dy: number,
): { x: number; y: number; width: number; height: number } {
  let x = origX, y = origY, w = origW, h = origH;

  if (type === 'nw' || type === 'w' || type === 'sw') {
    w = origW - dx;
    if (w < MIN_SIZE) w = MIN_SIZE;
    x = origX + origW - w;
  } else if (type === 'ne' || type === 'e' || type === 'se') {
    w = Math.max(MIN_SIZE, origW + dx);
  }

  if (type === 'nw' || type === 'n' || type === 'ne') {
    h = origH - dy;
    if (h < MIN_SIZE) h = MIN_SIZE;
    y = origY + origH - h;
  } else if (type === 'sw' || type === 's' || type === 'se') {
    h = Math.max(MIN_SIZE, origH + dy);
  }

  return { x, y, width: w, height: h };
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool' as const,
    id: 'paper-resize',
    name: 'Resize',
    tags: ['paper-layer'],
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return resizeTool;
    },
  },
];
