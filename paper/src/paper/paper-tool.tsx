import type { DocHandle } from '@automerge/automerge-repo';
import { render } from 'solid-js/web';
import { PanelLayout } from './panel-layout.js';
import type { PaperDoc } from './types.js';
import { ViewportUI } from './viewport.js';

export default function paperTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <PaperToolUI handle={handle} />, element);
}

// ─── Paper Tool UI ────────────────────────────────────────────────────────────

function PaperToolUI(props: { handle: DocHandle<PaperDoc> }) {
  return (
    <div data-paper-tool style="position:relative;width:100%;height:100%;">
      <ViewportUI handle={props.handle} />
      <PanelLayout handle={props.handle} />
    </div>
  );
}
