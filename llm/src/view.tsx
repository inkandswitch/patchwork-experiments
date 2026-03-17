import { render } from 'solid-js/web';
import { createSignal, For, Show } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';

import type { LLMDoc, OutputBlock } from './types';
import './view.css';

// ─── Entry point ──────────────────────────────────────────────────────────────

export const LLMTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <LLMView handle={handle as DocHandle<LLMDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

// ─── Main view ────────────────────────────────────────────────────────────────

export function LLMView(props: { handle: DocHandle<LLMDoc> }) {
  const [doc] = useDocument<LLMDoc>(() => props.handle.url);

  return (
    <Show
      when={doc()}
      fallback={
        <div class="llm-root">
          <div class="llm-empty">Loading…</div>
        </div>
      }
    >
      {(currentDoc) => {
        const output = () => currentDoc().output ?? [];

        return (
          <div class="llm-root">
            <div class="llm-body">
              <Show when={currentDoc().prompt}>
                <div class="llm-prompt">{currentDoc().prompt}</div>
              </Show>

              <Show
                when={output().length > 0}
                fallback={<div class="llm-thinking">Thinking…</div>}
              >
                <div class="llm-output">
                  <For each={output()}>
                    {(block) => <OutputBlockView block={block} />}
                  </For>
                  <Show when={!currentDoc().done}>
                    <div class="llm-thinking">Thinking…</div>
                  </Show>
                </div>
              </Show>
            </div>
          </div>
        );
      }}
    </Show>
  );
}

// ─── Output block ──────────────────────────────────────────────────────────────

function OutputBlockView(props: { block: OutputBlock }) {
  return (
    <Show
      when={props.block.type === 'script'}
      fallback={<div class="llm-text-block">{(props.block as Extract<OutputBlock, { type: 'text' }>).content}</div>}
    >
      <ScriptBlockView block={props.block as Extract<OutputBlock, { type: 'script' }>} />
    </Show>
  );
}

// ─── Script block ──────────────────────────────────────────────────────────────

function ScriptBlockView(props: { block: Extract<OutputBlock, { type: 'script' }> }) {
  const [open, setOpen] = createSignal(props.block.output === undefined);

  const hasCompleted = () => props.block.output !== undefined;
  const hasError = () => !!props.block.error;
  const label = () => props.block.description || 'Code';

  return (
    <div class="llm-script-block">
      <div class="llm-script-header" onClick={() => setOpen((o) => !o)}>
        <span class={`llm-script-chevron${open() ? ' open' : ''}`}>▶</span>
        <span class="llm-script-label">{label()}</span>
        <Show when={hasCompleted() && !hasError()}>
          <span class="llm-status-ok">✓</span>
        </Show>
        <Show when={hasError()}>
          <span class="llm-status-err">✗</span>
        </Show>
        <Show when={!hasCompleted()}>
          <span class="llm-status-pending">⋯</span>
        </Show>
      </div>

      <Show when={open()}>
        <div class="llm-script-body">
          <pre class="llm-code">{props.block.code}</pre>

          <Show when={hasCompleted()}>
            <div class="llm-script-result">
              <Show when={props.block.output}>
                <pre class="llm-output-text">{props.block.output}</pre>
              </Show>
              <Show when={props.block.error}>
                <pre class="llm-error-text">{props.block.error}</pre>
              </Show>
              <Show when={!props.block.output && !props.block.error}>
                <span class="llm-no-output">No output</span>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
