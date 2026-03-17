import type { DocHandle } from '@automerge/automerge-repo';
import { makeDocumentProjection } from '@automerge/automerge-repo-solid-primitives';
import { For, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { Accessor } from 'solid-js';
import { render } from 'solid-js/web';
import { getRegistry } from '@inkandswitch/patchwork-plugins';
import type { ToolDescription } from '@inkandswitch/patchwork-plugins';
import { rectsOverlap } from './geometry.js';
import type { BaseShape, Camera, PaperDoc, PaperPointerEventDetail, Rect, ViewportElement } from './types.js';
import './viewport.css';

// ─── Entry point (called by the plugin loader) ────────────────────────────────

export default function paperViewport(
  handle: DocHandle<PaperDoc>,
  element: HTMLElement,
): () => void {
  return render(() => <ViewportUI handle={handle} />, element);
}

// ─── Viewport UI ──────────────────────────────────────────────────────────────

export function ViewportUI(props: {
  handle: DocHandle<PaperDoc>;
  onViewportMount?: (el: ViewportElement) => void;
}) {
  const doc = makeDocumentProjection<PaperDoc>(props.handle);
  const [camera, setCamera] = createSignal<Camera>({ x: 0, y: 0, z: 1 });

  let canvasEl!: HTMLDivElement;
  let sceneEl!: HTMLDivElement;

  const bboxIndex = new Map<string, Rect>();

  // One shared observer for all shape elements — far cheaper than one per shape.
  // Each element carries its shape id in dataset.shapeId for O(1) lookup here.
  const shapeResizeObserver = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const el = entry.target as HTMLElement;
      const id = el.dataset.shapeId;
      if (!id) continue;
      const prev = bboxIndex.get(id);
      bboxIndex.set(id, { x: prev?.x ?? 0, y: prev?.y ?? 0, w: el.offsetWidth, h: el.offsetHeight });
    }
  });

  onCleanup(() => shapeResizeObserver.disconnect());

  // All registered paper-layer tools
  const layers = createMemo(() =>
    getRegistry<ToolDescription>('patchwork:tool')
      .all()
      .filter((t) => (t as { tags?: string[] }).tags?.includes('paper-layer')),
  );

  // Sorted shape IDs by zIndex
  const sortedIds = createMemo(() => {
    const shapes = doc.shapes ?? {};
    return Object.keys(shapes).sort((a, b) => (shapes[a]?.zIndex ?? 0) - (shapes[b]?.zIndex ?? 0));
  });

  // Apply camera transform directly to DOM — never triggers re-renders
  createEffect(() => {
    const { x, y, z } = camera();
    sceneEl.style.setProperty(
      'transform',
      `scale(${+z.toFixed(4)}) translate(${+x.toFixed(4)}px, ${+y.toFixed(4)}px)`,
    );
    sceneEl.style.setProperty('--paper-zoom', String(z));
  });

  // ── Pan / zoom ──────────────────────────────────────────────────────────────

  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    const { dx, dy } = normalizeWheelDelta(e);

    if (e.ctrlKey || e.metaKey) {
      const rect = canvasEl.getBoundingClientRect();
      const pointerX = e.clientX - rect.left;
      const pointerY = e.clientY - rect.top;
      const { x, y, z } = camera();

      const zoomFactor = 1 - dy * 0.01;
      const nextZ = Math.max(0.05, Math.min(20, z * zoomFactor));

      // Keep the world point under the pointer fixed
      const wx = pointerX / z - x;
      const wy = pointerY / z - y;
      setCamera({ x: pointerX / nextZ - wx, y: pointerY / nextZ - wy, z: nextZ });
    } else {
      const { z } = camera();
      setCamera((c) => ({ ...c, x: c.x - dx / z, y: c.y - dy / z }));
    }
  }

  // ── Pointer drag pan ───────────────────────────────────────────────────────

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function dispatchPaperPointerEvent(e: PointerEvent) {
    const detail: PaperPointerEventDetail = {
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      buttons: e.buttons,
      viewport: canvasEl as ViewportElement,
    };
    canvasEl.dispatchEvent(
      new CustomEvent(`paper:${e.type}` as keyof HTMLElementEventMap, {
        detail,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  function handlePointerDown(e: PointerEvent) {
    dispatchPaperPointerEvent(e);
    if (e.button === 1 || e.button === 0) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvasEl.setPointerCapture(e.pointerId);
      canvasEl.style.cursor = 'grabbing';
    }
  }

  function handlePointerMove(e: PointerEvent) {
    dispatchPaperPointerEvent(e);
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const { z } = camera();
    setCamera((c) => ({ ...c, x: c.x + dx / z, y: c.y + dy / z }));
  }

  function handlePointerUp(e: PointerEvent) {
    dispatchPaperPointerEvent(e);
    if (dragging) {
      dragging = false;
      canvasEl.releasePointerCapture(e.pointerId);
      canvasEl.style.cursor = 'default';
    }
  }

  // ── Event listeners scoped to the viewport element ─────────────────────────

  onMount(() => {
    const viewport = canvasEl as ViewportElement;

    viewport.getShapesInRect = (rect) => {
      const shapes = doc.shapes ?? {};
      return Object.values(shapes).filter((s) => {
        const bbox = bboxIndex.get(s.id);
        return bbox != null && rectsOverlap(bbox, rect);
      });
    };

    viewport.screenToCanvas = (x, y) => {
      const rect = canvasEl.getBoundingClientRect();
      const { x: camX, y: camY, z } = camera();
      return { x: (x - rect.left) / z - camX, y: (y - rect.top) / z - camY };
    };

    viewport.getCamera = () => camera();

    props.onViewportMount?.(viewport);

    // Wheel: must be non-passive to call preventDefault()
    canvasEl.addEventListener('wheel', handleWheel, { passive: false });

    // Keyboard: only fires when the viewport has focus (tabIndex={0})
    const blockKeys = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && ['=', '-', '0'].includes(e.key)) {
        e.preventDefault();
      }
    };
    canvasEl.addEventListener('keydown', blockKeys);

    // Safari gesture events — scoped to viewport
    const blockGesture = (e: Event) => e.preventDefault();
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
      canvasEl.addEventListener(type, blockGesture, { passive: false });
    }

    // Suppress touch events — use only pointer events
    const blockTouch = (e: TouchEvent) => e.preventDefault();
    canvasEl.addEventListener('touchstart', blockTouch, { passive: false });
    canvasEl.addEventListener('touchend', blockTouch, { passive: false });

    onCleanup(() => {
      canvasEl.removeEventListener('wheel', handleWheel);
      canvasEl.removeEventListener('keydown', blockKeys);
      for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
        canvasEl.removeEventListener(type, blockGesture);
      }
      canvasEl.removeEventListener('touchstart', blockTouch);
      canvasEl.removeEventListener('touchend', blockTouch);
    });
  });

  return (
    <div
      ref={canvasEl}
      class="paper-viewport"
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <div ref={sceneEl} class="paper-scene">
        <For each={layers()}>
          {(desc) => (
            <patchwork-view
              class="paper-layer"
              attr:doc-url={props.handle.url}
              attr:tool-id={desc.id}
            />
          )}
        </For>
        <For each={sortedIds()}>
          {(id) => {
            let shapeEl: HTMLElement | undefined;

            createEffect(() => {
              const s = doc.shapes?.[id] as BaseShape;
              if (!s) return;
              const prev = bboxIndex.get(id);
              bboxIndex.set(id, { x: s.x, y: s.y, w: prev?.w ?? 0, h: prev?.h ?? 0 });
            });

            onCleanup(() => {
              if (shapeEl) shapeResizeObserver.unobserve(shapeEl);
              bboxIndex.delete(id);
            });

            return (
              <ShapeNode
                refUrl={props.handle.ref('shapes', id).url}
                shape={() => doc.shapes?.[id] as BaseShape}
                onElement={(el) => {
                  shapeEl = el;
                  el.dataset.shapeId = id;
                  shapeResizeObserver.observe(el);
                }}
              />
            );
          }}
        </For>
      </div>
    </div>
  );
}

