import type { DocHandle } from '@automerge/automerge-repo';
import { makeDocumentProjection } from '@automerge/automerge-repo-solid-primitives';
import type { Plugin } from '@inkandswitch/patchwork-plugins';
import { createMemo } from 'solid-js';
import { render } from 'solid-js/web';
import type { PaperDoc } from '../../paper/types.js';
import './panel.css';

// ─── Entry point ──────────────────────────────────────────────────────────────

function paperPanelTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <PanelUI handle={handle} />, element);
}

// ─── Panel UI ─────────────────────────────────────────────────────────────────

function PanelUI(props: { handle: DocHandle<PaperDoc> }) {
  const doc = makeDocumentProjection<PaperDoc>(props.handle);

  const shapeCount = createMemo(() => Object.keys(doc.shapes ?? {}).length);
  const panelCount = createMemo(() => (doc.panels ?? []).length);

  return (
    <div class="paper-panel">
      <div class="paper-panel__title">{doc.title ?? 'Paper'}</div>
      <div class="paper-panel__row">
        <span class="paper-panel__label">Shapes</span>
        <span class="paper-panel__value">{shapeCount()}</span>
      </div>
      <div class="paper-panel__row">
        <span class="paper-panel__label">Panels</span>
        <span class="paper-panel__value">{panelCount()}</span>
      </div>
    </div>
  );
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool' as const,
    id: 'paper-panel',
    name: 'Paper Panel',
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return paperPanelTool;
    },
  },
];
