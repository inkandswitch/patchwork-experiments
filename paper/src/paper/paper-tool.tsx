import type { DocHandle } from '@automerge/automerge-repo';
import { onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { PanelLayout } from './panel-layout.js';
import type { PaperDoc, PaperPointerEventDetail, ViewportElement } from './types.js';
import { ViewportUI } from './viewport.js';

export default function paperTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <PaperToolUI handle={handle} />, element);
}

// ─── Paper Tool UI ────────────────────────────────────────────────────────────

function PaperToolUI(props: { handle: DocHandle<PaperDoc> }) {
  let viewportEl!: ViewportElement;
  let containerEl!: HTMLDivElement;

  onMount(() => {
    for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) {
      viewportEl.addEventListener(type, (e) => delegatePointerEvent(e, viewportEl, containerEl));
    }
  });

  return (
    <div ref={containerEl} style="position:relative;width:100%;height:100%;">
      <ViewportUI handle={props.handle} onViewportMount={(el) => { viewportEl = el; }} />
      <PanelLayout handle={props.handle} />
    </div>
  );
}

// ─── Event delegation ─────────────────────────────────────────────────────────

function delegatePointerEvent(
  e: PointerEvent,
  viewport: ViewportElement,
  container: HTMLDivElement,
): void {
  const detail: PaperPointerEventDetail = {
    x: e.clientX,
    y: e.clientY,
    pointerId: e.pointerId,
    pointerType: e.pointerType,
    buttons: e.buttons,
    viewport,
  };

  const slots = container.querySelectorAll<HTMLElement>('.paper-panel-slot');

  for (const slot of slots) {
    const forwarded = new CustomEvent(topaperEventType(e.type), {
      detail,
      bubbles: true,
      cancelable: true,
    });

    let handled = false;
    const originalStop = forwarded.stopPropagation.bind(forwarded);
    forwarded.stopPropagation = () => { handled = true; originalStop(); };

    slot.dispatchEvent(forwarded);
    if (handled) return;
  }

  container.dispatchEvent(
    new CustomEvent(topaperEventType(e.type), { detail, bubbles: true, cancelable: true }),
  );
}

function topaperEventType(type: string): keyof HTMLElementEventMap {
  return `paper:${type}` as keyof HTMLElementEventMap;
}
