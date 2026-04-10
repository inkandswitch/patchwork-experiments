import { render } from 'solid-js/web';
import { createSignal, Show, For } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';

import type { PetriNetPlanDoc, InitialToken, SystemPromptUrls } from './types';
import type { NetDef, NetState } from './lib';
import { usePetriNetPlan } from './use-petrinet-plan';
import { P3NetRenderer } from './renderer';
import { TokenCard, getInitialTokensByType } from './components';
import './petrinet-plan.css';

type Tab = 'tokens' | 'petrinet';

export const PetriNetPlanTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PlanView handle={handle as DocHandle<PetriNetPlanDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

function PlanView({ handle }: { handle: DocHandle<PetriNetPlanDoc> }) {
  const [doc] = useDocument<PetriNetPlanDoc>(() => handle.url);
  const { net } = usePetriNetPlan(handle);
  const [selectedTab, setSelectedTab] = createSignal<Tab>('petrinet');

  function handlePromptChange(index: number, newPrompt: string) {
    handle.change((d) => {
      if (d.initialTokens && d.initialTokens[index]) {
        (d.initialTokens[index].state as Record<string, unknown>).prompt = newPrompt;
      }
    });
  }

  function getTokenTypesInPlan(def: NetDef | undefined, initialTokens: InitialToken[] | undefined) {
    if (!def || !initialTokens) return [];
    const typesInPlan = new Set<string>();
    for (const t of initialTokens) {
      typesInPlan.add(t.state.type);
    }
    return def.tokenTypes.filter((tt) => typesInPlan.has(tt.id));
  }

  return (
    <div class="p3n-sim-root">
      <div class="p3n-tab-bar">
        <button
          class="p3n-tab"
          classList={{ active: selectedTab() === 'petrinet' }}
          onClick={() => setSelectedTab('petrinet')}
        >
          Petrinet
        </button>
        <button
          class="p3n-tab"
          classList={{ active: selectedTab() === 'tokens' }}
          onClick={() => setSelectedTab('tokens')}
        >
          Tokens
        </button>
      </div>

      <div class="p3n-tab-content">
        <Show when={net() && doc()} fallback={<div class="p3n-loading">Loading plan…</div>}>
          {(_) => {
            const currentDoc = () => doc()!;
            const currentNet = () => net()!;
            const initialTokens = () => currentDoc().initialTokens ?? [];
            const tokenTypes = () => getTokenTypesInPlan(currentNet().def, initialTokens());
            const systemPromptUrls = () => currentDoc().systemPromptUrls;

            const planTokens = (): NetState => {
              const result: NetState = {};
              const tokens = initialTokens();
              for (let i = 0; i < tokens.length; i++) {
                const t = tokens[i];
                if (!result[t.placeId]) result[t.placeId] = [];
                result[t.placeId].push({ id: `plan-${i}`, state: t.state });
              }
              return result;
            };

            return (
              <>
                <Show when={selectedTab() === 'petrinet'}>
                  <div class="p3n-petrinet-wrap">
                    <P3NetRenderer
                      def={currentNet().def}
                      tokens={planTokens()}
                      selectedTokenId={null}
                      onSelectToken={() => {}}
                      onDropOnPlace={() => {}}
                    />
                  </div>
                </Show>

                <Show when={selectedTab() === 'tokens'}>
                  <div class="p3n-token-sections">
                    <For each={tokenTypes()}>
                      {(tokenType) => {
                        const tokensOfType = () => getInitialTokensByType(initialTokens(), tokenType.id);
                        const systemPromptUrl = () => getSystemPromptUrl(systemPromptUrls(), tokenType.id);
                        return (
                          <div class="p3n-token-section">
                            <div class="p3n-token-section-header">
                              <span class="p3n-token-section-dot" style={{ background: tokenType.color }} />
                              <span class="p3n-token-section-title">{tokenType.label}</span>
                              <span class="p3n-token-section-count">{tokensOfType().length}</span>
                            </div>
                            <Show when={systemPromptUrl()}>
                              {(url) => (
                                <SystemPromptCard
                                  url={url()}
                                  label={`${tokenType.label} System Prompt`}
                                  tokenTypeId={tokenType.id}
                                />
                              )}
                            </Show>
                            <div class="p3n-token-section-content">
                              <Show
                                when={tokensOfType().length > 0}
                                fallback={
                                  <div class="p3n-token-empty-hint">
                                    No {tokenType.label.toLowerCase()} tokens
                                  </div>
                                }
                              >
                                <For each={tokensOfType()}>
                                  {({ token, placeId }) => {
                                    const globalIdx = () =>
                                      initialTokens().findIndex(
                                        (t) => t.placeId === placeId && t.state === token.state,
                                      );
                                    return (
                                      <TokenCard
                                        token={token}
                                        placeId={placeId}
                                        def={currentNet().def}
                                        showHeader={false}
                                        onPromptChange={(newPrompt) => {
                                          const i = globalIdx();
                                          if (i >= 0) handlePromptChange(i, newPrompt);
                                        }}
                                      />
                                    );
                                  }}
                                </For>
                              </Show>
                            </div>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </Show>
              </>
            );
          }}
        </Show>
      </div>
    </div>
  );
}

function getSystemPromptUrl(urls: SystemPromptUrls | undefined, tokenTypeId: string): string | undefined {
  if (!urls) return undefined;
  if (tokenTypeId === 'optimizer') return urls.optimizer;
  return undefined;
}

const TEMPLATE_VARS: Record<string, string[]> = {
  optimizer: ['$PROMPT', '$DOC_URL', '$SPEC_URL'],
};

function SystemPromptCard(props: { url: string; label: string; tokenTypeId: string }) {
  const vars = () => TEMPLATE_VARS[props.tokenTypeId] ?? [];
  return (
    <div class="p3n-system-prompt-card">
      <div class="p3n-system-prompt-header">
        <span class="p3n-system-prompt-label">{props.label}</span>
        <Show when={vars().length > 0}>
          <span class="p3n-system-prompt-hint">
            Variables: <For each={vars()}>{(v) => <><code>{v}</code>{' '}</>}</For>
          </span>
        </Show>
      </div>
      <patchwork-view attr:doc-url={props.url} style="display:block;width:100%;min-height:120px;" />
    </div>
  );
}
