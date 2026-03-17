import type { DocHandle } from '@automerge/automerge-repo';
import { onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { PanelLayout } from './panel-layout.js';
import type { PaperDoc, ViewportElement } from './types.js';
import { ViewportUI } from './viewport.js';

export default function paperTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <PaperToolUI handle={handle} />, element);
}

// ─── Paper Tool UI ────────────────────────────────────────────────────────────

function PaperToolUI(props: { handle: DocHandle<PaperDoc> }) {
  let viewportEl!: ViewportElement;

  onMount(() => {
    const types = [
      'paper:pointerdown',
      'paper:pointermove',
      'paper:pointerup',
      'paper:dragover',
      'paper:dragenter',
      'paper:dragleave',
      'paper:drop',
    ] as const;

    for (const type of types) {
      viewportEl.addEventListener(type, (e) => {
        // Only handle events dispatched directly on the viewport, not
        // events that have already been forwarded to a panel-slot or layer and bubbled back.
        if (e.target !== viewportEl) return;
        delegateCanvasEvent(e, viewportEl);
      });
    }
  });

  return (
    <div style="position:relative;width:100%;height:100%;">
      <ViewportUI
        handle={props.handle}
        ref={(el) => {
          viewportEl = el;
        }}
      />
      <PanelLayout handle={props.handle} />
    </div>
  );
}

// ─── Event delegation ─────────────────────────────────────────────────────────
//
// Dispatch order: panel slots first, then paper-layer elements.
// Any target can call stopPropagation() to claim the event and stop further dispatch.

function delegateCanvasEvent(e: CustomEvent, viewport: ViewportElement): void {
  const panelSlots = Array.from(
    viewport.parentElement?.querySelectorAll<HTMLElement>('.paper-panel-slot') ?? [],
  );
  const layers = Array.from(viewport.querySelectorAll<HTMLElement>('.paper-layer'));

  for (const target of [...panelSlots, ...layers]) {
    const forwarded = new CustomEvent(e.type, {
      detail: e.detail,
      bubbles: true,
      cancelable: true,
    });

    let handled = false;
    const originalStop = forwarded.stopPropagation.bind(forwarded);
    forwarded.stopPropagation = () => {
      handled = true;
      originalStop();
    };

    target.dispatchEvent(forwarded);
    if (handled) return;
  }
}
