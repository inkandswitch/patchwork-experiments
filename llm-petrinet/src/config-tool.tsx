import { render } from 'solid-js/web';
import { createEffect, createSignal, For, Show, useContext } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';

import type { LLMPetriNetDoc } from './types';
import {
  DEFAULT_OPTIMIZER_SYSTEM_PROMPT,
  DEFAULT_EVALUATOR_SYSTEM_PROMPT,
  DEFAULT_OPTIMIZER_PROMPT,
  DEFAULT_EVALUATOR_PROMPT,
  createMarkdownDoc,
} from './net';
import './index.css';

// ─── Token type ───────────────────────────────────────────────────────────────

type DocToken = { id: string; state: { type: string; documentUrl: string } };

// ─── Entry point ──────────────────────────────────────────────────────────────

export const LLMPetriNetConfigTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <LLMPetriNetConfig handle={handle as DocHandle<LLMPetriNetDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Config view ──────────────────────────────────────────────────────────────

function LLMPetriNetConfig({ handle }: { handle: DocHandle<LLMPetriNetDoc> }) {
  const repo = useContext(RepoContext);
  const [doc] = useDocument<LLMPetriNetDoc>(() => handle.url);
  const [activeTab, setActiveTab] = createSignal<'optimizer' | 'evaluators' | 'problem'>('optimizer');

  // Lazily create system prompt docs for old docs that only have inline strings
  const initializingPrompts = new Set<string>();
  createEffect(() => {
    const d = doc();
    if (!d || !repo) return;
    if (!d.systemPromptUrls?.optimizer && !initializingPrompts.has('optimizer')) {
      initializingPrompts.add('optimizer');
      const content = d.systemPrompts?.optimizer ?? DEFAULT_OPTIMIZER_SYSTEM_PROMPT;
      createMarkdownDoc(repo, content).then(({ url }) => {
        handle.change((dd) => {
          if (!dd.systemPromptUrls) dd.systemPromptUrls = {};
          if (!dd.systemPromptUrls.optimizer) dd.systemPromptUrls.optimizer = url;
        });
      }).catch(console.error);
    }
    if (!d.systemPromptUrls?.evaluator && !initializingPrompts.has('evaluator')) {
      initializingPrompts.add('evaluator');
      const content = d.systemPrompts?.evaluator ?? DEFAULT_EVALUATOR_SYSTEM_PROMPT;
      createMarkdownDoc(repo, content).then(({ url }) => {
        handle.change((dd) => {
          if (!dd.systemPromptUrls) dd.systemPromptUrls = {};
          if (!dd.systemPromptUrls.evaluator) dd.systemPromptUrls.evaluator = url;
        });
      }).catch(console.error);
    }
  });

  return (
    <div class="p3n-config-root">
      <div class="p3n-config-tabs">
        <button
          class={`p3n-config-tab${activeTab() === 'optimizer' ? ' active' : ''}`}
          onClick={() => setActiveTab('optimizer')}
        >
          Optimizer
        </button>
        <button
          class={`p3n-config-tab${activeTab() === 'evaluators' ? ' active' : ''}`}
          onClick={() => setActiveTab('evaluators')}
        >
          Evaluator
        </button>
        <button
          class={`p3n-config-tab${activeTab() === 'problem' ? ' active' : ''}`}
          onClick={() => setActiveTab('problem')}
        >
          Problem
        </button>
      </div>

      <div class="p3n-config-body">
        <Show when={doc()}>
          {(currentDoc) => (
            <>
              <Show when={activeTab() === 'optimizer'}>
                <SystemPromptView
                  url={currentDoc().systemPromptUrls?.optimizer}
                  variables="$PROMPT, $DOC_URL"
                />
                <TokenList
                  label="Optimizer"
                  tokens={(currentDoc().tokens?.optimizer ?? []) as DocToken[]}
                  color="#0891b2"
                  addLabel="Add optimizer"
                  onAdd={async () => {
                    if (!repo) return;
                    const { url } = await createMarkdownDoc(repo, DEFAULT_OPTIMIZER_PROMPT);
                    handle.change((d) => {
                      if (!d.tokens.optimizer) d.tokens.optimizer = [];
                      d.tokens.optimizer.push({ id: makeId(), state: { type: 'optimizer', documentUrl: url } });
                    });
                  }}
                  onDelete={(idx) => {
                    handle.change((d) => {
                      d.tokens.optimizer?.splice(idx, 1);
                    });
                  }}
                />
              </Show>
              <Show when={activeTab() === 'evaluators'}>
                <SystemPromptView
                  url={currentDoc().systemPromptUrls?.evaluator}
                  variables="$PROMPT, $SOLUTION_URLS, $TARGET_URL"
                />
                <TokenList
                  label="Evaluator"
                  tokens={(currentDoc().tokens?.evaluators ?? []) as DocToken[]}
                  color="#d97706"
                  addLabel="Add evaluator"
                  onAdd={async () => {
                    if (!repo) return;
                    const { url } = await createMarkdownDoc(repo, DEFAULT_EVALUATOR_PROMPT);
                    handle.change((d) => {
                      if (!d.tokens.evaluators) d.tokens.evaluators = [];
                      d.tokens.evaluators.push({ id: makeId(), state: { type: 'evaluator', documentUrl: url } });
                    });
                  }}
                  onDelete={(idx) => {
                    handle.change((d) => {
                      d.tokens.evaluators?.splice(idx, 1);
                    });
                  }}
                />
              </Show>
              <Show when={activeTab() === 'problem'}>
                <ProblemTab doc={currentDoc()} handle={handle} />
              </Show>
            </>
          )}
        </Show>
      </div>
    </div>
  );
}

// ─── Problem tab ──────────────────────────────────────────────────────────────

function ProblemTab(props: { doc: LLMPetriNetDoc; handle: DocHandle<LLMPetriNetDoc> }) {
  const [isDraggingOver, setIsDraggingOver] = createSignal(false);
  let dragCounter = 0;

  const problems = () => (props.doc.tokens?.problems ?? []) as DocToken[];

  function handleDragEnter(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('text/x-patchwork-urls')) return;
    dragCounter++;
    setIsDraggingOver(true);
  }

  function handleDragLeave() {
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; setIsDraggingOver(false); }
  }

  function handleDragOver(e: DragEvent) {
    if (e.dataTransfer?.types.includes('text/x-patchwork-urls')) e.preventDefault();
  }

  function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragCounter = 0;
    setIsDraggingOver(false);
    const data = e.dataTransfer?.getData('text/x-patchwork-urls');
    if (!data) return;
    let urls: string[];
    try { urls = JSON.parse(data); } catch { return; }
    if (!urls.length) return;
    props.handle.change((d) => {
      if (!d.tokens.problems) d.tokens.problems = [];
      for (const url of urls) {
        d.tokens.problems.push({ id: makeId(), state: { type: 'problem', documentUrl: url } });
      }
    });
  }

  return (
    <div
      class={`p3n-problem-tab${isDraggingOver() ? ' p3n-problem-tab-over' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Show when={problems().length === 0}>
        <div class="p3n-drop-hint">Drop documents here to add problems</div>
      </Show>
      <For each={problems()}>
        {(token, idx) => (
          <div class="p3n-problem-card">
            <div class="p3n-token-card-header">
              <div class="p3n-token-dot" style={{ background: '#7c3aed' }} />
              <span class="p3n-token-card-label">Problem {idx() + 1}</span>
              <div
                class="p3n-drag-handle"
                draggable={true}
                onDragStart={(e) => e.dataTransfer?.setData('text/x-patchwork-urls', JSON.stringify([token.state.documentUrl]))}
                title="Drag to open"
              >
                ⠿
              </div>
              <button
                class="p3n-token-delete-btn"
                onClick={() => props.handle.change((d) => { d.tokens.problems?.splice(idx(), 1); })}
                title="Remove"
              >
                ✕
              </button>
            </div>
            <patchwork-view doc-url={token.state.documentUrl} tool-id="codemirror-base" class="p3n-problem-view" />
          </div>
        )}
      </For>
      <Show when={problems().length > 0}>
        <div class={`p3n-drop-zone${isDraggingOver() ? ' p3n-drop-zone-active' : ''}`}>
          Drop documents here
        </div>
      </Show>
    </div>
  );
}

// ─── System prompt view ───────────────────────────────────────────────────────

function SystemPromptView(props: { url: string | undefined; variables: string }) {
  return (
    <div class="p3n-system-prompt-card">
      <div class="p3n-system-prompt-header">
        <span class="p3n-system-prompt-label">System Prompt</span>
        <span class="p3n-system-prompt-hint">
          Variables: <code>{props.variables}</code>
        </span>
      </div>
      <Show
        when={props.url}
        fallback={<div class="p3n-loading" style={{ height: '120px' }}>Initializing…</div>}
      >
        {(url) => (
          <patchwork-view doc-url={url()} tool-id="codemirror-base" class="p3n-system-prompt-view" />
        )}
      </Show>
    </div>
  );
}

// ─── Token list ───────────────────────────────────────────────────────────────

function TokenList(props: {
  label: string;
  tokens: DocToken[];
  color: string;
  addLabel: string;
  onAdd: () => void;
  onDelete: (idx: number) => void;
}) {
  return (
    <div class="p3n-token-list">
      <For each={props.tokens}>
        {(token, idx) => (
          <div class="p3n-token-card">
            <div class="p3n-token-card-header">
              <div class="p3n-token-dot" style={{ background: props.color }} />
              <span class="p3n-token-card-label">{props.label} {idx() + 1}</span>
              <div
                class="p3n-drag-handle"
                draggable={true}
                onDragStart={(e) => e.dataTransfer?.setData('text/x-patchwork-urls', JSON.stringify([token.state.documentUrl]))}
                title="Drag to open"
              >
                ⠿
              </div>
              <button
                class="p3n-token-delete-btn"
                onClick={() => props.onDelete(idx())}
                title="Remove"
              >
                ✕
              </button>
            </div>
            <patchwork-view doc-url={token.state.documentUrl} tool-id="codemirror-base" class="p3n-token-doc-view" />
          </div>
        )}
      </For>

      <Show when={props.tokens.length === 0}>
        <div class="p3n-token-empty">No {props.label.toLowerCase()} tokens. Add one below.</div>
      </Show>

      <button class="p3n-add-token-btn" onClick={props.onAdd}>
        + {props.addLabel}
      </button>
    </div>
  );
}
