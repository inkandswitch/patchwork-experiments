import { render } from 'solid-js/web';
import { createSignal, Show } from 'solid-js';
import { RepoContext, useDocument } from '@automerge/automerge-repo-solid-primitives';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';

import type { LLMPetriNetDoc } from './types';
import type { TokenInstance, TokenState, PendingStep, TransitionFiring } from './lib';
import { useLLMPetriNet } from './use-llm-petrinet';
import { P3NetRenderer, DRAG_KEY, resolveTokenColor } from './renderer';
import type { DragPayload } from './renderer';
import './index.css';

// ─── Entry point ──────────────────────────────────────────────────────────────

export const LLMPetriNetSimulationTool: ToolRender = (handle, element) => {
  const dispose = render(
    () => (
      <RepoContext.Provider value={element.repo}>
        <LLMPetriNetSimulation handle={handle as DocHandle<LLMPetriNetDoc>} />
      </RepoContext.Provider>
    ),
    element,
  );
  return dispose;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readTokenInstance(doc: LLMPetriNetDoc, tokenId: string): TokenInstance | undefined {
  for (const placeTokens of Object.values(doc.tokens ?? {})) {
    const t = placeTokens.find((t) => t.id === tokenId);
    if (t) return t as unknown as TokenInstance;
  }
  return undefined;
}

function readPlaceSiblingIds(doc: LLMPetriNetDoc, tokenId: string): string[] {
  for (const placeTokens of Object.values(doc.tokens ?? {})) {
    if (placeTokens.some((t) => t.id === tokenId)) {
      return placeTokens.map((t) => t.id);
    }
  }
  return [tokenId];
}

function removeTokenFromDoc(doc: LLMPetriNetDoc, tokenId: string): void {
  for (const placeId of Object.keys(doc.tokens ?? {})) {
    const arr = doc.tokens[placeId];
    const idx = arr.findIndex((t) => t.id === tokenId);
    if (idx !== -1) { arr.splice(idx, 1); return; }
  }
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Simulation view ──────────────────────────────────────────────────────────

type AnimState = {
  hiddenIds: Set<string>;
  firings: TransitionFiring[];
  pending: PendingStep;
};

function LLMPetriNetSimulation({ handle }: { handle: DocHandle<LLMPetriNetDoc> }) {
  const [doc] = useDocument<LLMPetriNetDoc>(() => handle.url);
  const { net } = useLLMPetriNet(handle);
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
      const inst = readTokenInstance(d as unknown as LLMPetriNetDoc, payload.tokenId);
      if (!inst) return;
      removeTokenFromDoc(d as unknown as LLMPetriNetDoc, payload.tokenId);
      d.tokens[placeId].push({
        id: payload.tokenId,
        state: JSON.parse(JSON.stringify(inst.state)),
      });
    });
  }

  function handleDelete(tokenId: string) {
    handle.change((d) => removeTokenFromDoc(d as unknown as LLMPetriNetDoc, tokenId));
    setSelectedTokenId(null);
  }

  return (
    <div class="p3n-sim-root">
      <div class="p3n-toolbar">
        <span class="p3n-section-label">Simulation</span>
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

      <div class="p3n-sim-body">
        <Show when={net()} fallback={<div class="p3n-loading">Loading net…</div>}>
          {(n) => (
            <div class="p3n-graph-wrap">
              <Show when={doc()}>
                {(currentDoc) => (
                  <P3NetRenderer
                    def={n().def}
                    tokens={currentDoc().tokens ?? {}}
                    selectedTokenId={selectedTokenId()}
                    onSelectToken={setSelectedTokenId}
                    onDropOnPlace={handleDropOnPlace}
                    hiddenTokenIds={animState()?.hiddenIds}
                    animatingFirings={animState()?.firings}
                    onAnimRemoveInputs={handleAnimRemoveInputs}
                    onAnimAddOutput={handleAnimAddOutput}
                    onAnimComplete={handleAnimComplete}
                  />
                )}
              </Show>
            </div>
          )}
        </Show>

        <Show when={selectedTokenId() !== null && doc()}>
          {(_) => {
            const inst = () => {
              const d = doc();
              const id = selectedTokenId();
              if (!d || !id) return undefined;
              return readTokenInstance(d, id);
            };
            const siblingIds = () => {
              const d = doc();
              const id = selectedTokenId();
              if (!d || !id) return [id ?? ''];
              return readPlaceSiblingIds(d, id);
            };
            return (
              <Show when={inst()}>
                {(token) => (
                  <TokenSidebar
                    tokenId={selectedTokenId()!}
                    state={token().state}
                    def={net()?.def}
                    siblingIds={siblingIds()}
                    onNavigate={setSelectedTokenId}
                    onClose={() => setSelectedTokenId(null)}
                    onDelete={() => handleDelete(selectedTokenId()!)}
                    onChange={(key, value) => {
                      handle.change((d) => {
                        const id = selectedTokenId();
                        if (!id) return;
                        for (const placeTokens of Object.values(d.tokens ?? {})) {
                          const t = placeTokens.find((t) => t.id === id);
                          if (t) { (t.state as Record<string, unknown>)[key] = value; return; }
                        }
                      });
                    }}
                  />
                )}
              </Show>
            );
          }}
        </Show>
      </div>
    </div>
  );
}

// ─── Token sidebar ────────────────────────────────────────────────────────────

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

// ─── Property editor ──────────────────────────────────────────────────────────

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
