import { render } from 'solid-js/web';
import { createSignal, Show, For, type JSX } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';

import type { PetriNetPlanDoc } from './types';
import type { TokenInstance, TokenState, PendingStep, TransitionFiring, NetDef } from './lib';
import { usePetriNetPlan } from './use-petrinet-plan';
import { P3NetRenderer, DRAG_KEY, resolveTokenColor } from './renderer';
import type { DragPayload } from './renderer';
import './petrinet-plan.css';

export const PetriNetPlanTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <PetriNetPlanSimulation handle={handle as DocHandle<PetriNetPlanDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

function readTokenInstance(doc: PetriNetPlanDoc, tokenId: string): TokenInstance | undefined {
  for (const placeTokens of Object.values(doc.tokens ?? {})) {
    const t = placeTokens.find((t) => t.id === tokenId);
    if (t) return t as unknown as TokenInstance;
  }
  return undefined;
}

function readPlaceSiblingIds(doc: PetriNetPlanDoc, tokenId: string): string[] {
  for (const placeTokens of Object.values(doc.tokens ?? {})) {
    if (placeTokens.some((t) => t.id === tokenId)) {
      return placeTokens.map((t) => t.id);
    }
  }
  return [tokenId];
}

function removeTokenFromDoc(doc: PetriNetPlanDoc, tokenId: string): void {
  for (const placeId of Object.keys(doc.tokens ?? {})) {
    const arr = doc.tokens[placeId];
    const idx = arr.findIndex((t) => t.id === tokenId);
    if (idx !== -1) { arr.splice(idx, 1); return; }
  }
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

type AnimState = {
  hiddenIds: Set<string>;
  firings: TransitionFiring[];
  pending: PendingStep;
};

function CollapsibleSection(props: {
  title: string;
  color?: string;
  count?: number;
  defaultOpen?: boolean;
  children: JSX.Element;
}) {
  const [isOpen, setIsOpen] = createSignal(props.defaultOpen ?? true);

  return (
    <div class={`p3n-collapsible${isOpen() ? '' : ' p3n-collapsible-closed'}`}>
      <button class="p3n-collapsible-header" onClick={() => setIsOpen(!isOpen())}>
        <span class="p3n-collapsible-toggle">{isOpen() ? '▼' : '▶'}</span>
        <Show when={props.color}>
          <span class="p3n-collapsible-dot" style={{ background: props.color }} />
        </Show>
        <span class="p3n-collapsible-title">{props.title}</span>
        <Show when={props.count !== undefined}>
          <span class="p3n-collapsible-count">{props.count}</span>
        </Show>
      </button>
      <Show when={isOpen()}>
        <div class="p3n-collapsible-body">{props.children}</div>
      </Show>
    </div>
  );
}

function TokenCard(props: {
  token: TokenInstance;
  placeId: string;
  def: NetDef;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const color = () => resolveTokenColor(props.token.state, props.def);
  const typeLabel = () =>
    props.def.tokenTypes.find((t) => t.id === props.token.state.type)?.label ?? props.token.state.type;
  const specUrl = () => (props.token.state as Record<string, unknown>).specUrl as string | undefined;

  return (
    <div class={`p3n-token-card${props.isSelected ? ' p3n-token-card-selected' : ''}`} onClick={props.onSelect}>
      <div class="p3n-token-card-header">
        <span class="p3n-token-card-dot" style={{ background: color() }} />
        <span class="p3n-token-card-label">{typeLabel()}</span>
        <span class="p3n-token-card-place">{props.placeId}</span>
        <button class="p3n-token-card-delete" onClick={(e) => { e.stopPropagation(); props.onDelete(); }}>×</button>
      </div>
      <Show when={specUrl()}>
        {(url) => (
          <div class="p3n-token-card-spec">
            <patchwork-view attr:doc-url={url()} class="p3n-token-card-patchwork" />
          </div>
        )}
      </Show>
    </div>
  );
}

function PetriNetPlanSimulation({ handle }: { handle: DocHandle<PetriNetPlanDoc> }) {
  const [doc] = useDocument<PetriNetPlanDoc>(() => handle.url);
  const { net } = usePetriNetPlan(handle);
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

  async function handleDropOnPlace(payload: DragPayload, placeId: string) {
    if (payload.kind === 'palette') {
      const typeDef = net()?.def.tokenTypes.find((t) => t.id === payload.typeId);
      if (!typeDef) return;
      const state = await typeDef.create();
      handle.change((d) => {
        if (!d.tokens[placeId]) d.tokens[placeId] = [];
        d.tokens[placeId].push({ id: makeId(), state: JSON.parse(JSON.stringify(state)) });
      });
      return;
    }

    handle.change((d) => {
      if (!d.tokens[placeId]) d.tokens[placeId] = [];
      const inst = readTokenInstance(d as unknown as PetriNetPlanDoc, payload.tokenId);
      if (!inst) return;
      removeTokenFromDoc(d as unknown as PetriNetPlanDoc, payload.tokenId);
      d.tokens[placeId].push({
        id: payload.tokenId,
        state: JSON.parse(JSON.stringify(inst.state)),
      });
    });
  }

  function handleDelete(tokenId: string) {
    handle.change((d) => removeTokenFromDoc(d as unknown as PetriNetPlanDoc, tokenId));
    setSelectedTokenId(null);
  }

  function getTokensByType(tokens: PetriNetPlanDoc['tokens'], typeId: string): Array<{ token: TokenInstance; placeId: string }> {
    const result: Array<{ token: TokenInstance; placeId: string }> = [];
    for (const [placeId, placeTokens] of Object.entries(tokens ?? {})) {
      for (const t of placeTokens) {
        if ((t as TokenInstance).state.type === typeId) {
          result.push({ token: t as TokenInstance, placeId });
        }
      }
    }
    return result;
  }

  function getTokenTypesWithTokens(def: NetDef | undefined, tokens: PetriNetPlanDoc['tokens']) {
    if (!def) return [];
    return def.tokenTypes.filter((tt) => getTokensByType(tokens, tt.id).length > 0);
  }

  return (
    <div class="p3n-sim-root">
      <div class="p3n-toolbar">
        <span class="p3n-section-label">Plan</span>
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
        <Show when={net() && doc()} fallback={<div class="p3n-loading">Loading net…</div>}>
          {(_) => {
            const currentDoc = () => doc()!;
            const currentNet = () => net()!;
            const tokens = () => currentDoc().tokens ?? {};

            return (
              <>
                <CollapsibleSection title="Tokens" defaultOpen={true}>
                  <div class="p3n-token-sections">
                    <For each={currentNet().def.tokenTypes}>
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
                                fallback={<div class="p3n-token-empty-hint">No {tokenType.label.toLowerCase()} tokens</div>}
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
                      onDropOnPlace={handleDropOnPlace}
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

function TokenSidebar(props: {
  tokenId: string;
  state: TokenState;
  def: import('./lib').NetDef | undefined;
  siblingIds: string[];
  onNavigate: (id: string) => void;
  onClose: () => void;
  onDelete: () => void;
  onChange: (key: string, value: unknown) => void;
}) {
  const color = () => props.def ? resolveTokenColor(props.state, props.def) : '#6b7280';
  const typeLabel = () =>
    props.def?.tokenTypes.find((t) => t.id === props.state.type)?.label ?? String(props.state.type ?? props.tokenId);

  const currentIndex = () => props.siblingIds.indexOf(props.tokenId);

  function navigatePrev() {
    const idx = currentIndex();
    const prev = props.siblingIds[(idx - 1 + props.siblingIds.length) % props.siblingIds.length];
    props.onNavigate(prev);
  }

  function navigateNext() {
    const idx = currentIndex();
    const next = props.siblingIds[(idx + 1) % props.siblingIds.length];
    props.onNavigate(next);
  }

  return (
    <div class="p3n-sidebar">
      <div class="p3n-sidebar-header">
        <div class="p3n-token p3n-token-static" style={{ background: color() }} />
        <div class="p3n-sidebar-title-wrap">
          <span class="p3n-sidebar-type">{typeLabel()}</span>
          <span class="p3n-sidebar-id">{props.tokenId}</span>
        </div>
        <Show when={props.siblingIds.length > 1}>
          <div class="p3n-sidebar-stepper">
            <button class="p3n-sidebar-stepper-btn" onClick={navigatePrev} aria-label="Previous">‹</button>
            <span class="p3n-sidebar-stepper-count">{currentIndex() + 1} / {props.siblingIds.length}</span>
            <button class="p3n-sidebar-stepper-btn" onClick={navigateNext} aria-label="Next">›</button>
          </div>
        </Show>
        <button class="p3n-sidebar-close" onClick={props.onClose} aria-label="Close">✕</button>
      </div>
      <div class="p3n-sidebar-body">
        <Show when={Object.keys(props.state).filter((k) => k !== 'type').length === 0}>
          <div class="p3n-sidebar-empty">No properties</div>
        </Show>
        {Object.entries(props.state).filter(([key]) => key !== 'type').map(([key, value]) => (
          <div class="p3n-prop-row">
            <label class="p3n-prop-label">{key}</label>
            <PropEditor propKey={key} value={value} onChange={(v) => props.onChange(key, v)} />
          </div>
        ))}
      </div>
      <div class="p3n-sidebar-footer">
        <button class="p3n-delete-btn" onClick={props.onDelete}>Delete token</button>
      </div>
    </div>
  );
}

function PropEditor(props: { propKey: string; value: unknown; onChange: (v: unknown) => void }) {
  if (typeof props.value === 'string' && props.value.startsWith('automerge:')) {
    const docId = props.value.replace('automerge:', '');
    return (
      <div class="p3n-prop-patchwork-wrap">
        <a class="p3n-prop-patchwork-link" href={`/#doc=${docId}`} target="_blank" rel="noreferrer">
          Open ↗
        </a>
        <patchwork-view doc-url={props.value} class="p3n-prop-patchwork" />
      </div>
    );
  }

  if (typeof props.value === 'string') {
    return (
      <textarea
        class="p3n-prop-textarea"
        value={props.value}
        onBlur={(e) => props.onChange(e.currentTarget.value)}
        rows={Math.min(8, props.value.split('\n').length + 1)}
      />
    );
  }

  if (typeof props.value === 'number') {
    return (
      <input
        class="p3n-prop-input"
        type="number"
        value={props.value}
        onBlur={(e) => props.onChange(Number(e.currentTarget.value))}
      />
    );
  }

  if (typeof props.value === 'boolean') {
    return (
      <input
        class="p3n-prop-checkbox"
        type="checkbox"
        checked={props.value}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
      />
    );
  }

  return <pre class="p3n-prop-json">{JSON.stringify(props.value, null, 2)}</pre>;
}
