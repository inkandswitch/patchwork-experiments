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

  onMount(() => {
    for (const type of ['paper:pointerdown', 'paper:pointermove', 'paper:pointerup'] as const) {
      viewportEl.addEventListener(type, (e) => delegatePointerEvent(e, viewportEl));
    }
  });

  return (
    <div style="position:relative;width:100%;height:100%;">
      <ViewportUI handle={props.handle} onViewportMount={(el) => { viewportEl = el; }} />
      <PanelLayout handle={props.handle} />
    </div>
  );
}

// ─── Event delegation ─────────────────────────────────────────────────────────

function delegatePointerEvent(
  e: CustomEvent<PaperPointerEventDetail>,
  viewport: ViewportElement,
): void {
  const container = viewport.parentElement;
  const targets = [
    ...container?.querySelectorAll<HTMLElement>('.paper-panel-slot') ?? [],
    ...viewport.querySelectorAll<HTMLElement>('.paper-layer'),
  ];

  for (const target of targets) {
    const forwarded = new CustomEvent(e.type, {
      detail: e.detail,
      bubbles: true,
      cancelable: true,
    });

    let handled = false;
    const originalStop = forwarded.stopPropagation.bind(forwarded);
    forwarded.stopPropagation = () => { handled = true; originalStop(); };

    target.dispatchEvent(forwarded);
    if (handled) return;
  }
}
