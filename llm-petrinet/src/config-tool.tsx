import { render } from 'solid-js/web';
import { createSignal, For, Show } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';

import type { LLMPetriNetDoc } from './types';
import { DEFAULT_OPTIMIZER_SYSTEM_PROMPT, DEFAULT_EVALUATOR_SYSTEM_PROMPT } from './net';
import './index.css';

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

function autoResize(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// ─── Config view ──────────────────────────────────────────────────────────────

function LLMPetriNetConfig({ handle }: { handle: DocHandle<LLMPetriNetDoc> }) {
  const [doc] = useDocument<LLMPetriNetDoc>(() => handle.url);
  const [activeTab, setActiveTab] = createSignal<'optimizer' | 'evaluators'>('optimizer');

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
      </div>

      <div class="p3n-config-body">
        <Show when={doc()}>
          {(currentDoc) => (
            <Show
              when={activeTab() === 'optimizer'}
              fallback={
                <>
                  <SystemPromptCard
                    value={currentDoc().systemPrompts?.evaluator ?? DEFAULT_EVALUATOR_SYSTEM_PROMPT}
                    variables="$PROMPT, $SOLUTION_URLS, $TARGET_URL"
                    onChange={(val) => {
                      handle.change((d) => {
                        if (!d.systemPrompts) d.systemPrompts = {};
                        d.systemPrompts.evaluator = val;
                      });
                    }}
                  />
                  <TokenList
                    label="Evaluator"
                    tokens={(currentDoc().tokens?.evaluators ?? []) as Token[]}
                    color="#d97706"
                    addLabel="Add evaluator"
                    onAdd={() => {
                      handle.change((d) => {
                        if (!d.tokens.evaluators) d.tokens.evaluators = [];
                        d.tokens.evaluators.push({
                          id: makeId(),
                          state: { type: 'evaluator', prompt: 'Favour the version that introduces the most chilling new revelation or casts suspicion onto a fresh suspect.', documentUrl: '' },
                        });
                      });
                    }}
                    onUpdatePrompt={(idx, prompt) => {
                      handle.change((d) => {
                        const t = d.tokens.evaluators?.[idx];
                        if (t) t.state.prompt = prompt;
                      });
                    }}
                    onDelete={(idx) => {
                      handle.change((d) => {
                        d.tokens.evaluators?.splice(idx, 1);
                      });
                    }}
                  />
                </>
              }
            >
              <>
                <SystemPromptCard
                  value={currentDoc().systemPrompts?.optimizer ?? DEFAULT_OPTIMIZER_SYSTEM_PROMPT}
                  variables="$PROMPT, $DOC_URL"
                  onChange={(val) => {
                    handle.change((d) => {
                      if (!d.systemPrompts) d.systemPrompts = {};
                      d.systemPrompts.optimizer = val;
                    });
                  }}
                />
                <TokenList
                  label="Optimizer"
                  tokens={(currentDoc().tokens?.optimizer ?? []) as Token[]}
                  color="#0891b2"
                  addLabel="Add optimizer"
                  onAdd={() => {
                    handle.change((d) => {
                      if (!d.tokens.optimizer) d.tokens.optimizer = [];
                      d.tokens.optimizer.push({
                        id: makeId(),
                        state: { type: 'optimizer', prompt: 'The nervous butler who discovered the body and is hiding something.', documentUrl: '' },
                      });
                    });
                  }}
                  onUpdatePrompt={(idx, prompt) => {
                    handle.change((d) => {
                      const t = d.tokens.optimizer?.[idx];
                      if (t) t.state.prompt = prompt;
                    });
                  }}
                  onDelete={(idx) => {
                    handle.change((d) => {
                      d.tokens.optimizer?.splice(idx, 1);
                    });
                  }}
                />
              </>
            </Show>
          )}
        </Show>
      </div>
    </div>
  );
}

// ─── System prompt card ───────────────────────────────────────────────────────

function SystemPromptCard(props: { value: string; variables: string; onChange: (val: string) => void }) {
  return (
    <div class="p3n-system-prompt-card">
      <div class="p3n-system-prompt-header">
        <span class="p3n-system-prompt-label">System Prompt</span>
        <span class="p3n-system-prompt-hint">
          Variables: <code>{props.variables}</code>
        </span>
      </div>
      <textarea
        class="p3n-system-prompt-textarea"
        value={props.value}
        ref={(el) => requestAnimationFrame(() => autoResize(el))}
        onInput={(e) => {
          autoResize(e.currentTarget);
          props.onChange(e.currentTarget.value);
        }}
      />
    </div>
  );
}

// ─── Token list ───────────────────────────────────────────────────────────────

type Token = { id: string; state: { type: string; prompt: string; documentUrl: string; [key: string]: string } };

function TokenList(props: {
  label: string;
  tokens: Token[];
  color: string;
  addLabel: string;
  onAdd: () => void;
  onUpdatePrompt: (idx: number, prompt: string) => void;
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
              <button
                class="p3n-token-delete-btn"
                onClick={() => props.onDelete(idx())}
                title="Remove"
              >
                ✕
              </button>
            </div>
            <textarea
              class="p3n-token-prompt"
              value={token.state.prompt ?? ''}
              ref={(el) => requestAnimationFrame(() => autoResize(el))}
              onInput={(e) => {
                autoResize(e.currentTarget);
                props.onUpdatePrompt(idx(), e.currentTarget.value);
              }}
              placeholder="Character description, motivation, secret…"
            />
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
