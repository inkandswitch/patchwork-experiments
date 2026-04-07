import { render } from 'solid-js/web';
import { createSignal, Show, For } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle, Repo } from '@automerge/automerge-repo';

import type { PetriNetPlanDoc, PetriNetExecutionDoc } from './types';
import type { TokenInstance, PendingStep, TransitionFiring, NetDef, NetState } from './lib';
import { createNet } from './net';
import { P3NetRenderer } from './renderer';
import { CollapsibleSection, TokenCard, getTokensByType, makeId } from './components';
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

function ExecutionView({ handle, repo }: { handle: DocHandle<PetriNetExecutionDoc>; repo: Repo }) {
  const [doc] = useDocument<PetriNetExecutionDoc>(() => handle.url);
  const [planDoc] = useDocument<PetriNetPlanDoc>(() => doc()?.planUrl);

  const net = () => {
    const d = doc();
    if (!d) return null;
    const netDef = createNet(repo, handle as unknown as DocHandle<PetriNetPlanDoc>);
    return {
      def: netDef,
      prepareStep: async () => {
        const snapshot: NetState = {};
        for (const placeId of netDef.places) {
          snapshot[placeId] = (d.tokens?.[placeId] ?? []).map((t) => ({
            id: t.id,
            state: JSON.parse(JSON.stringify(t.state)),
          }));
        }

        const reserved = new Set<string>();
        const prepared: Array<{
          transition: typeof netDef.transitions[0];
          inputs: Array<{ id: string; placeId: string; state: typeof d.tokens[string][0]['state'] }>;
          outputs: Array<{ id: string; placeId: string; state: typeof d.tokens[string][0]['state'] }>;
        }> = [];

        for (const transition of netDef.transitions) {
          const candidates: { [placeId: string]: TokenInstance } = {};
          let canFire = true;

          for (const placeId of transition.from) {
            const available = (snapshot[placeId] ?? []).find((t) => !reserved.has(t.id));
            if (!available) {
              canFire = false;
              break;
            }
            candidates[placeId] = available;
          }
          if (!canFire) continue;

          const allCandidates: { [placeId: string]: TokenInstance[] } = {};
          if (transition.fromAll) {
            for (const placeId of transition.fromAll) {
              const available = (snapshot[placeId] ?? []).filter((t) => !reserved.has(t.id));
              if (available.length === 0) {
                canFire = false;
                break;
              }
              allCandidates[placeId] = available;
            }
          }
          if (!canFire) continue;

          for (const t of Object.values(candidates)) reserved.add(t.id);
          for (const tokens of Object.values(allCandidates)) {
            for (const t of tokens) reserved.add(t.id);
          }

          const inputs = [
            ...Object.entries(candidates).map(([placeId, t]) => ({
              id: t.id,
              placeId,
              state: JSON.parse(JSON.stringify(t.state)),
            })),
            ...Object.entries(allCandidates).flatMap(([placeId, tokens]) =>
              tokens.map((t) => ({ id: t.id, placeId, state: JSON.parse(JSON.stringify(t.state)) })),
            ),
          ];

          const outputs = [];
          for (const input of inputs) {
            for (const p of transition.to) {
              outputs.push({ id: makeId(), placeId: p, state: JSON.parse(JSON.stringify(input.state)) });
            }
          }

          prepared.push({ transition, inputs, outputs });
        }

        if (prepared.length === 0) return null;

        const firings: TransitionFiring[] = prepared.map(({ transition, inputs, outputs }) => ({
          transitionId: transition.id,
          inputs,
          outputs,
        }));

        const outputMap = new Map<string, { id: string; placeId: string; state: any }>();
        for (const { outputs } of prepared) {
          for (const out of outputs) {
            outputMap.set(out.id, out);
          }
        }

        const inputsToRemove = prepared.flatMap(({ inputs }) =>
          inputs.map((inp) => ({ placeId: inp.placeId, tokenId: inp.id })),
        );

        return {
          firings,
          removeInputs() {
            handle.change((d) => {
              for (const { placeId, tokenId } of inputsToRemove) {
                const arr = d.tokens?.[placeId];
                if (!arr) continue;
                const idx = arr.findIndex((t) => t.id === tokenId);
                if (idx !== -1) arr.splice(idx, 1);
              }
            });
          },
          addOutput(id: string) {
            const out = outputMap.get(id);
            if (!out) return;
            handle.change((d) => {
              if (!d.tokens) d.tokens = {};
              if (!d.tokens[out.placeId]) d.tokens[out.placeId] = [];
              d.tokens[out.placeId].push({ id: out.id, state: JSON.parse(JSON.stringify(out.state)) });
            });
          },
          runSideEffects() {},
        };
      },
      reset() {
        handle.change((d) => {
          d.tokens = {};
        });
      },
    };
  };

  const [selectedTokenId, setSelectedTokenId] = createSignal<string | null>(null);
  const [animState, setAnimState] = createSignal<AnimState | null>(null);
  const [isPlaying, setIsPlaying] = createSignal(false);
  let steppingRef = false;
  let playIntervalId: ReturnType<typeof setInterval> | null = null;

  async function handleStep() {
    const n = net();
    if (!n || steppingRef) return;
    steppingRef = true;
    try {
      const pending = await n.prepareStep();
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

  function handleReset() {
    net()?.reset();
    setSelectedTokenId(null);
    setAnimState(null);
    setIsPlaying(false);
    if (playIntervalId !== null) clearInterval(playIntervalId);
    playIntervalId = null;
    steppingRef = false;
  }

  function handleDelete(tokenId: string) {
    handle.change((d) => {
      for (const placeId of Object.keys(d.tokens ?? {})) {
        const arr = d.tokens[placeId];
        const idx = arr.findIndex((t) => t.id === tokenId);
        if (idx !== -1) {
          arr.splice(idx, 1);
          return;
        }
      }
    });
    setSelectedTokenId(null);
  }

  function handlePromptChange(tokenId: string, newPrompt: string) {
    handle.change((d) => {
      for (const placeTokens of Object.values(d.tokens ?? {})) {
        const token = placeTokens.find((t) => t.id === tokenId);
        if (token) {
          (token.state as Record<string, unknown>).prompt = newPrompt;
          return;
        }
      }
    });
  }

  function getTokenTypesInDoc(def: NetDef, tokens: NetState) {
    const typesInDoc = new Set<string>();
    for (const placeTokens of Object.values(tokens ?? {})) {
      for (const t of placeTokens) {
        typesInDoc.add((t as TokenInstance).state.type);
      }
    }
    return def.tokenTypes.filter((tt) => typesInDoc.has(tt.id));
  }

  return (
    <div class="p3n-sim-root">
      <div class="p3n-toolbar">
        <span class="p3n-toolbar-spacer" />
        <button class="p3n-reset-btn" onClick={handleReset} disabled={!net()}>
          Reset
        </button>
        <button class="p3n-step-btn" onClick={handleStep} disabled={!net() || isPlaying() || steppingRef}>
          Step
        </button>
        <button
          class={`p3n-play-btn${isPlaying() ? ' p3n-play-btn-active' : ''}`}
          onClick={handlePlayPause}
          disabled={!net()}
        >
          {isPlaying() ? 'Pause' : 'Play'}
        </button>
      </div>

      <div class="p3n-sections-container">
        <Show when={net() && doc()} fallback={<div class="p3n-loading">Loading execution…</div>}>
          {(_) => {
            const currentDoc = () => doc()!;
            const currentNet = () => net()!;
            const tokens = () => currentDoc().tokens ?? {};
            const tokenTypes = () => getTokenTypesInDoc(currentNet().def, tokens());

            return (
              <>
                <CollapsibleSection title="Tokens" defaultOpen={true}>
                  <div class="p3n-token-sections">
                    <For each={tokenTypes()}>
                      {(tokenType) => {
                        const tokensOfType = () => getTokensByType(tokens(), tokenType.id);
                        return (
                          <CollapsibleSection
                            title={tokenType.label}
                            color={tokenType.color}
                            count={tokensOfType().length}
                            defaultOpen={tokensOfType().length > 0}
                          >
                            <div class="p3n-token-type-content">
                              <Show
                                when={tokensOfType().length > 0}
                                fallback={
                                  <div class="p3n-token-empty-hint">
                                    No {tokenType.label.toLowerCase()} tokens
                                  </div>
                                }
                              >
                                <For each={tokensOfType()}>
                                  {({ token, placeId }) => (
                                    <TokenCard
                                      token={token}
                                      placeId={placeId}
                                      def={currentNet().def}
                                      isSelected={selectedTokenId() === token.id}
                                      onSelect={() => setSelectedTokenId(token.id)}
                                      onDelete={() => handleDelete(token.id)}
                                      onPromptChange={(newPrompt) => handlePromptChange(token.id, newPrompt)}
                                    />
                                  )}
                                </For>
                              </Show>
                            </div>
                          </CollapsibleSection>
                        );
                      }}
                    </For>
                  </div>
                </CollapsibleSection>

                <CollapsibleSection title="Petrinet" defaultOpen={true}>
                  <div class="p3n-petrinet-wrap">
                    <P3NetRenderer
                      def={currentNet().def}
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
                </CollapsibleSection>
              </>
            );
          }}
        </Show>
      </div>
    </div>
  );
}
