import type { DocHandle } from '@automerge/automerge-repo';
import { makeDocumentProjection } from '@automerge/automerge-repo-solid-primitives';
import { getRegistry } from '@inkandswitch/patchwork-plugins';
import type { Plugin, ToolDescription } from '@inkandswitch/patchwork-plugins';
import { For, createMemo } from 'solid-js';
import { render } from 'solid-js/web';
import type { PaperDoc } from '../../paper/types.js';
import './tool-panel.css';

// ─── Entry point ──────────────────────────────────────────────────────────────

function paperToolPanelTool(handle: DocHandle<PaperDoc>, element: HTMLElement): () => void {
  return render(() => <ToolPanelUI handle={handle} />, element);
}

// ─── Tool Panel UI ────────────────────────────────────────────────────────────

function ToolPanelUI(props: { handle: DocHandle<PaperDoc> }) {
  const doc = makeDocumentProjection<PaperDoc>(props.handle);

  const contactUrl = () => (window as any).accountDocHandle?.doc()?.contactUrl as string | undefined;

  const tools = createMemo(() =>
    getRegistry<ToolDescription>('patchwork:tool')
      .all()
      .filter((t) => (t as any).tags?.includes('paper-tool-button')),
  );

  const selectedTool = () => {
    const url = contactUrl();
    return url ? doc.userState?.[url]?.selectedTool : undefined;
  };

  function selectTool(toolId: string) {
    const url = contactUrl();
    if (!url) return;
    props.handle.change((d) => {
      if (!d.userState) d.userState = {};
      if (!d.userState[url]) d.userState[url] = {};
      d.userState[url].selectedTool = d.userState[url].selectedTool === toolId ? undefined : toolId;
    });
  }

  return (
    <div class="paper-tool-panel">
      <For each={tools()}>
        {(tool) => {
          const drawToolId = () => (tool as any).toolId as string ?? tool.id;
          return (
            <button
              class={`paper-tool-btn${selectedTool() === drawToolId() ? ' paper-tool-btn--active' : ''}`}
              title={tool.name}
              onClick={() => selectTool(drawToolId())}
            >
              <patchwork-view
                attr:doc-url={props.handle.url}
                attr:tool-id={tool.id}
              />
            </button>
          );
        }}
      </For>
    </div>
  );
}

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const plugins: Plugin<any>[] = [
  {
    type: 'patchwork:tool' as const,
    id: 'paper-tool-panel',
    name: 'Tool Panel',
    unlisted: true,
    supportedDatatypes: ['paper'],
    async load() {
      return paperToolPanelTool;
    },
  },
];
