import { render } from 'solid-js/web';
import { createSignal, createEffect, Show, For } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, Repo, AutomergeUrl } from '@automerge/automerge-repo';

import type { PetriNetPlanDoc, PetriNetExecutionDoc } from './types';
import type { TokenInstance, PendingStep, TransitionFiring, NetDef, NetState, NetDoc, PetriNet } from './lib';
import { defineNet } from './lib';
import { createNet } from './net';
import { P3NetRenderer } from './renderer';
import './petrinet-plan.css';

export const PetriNetExecutionTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <ExecutionView handle={handle as DocHandle<PetriNetExecutionDoc>} repo={element.repo} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

type AnimState = {
  hiddenIds: Set<string>;
  firings: TransitionFiring[];
  pending: PendingStep;
};

type Tab = 'petrinet' | 'candidates';

function ExecutionView({ handle, repo }: { handle: DocHandle<PetriNetExecutionDoc>; repo: Repo }) {
  const [doc] = useDocument<PetriNetExecutionDoc>(() => handle.url);
  const [planDoc] = useDocument<PetriNetPlanDoc>(() => doc()?.planUrl);
  const [selectedTab, setSelectedTab] = createSignal<Tab>('petrinet');
  const [petriNet, setPetriNet] = createSignal<PetriNet | null>(null);

  createEffect(() => {
    const d = doc();
    if (!d?.planUrl || petriNet()) return;
    repo.find<PetriNetPlanDoc>(d.planUrl).then((planHandle) => {
      const netDef = createNet(repo, planHandle);
      setPetriNet(defineNet(netDef)(handle as unknown as DocHandle<NetDoc>, repo));
    });
  });

  const net = () => {
    const pn = petriNet();
    if (!pn) return null;
    return pn;
  };

  const [selectedTokenId, setSelectedTokenId] = createSignal<string | null>(null);
  const [animState, setAnimState] = createSignal<AnimState | null>(null);
  const [isPlaying, setIsPlaying] = createSignal(false);
  let steppingRef = false;
  let playIntervalId: ReturnType<typeof setInterval> | null = null;

  async function handleStep() {
    const pn = net();
    if (!pn || steppingRef) return;
    steppingRef = true;
    try {
      const pending = await pn.prepareStep();
      if (!pending || pending.firings.length === 0) {
        steppingRef = false;
        return;
      }
      const hiddenIds = new Set(pending.firings.flatMap((f) => f.inputs.map((i) => i.id)));
      setAnimState({ hiddenIds, firings: pending.firings, pending });
    } catch (err) {
      console.error(err);
      steppingRef = false;
    }
  }

  function handlePlayPause() {
    const nowPlaying = !isPlaying();
    setIsPlaying(nowPlaying);
    if (nowPlaying) {
      playIntervalId = setInterval(() => {
        if (!steppingRef) handleStep();
      }, 100);
    } else {
      if (playIntervalId !== null) clearInterval(playIntervalId);
      playIntervalId = null;
    }
  }

  function handleAnimRemoveInputs() {
    animState()?.pending.removeInputs();
  }

  function handleAnimAddOutput(id: string) {
    animState()?.pending.addOutput(id);
  }

  function handleAnimComplete() {
    const pending = animState()?.pending;
    setAnimState(null);
    steppingRef = false;
    pending?.runSideEffects();
    if (isPlaying()) handleStep();
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
          classList={{ active: selectedTab() === 'candidates' }}
          onClick={() => setSelectedTab('candidates')}
        >
          Candidates
        </button>
        <span class="p3n-toolbar-spacer" />
        <button
          class={`p3n-play-btn${isPlaying() ? ' p3n-play-btn-active' : ''}`}
          onClick={handlePlayPause}
          disabled={!net()}
        >
          {isPlaying() ? 'Pause' : 'Play'}
        </button>
      </div>

      <div class="p3n-tab-content">
        <Show when={net() && doc()} fallback={<div class="p3n-loading">Loading execution…</div>}>
          {(_) => {
            const currentDoc = () => doc()!;
            const currentDef = () => net()!.def;
            const tokens = () => currentDoc().tokens ?? {};
            const candidateUrls = () => currentDoc().originalCandidateUrls ?? [];

            return (
              <>
                <Show when={selectedTab() === 'petrinet'}>
                  <div class="p3n-exec-layout">
                    <div class="p3n-exec-main">
                      <div class="p3n-petrinet-wrap">
                        <P3NetRenderer
                          def={currentDef()}
                          tokens={tokens()}
                          selectedTokenId={selectedTokenId()}
                          onSelectToken={setSelectedTokenId}
                          onDropOnPlace={() => {}}
                          hiddenTokenIds={animState()?.hiddenIds}
                          animatingFirings={animState()?.firings}
                          onAnimRemoveInputs={handleAnimRemoveInputs}
                          onAnimAddOutput={handleAnimAddOutput}
                          onAnimComplete={handleAnimComplete}
                        />
                      </div>
                    </div>
                    <Show when={selectedTokenId()}>
                      <TokenInspector
                        tokens={tokens()}
                        selectedTokenId={selectedTokenId()!}
                        def={currentDef()}
                        onClose={() => setSelectedTokenId(null)}
                        onSelectToken={setSelectedTokenId}
                      />
                    </Show>
                  </div>
                </Show>

                <Show when={selectedTab() === 'candidates'}>
                  <CandidatesView candidateUrls={candidateUrls()} />
                </Show>
              </>
            );
          }}
        </Show>
      </div>
    </div>
  );
}

