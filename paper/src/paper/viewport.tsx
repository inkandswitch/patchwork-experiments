import type { DocHandle, Ref } from '@automerge/automerge-repo';
import { makeDocumentProjection } from '@automerge/automerge-repo-solid-primitives';
import { For, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { Accessor } from 'solid-js';
import { render } from 'solid-js/web';
import type { BaseShape, Camera, PaperDoc } from './types.js';
import './viewport.css';

// ─── Entry point (called by the plugin loader) ────────────────────────────────

export default function paperViewport(
  handle: DocHandle<PaperDoc>,
  element: HTMLElement,
): () => void {
  return render(() => <ViewportUI handle={handle} />, element);
}

// ─── Viewport UI ──────────────────────────────────────────────────────────────

function ViewportUI(props: { handle: DocHandle<PaperDoc> }) {
  const doc = makeDocumentProjection<PaperDoc>(props.handle);
  const [camera, setCamera] = createSignal<Camera>({ x: 0, y: 0, z: 1 });

  let canvasEl!: HTMLDivElement;
  let sceneEl!: HTMLDivElement;

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

  function handlePointerDown(e: PointerEvent) {
    if (e.button === 1 || e.button === 0) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvasEl.setPointerCapture(e.pointerId);
      canvasEl.style.cursor = 'grabbing';
    }
  }

  function handlePointerMove(e: PointerEvent) {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    const { z } = camera();
    setCamera((c) => ({ ...c, x: c.x + dx / z, y: c.y + dy / z }));
  }

  function handlePointerUp(e: PointerEvent) {
    if (dragging) {
      dragging = false;
      canvasEl.releasePointerCapture(e.pointerId);
      canvasEl.style.cursor = 'default';
    }
  }

  // ── Event listeners scoped to the viewport element ─────────────────────────

  onMount(() => {
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
        <For each={sortedIds()}>
          {(id) => (
            <ShapeNode
              refUrl={props.handle.ref('shapes', id).url}
              shape={() => doc.shapes?.[id] as BaseShape}
            />
          )}
        </For>
      </div>
    </div>
  );
}

// ─── Shape node ───────────────────────────────────────────────────────────────

function ShapeNode(props: { shape: Accessor<BaseShape>; refUrl: string }) {
  let el!: HTMLElement;

  onMount(() => {
    el.style.setProperty('position', 'absolute');
    el.style.setProperty('transform-origin', 'top left');
  });

  createEffect(() => {
    const s = props.shape();
    if (!s) return;
    const x = s.x.toFixed(4);
    const y = s.y.toFixed(4);
    el.style.setProperty('transform', `translate(${x}px, ${y}px)`);
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
