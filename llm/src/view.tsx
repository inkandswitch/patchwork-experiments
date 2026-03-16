import { render } from 'solid-js/web';
import { createSignal, For, Show } from 'solid-js';
import { RepoContext, useDocument, useRepo } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';

import type { PetrinetLLMDoc, OutputBlock } from './types';
import { runLLMProcess } from './llm-process';
import './view.css';

// ─── Entry point ──────────────────────────────────────────────────────────────

export const PetrinetLLMTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PetrinetLLMView handle={handle as DocHandle<PetrinetLLMDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

// ─── Main view ────────────────────────────────────────────────────────────────

function PetrinetLLMView(props: { handle: DocHandle<PetrinetLLMDoc> }) {
  const [doc] = useDocument<PetrinetLLMDoc>(() => props.handle.url);
  const repo = useRepo();
  const [isRunning, setIsRunning] = createSignal(false);
  const [runError, setRunError] = createSignal<string | null>(null);
  let abortController: AbortController | null = null;

  async function handleRun() {
    if (isRunning()) return;
    const controller = new AbortController();
    abortController = controller;
    setIsRunning(true);
    setRunError(null);
    try {
      await runLLMProcess(repo, props.handle.url, controller.signal);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setRunError(err?.message ?? String(err));
      }
    } finally {
      setIsRunning(false);
      abortController = null;
    }
  }

  function handleStop() {
    abortController?.abort();
  }

  function handleClear() {
    props.handle.change((d) => {
      d.output = [];
    });
    setRunError(null);
  }

  return (
    <Show
      when={doc()}
      fallback={
        <div class="pln-root">
          <div class="pln-empty">Loading…</div>
        </div>
      }
    >
      {(currentDoc) => {
        const output = () => currentDoc().output ?? [];

        return (
          <div class="pln-root">
            <div class="pln-toolbar">
              <span class="pln-section-label">LLM Process</span>
              <span class="pln-toolbar-spacer" />
              <button
                class="pln-clear-btn"
                onClick={handleClear}
                disabled={isRunning() || output().length === 0}
              >
                Clear
              </button>
              <Show
                when={isRunning()}
                fallback={
                  <button
                    class="pln-run-btn"
                    onClick={handleRun}
                    disabled={!currentDoc().prompt}
                  >
                    Run
                  </button>
                }
              >
                <button class="pln-stop-btn" onClick={handleStop}>
                  Stop
                </button>
              </Show>
            </div>

            <div class="pln-body">
              <Show when={currentDoc().prompt}>
                <div class="pln-prompt">{currentDoc().prompt}</div>
              </Show>

              <Show
                when={output().length > 0}
                fallback={
                  <Show
                    when={isRunning()}
                    fallback={<div class="pln-empty">Press Run to start</div>}
                  >
                    <div class="pln-thinking">Thinking…</div>
                  </Show>
                }
              >
                <div class="pln-output">
                  <For each={output()}>
                    {(block) => <OutputBlockView block={block} />}
                  </For>
                  <Show when={isRunning()}>
                    <div class="pln-thinking">Thinking…</div>
                  </Show>
                </div>
              </Show>
            </div>

            <Show when={runError()}>
              {(err) => <div class="pln-run-error">{err()}</div>}
            </Show>
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
      fallback={<div class="pln-text-block">{(props.block as Extract<OutputBlock, { type: 'text' }>).content}</div>}
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
    <div class="pln-script-block">
      <div class="pln-script-header" onClick={() => setOpen((o) => !o)}>
        <span class={`pln-script-chevron${open() ? ' open' : ''}`}>▶</span>
        <span class="pln-script-label">{label()}</span>
        <Show when={hasCompleted() && !hasError()}>
          <span class="pln-status-ok">✓</span>
        </Show>
        <Show when={hasError()}>
          <span class="pln-status-err">✗</span>
        </Show>
        <Show when={!hasCompleted()}>
          <span class="pln-status-pending">⋯</span>
        </Show>
      </div>

      <Show when={open()}>
        <div class="pln-script-body">
          <pre class="pln-code">{props.block.code}</pre>

          <Show when={hasCompleted()}>
            <div class="pln-script-result">
              <Show when={props.block.output}>
                <pre class="pln-output-text">{props.block.output}</pre>
              </Show>
              <Show when={props.block.error}>
                <pre class="pln-error-text">{props.block.error}</pre>
              </Show>
              <Show when={!props.block.output && !props.block.error}>
                <span class="pln-no-output">No output</span>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </div>
  );
}