// ─── Shape node ───────────────────────────────────────────────────────────────

function ShapeNode(props: {
  shape: Accessor<BaseShape>;
  refUrl: string;
  onElement: (el: HTMLElement) => void;
}) {
  let el!: HTMLElement;

  onMount(() => {
    el.style.setProperty('position', 'absolute');
    el.style.setProperty('transform-origin', 'top left');
    props.onElement(el);
  });

  createEffect(() => {
    const s = props.shape();
    if (!s) return;
    el.style.setProperty('transform', `translate(${s.x.toFixed(4)}px, ${s.y.toFixed(4)}px)`);
    el.style.setProperty('z-index', String(s.zIndex));
  });

  return <patchwork-ref-view ref={el} ref-url={props.refUrl} />;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function normalizeWheelDelta(e: WheelEvent): { dx: number; dy: number } {
  let dx = e.deltaX;
  let dy = e.deltaY;

  if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) {
    dx *= 16;
    dy *= 16;
  } else if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
    dx *= window.innerWidth;
    dy *= window.innerHeight;
  }

  if (e.shiftKey && !/Mac/.test(navigator.platform)) {
    [dx, dy] = [dy, dx];
  }

  if (e.ctrlKey || e.metaKey) {
    const MAX_STEP = 10;
    dy = Math.max(-MAX_STEP, Math.min(MAX_STEP, dy));
  }

  return { dx, dy };
}