function TokenInspector(props: {
  tokens: NetState;
  selectedTokenId: string;
  def: NetDef;
  onClose: () => void;
  onSelectToken: (id: string) => void;
}) {
  const selected = () => {
    for (const [placeId, placeTokens] of Object.entries(props.tokens ?? {})) {
      const token = placeTokens.find((t) => t.id === props.selectedTokenId);
      if (token) return { token: token as TokenInstance, placeId };
    }
    return null;
  };

  const tokenType = () => {
    const s = selected();
    if (!s) return null;
    return props.def.tokenTypes.find((tt) => tt.id === s.token.state.type);
  };

  const placeTokens = () => {
    const s = selected();
    if (!s) return [];
    return (props.tokens[s.placeId] ?? []) as TokenInstance[];
  };

  const currentIndex = () => {
    const tokens = placeTokens();
    return tokens.findIndex((t) => t.id === props.selectedTokenId);
  };

  const canGoPrev = () => currentIndex() > 0;
  const canGoNext = () => currentIndex() < placeTokens().length - 1;

  function handlePrev() {
    const idx = currentIndex();
    const tokens = placeTokens();
    if (idx > 0) {
      props.onSelectToken(tokens[idx - 1].id);
    }
  }

  function handleNext() {
    const idx = currentIndex();
    const tokens = placeTokens();
    if (idx < tokens.length - 1) {
      props.onSelectToken(tokens[idx + 1].id);
    }
  }

  return (
    <div class="p3n-inspector">
      <div class="p3n-inspector-header">
        <span class="p3n-inspector-title">Token Inspector</span>
        <button class="p3n-inspector-close" onClick={props.onClose}>×</button>
      </div>
      <Show when={selected()} fallback={<div class="p3n-inspector-empty">No token selected</div>}>
        {(s) => (
          <div class="p3n-inspector-content">
            <Show when={placeTokens().length > 1}>
              <div class="p3n-inspector-nav">
                <button
                  class="p3n-inspector-nav-btn"
                  disabled={!canGoPrev()}
                  onClick={handlePrev}
                >
                  ←
                </button>
                <span class="p3n-inspector-nav-label">
                  {currentIndex() + 1} / {placeTokens().length}
                </span>
                <button
                  class="p3n-inspector-nav-btn"
                  disabled={!canGoNext()}
                  onClick={handleNext}
                >
                  →
                </button>
              </div>
            </Show>
            <div class="p3n-inspector-row">
              <span class="p3n-inspector-label">Type</span>
              <span class="p3n-inspector-value">
                <span
                  class="p3n-inspector-dot"
                  style={{ background: tokenType()?.color ?? '#6b7280' }}
                />
                {tokenType()?.label ?? s().token.state.type}
              </span>
            </div>
            <div class="p3n-inspector-row">
              <span class="p3n-inspector-label">Place</span>
              <span class="p3n-inspector-value">{s().placeId}</span>
            </div>
            <div class="p3n-inspector-row">
              <span class="p3n-inspector-label">ID</span>
              <span class="p3n-inspector-value p3n-inspector-mono">{s().token.id}</span>
            </div>
            <Show when={(s().token.state as Record<string, unknown>).prompt}>
              <div class="p3n-inspector-section">
                <span class="p3n-inspector-label">Prompt</span>
                <div class="p3n-inspector-prompt">
                  {(s().token.state as Record<string, unknown>).prompt as string}
                </div>
              </div>
            </Show>
            <Show when={(s().token.state as Record<string, unknown>).specUrl}>
              <div class="p3n-inspector-row">
                <span class="p3n-inspector-label">Spec</span>
                <span class="p3n-inspector-value p3n-inspector-mono">
                  {((s().token.state as Record<string, unknown>).specUrl as string).slice(0, 20)}…
                </span>
              </div>
            </Show>
            <Show when={(s().token.state as Record<string, unknown>).documentUrl}>
              <div class="p3n-inspector-row">
                <span class="p3n-inspector-label">Document</span>
                <span class="p3n-inspector-value p3n-inspector-mono">
                  {((s().token.state as Record<string, unknown>).documentUrl as string).slice(0, 20)}…
                </span>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

function CandidatesView(props: { candidateUrls: AutomergeUrl[] }) {
  const [expandedIndex, setExpandedIndex] = createSignal<number | null>(null);
  return (
    <div class="p3n-candidates-view">
      <Show
        when={props.candidateUrls.length > 0}
        fallback={
          <div class="p3n-candidates-empty">
            <div class="p3n-empty-icon">◎</div>
            <div class="p3n-empty-text">No candidates in this execution</div>
            <div class="p3n-empty-hint">
              Candidate URLs are populated when the execution is created from a plan
            </div>
          </div>
        }
      >
        <div class="p3n-candidates-list">
          <For each={props.candidateUrls}>
            {(url, index) => {
              const isExpanded = () => expandedIndex() === index();
              return (
                <div class="p3n-candidate-card" classList={{ 'p3n-candidate-card-expanded': isExpanded() }}>
                  <div
                    class="p3n-candidate-card-header"
                    onClick={() => setExpandedIndex(isExpanded() ? null : index())}
                  >
                    <span class="p3n-candidate-card-index">#{index() + 1}</span>
                    <span class="p3n-candidate-card-url">
                      {url.replace('automerge:', '').slice(0, 20)}…
                    </span>
                    <span class="p3n-candidate-card-toggle">{isExpanded() ? '▾' : '▸'}</span>
                  </div>
                  <Show when={isExpanded()}>
                    <div class="p3n-candidate-card-body">
                      <patchwork-view attr:doc-url={url} style="display:block;width:100%;min-height:200px;" />
                    </div>
                  </Show>
                </div>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
