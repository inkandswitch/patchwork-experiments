import type { DocHandle } from '@automerge/automerge-repo';
import { render } from 'solid-js/web';
import { PanelLayout } from './panel-layout.js';
import type { PaperDoc } from './types.js';
import { ViewportUI } from './viewport.js';

// ─── Entry point (called by the plugin loader) ────────────────────────────────

export default function paperTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(
    () => (
      <div style="position:relative;width:100%;height:100%;">
        <ViewportUI handle={handle} />
        <PanelLayout handle={handle} />
      </div>
    ),
    element,
  );
}
