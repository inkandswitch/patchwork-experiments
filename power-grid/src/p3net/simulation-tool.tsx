import { createRoot } from 'react-dom/client';
import { RepoContext, useDocument, useRepo } from '@automerge/automerge-repo-react-hooks';
import { useState, useCallback, useRef, useEffect } from 'react';
import type { ToolRender } from '@inkandswitch/patchwork-plugins';
import type { DocHandle } from '@automerge/automerge-repo';

import type { P3NetDoc, CanvasToken } from './doc';
import type { TokenState, TokenInstance, TokenTypeDef, TransitionFiring, PendingStep } from './lib';
import { useP3Net } from './use-p3net';
import { P3NetRenderer, DRAG_KEY, resolveTokenColor } from './renderer';
import type { DragPayload } from './renderer';
import './index.css';

// ─── Entry point ──────────────────────────────────────────────────────────────

export const P3NetSimulationTool: ToolRender = (handle, element) => {
  const root = createRoot(element);
  root.render(
    <RepoContext.Provider value={element.repo}>
      <P3NetSimulation handle={handle as DocHandle<P3NetDoc>} />
    </RepoContext.Provider>,
  );
  return () => root.unmount();
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readTokenInstance(
  doc: P3NetDoc,
  tokenId: string,
): TokenInstance | undefined {
  for (const placeTokens of Object.values(doc.tokens ?? {})) {
    const t = placeTokens.find((t) => t.id === tokenId);
    if (t) return t as unknown as TokenInstance;
  }
  const ct = (doc.canvas ?? []).find((t) => t.id === tokenId);
  if (ct) return { id: ct.id, state: ct.state as TokenState };
  return undefined;
}

function removeToken(doc: P3NetDoc, tokenId: string): void {
  for (const placeId of Object.keys(doc.tokens ?? {})) {
    const arr = doc.tokens[placeId];
    const idx = arr.findIndex((t) => t.id === tokenId);
    if (idx !== -1) { arr.splice(idx, 1); return; }
  }
  const canvas = doc.canvas ?? [];
  const idx = canvas.findIndex((t) => t.id === tokenId);
  if (idx !== -1) canvas.splice(idx, 1);
}

function findAndUpdateToken(
  doc: P3NetDoc,
  tokenId: string,
  fn: (state: TokenState) => void,
): void {
  for (const placeTokens of Object.values(doc.tokens ?? {})) {
    const t = placeTokens.find((t) => t.id === tokenId);
    if (t) { fn(t.state); return; }
  }
  const ct = (doc.canvas ?? []).find((t) => t.id === tokenId);
  if (ct) fn(ct.state);
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

function P3NetSimulation({ handle }: { handle: DocHandle<P3NetDoc> }) {
  const [doc] = useDocument<P3NetDoc>(handle.url);
  const repo = useRepo();
  const { net, loadError } = useP3Net(handle, doc?.sourceUrl);
  const [selectedTokenId, setSelectedTokenId] = useState<string | null>(null);
  const [animState, setAnimState] = useState<AnimState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  // Prevent overlapping steps while an animation or async prepare is running
  const steppingRef = useRef(false);
  // Shadow ref so async callbacks can read isPlaying without stale closures
  const isPlayingRef = useRef(false);
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

  const handleStep = useCallback(async () => {
    if (!net || steppingRef.current) return;
    steppingRef.current = true;
    try {
      const pending = await net.prepareStep();
      if (!pending || pending.firings.length === 0) {
        steppingRef.current = false;
        return;
      }
      const hiddenIds = new Set(pending.firings.flatMap((f) => f.inputs.map((i) => i.id)));
      setAnimState({ hiddenIds, firings: pending.firings, pending });
    } catch (err) {
      console.error(err);
      steppingRef.current = false;
    }
  }, [net]);

  // When playing and nothing is currently stepping, retry every 200ms so we
  // pick up transitions whose guards become true asynchronously (e.g. LLM done).
  useEffect(() => {
    if (!isPlaying) return;
    const id = setInterval(() => {
      if (!steppingRef.current) handleStep();
    }, 200);
    return () => clearInterval(id);
  }, [isPlaying, handleStep]);

  const handlePlayPause = useCallback(() => {
    setIsPlaying((p) => !p);
  }, []);

  const handleAnimRemoveInputs = useCallback(() => {
    animState?.pending.removeInputs();
  }, [animState]);

  const handleAnimAddOutput = useCallback((id: string) => {
    animState?.pending.addOutput(id);
  }, [animState]);

  const handleAnimComplete = useCallback(() => {
    setAnimState(null);
    steppingRef.current = false;
    if (isPlayingRef.current) handleStep();
  }, [handleStep]);

  const handleReset = useCallback(() => {
    net?.reset();
    setSelectedTokenId(null);
    setAnimState(null);
    setIsPlaying(false);
    steppingRef.current = false;
  }, [net]);

  const handleDropOnPlace = useCallback(
    (payload: DragPayload, placeId: string) => {
      if (payload.kind === 'palette') {
        const typeDef = net?.def.tokenTypes.find((t) => t.id === payload.typeId);
        if (!typeDef) return;
        const state = { type: typeDef.id, ...typeDef.create(repo) };
        handle.change((d) => {
          if (!d.tokens[placeId]) d.tokens[placeId] = [];
          d.tokens[placeId].push({ id: makeId(), state: JSON.parse(JSON.stringify(state)) });
        });
        return;
      }

      handle.change((d) => {
        if (!d.tokens[placeId]) d.tokens[placeId] = [];
        const inst = readTokenInstance(d as unknown as P3NetDoc, payload.tokenId);
        if (!inst) return;
        removeToken(d as unknown as P3NetDoc, payload.tokenId);
        d.tokens[placeId].push({
          id: payload.tokenId,
          state: JSON.parse(JSON.stringify(inst.state)),
        });
      });
    },
    [handle, net, repo],
  );

  const handleDropOnCanvas = useCallback(
    (payload: DragPayload, x: number, y: number) => {
      if (payload.kind === 'palette') {
        const typeDef = net?.def.tokenTypes.find((t) => t.id === payload.typeId);
        if (!typeDef) return;
        const state = { type: typeDef.id, ...typeDef.create(repo) };
        handle.change((d) => {
          if (!d.canvas) d.canvas = [];
          d.canvas.push({ id: makeId(), state: JSON.parse(JSON.stringify(state)), x, y });
        });
        return;
      }

      handle.change((d) => {
        if (!d.canvas) d.canvas = [];
        const inst = readTokenInstance(d as unknown as P3NetDoc, payload.tokenId);
        if (!inst) return;
        removeToken(d as unknown as P3NetDoc, payload.tokenId);
        d.canvas.push({ id: payload.tokenId, state: JSON.parse(JSON.stringify(inst.state)), x, y });
      });
    },
    [handle, net, repo],
  );

  const handleDelete = useCallback(
    (tokenId: string) => {
      handle.change((d) => removeToken(d as unknown as P3NetDoc, tokenId));
      setSelectedTokenId(null);
    },
    [handle],
  );

  if (!doc) return <div className="p3n-loading">Loading…</div>;

  const tokens = doc.tokens ?? {};
  const canvas = (doc.canvas ?? []) as CanvasToken[];
  const tokenTypes: TokenTypeDef[] = net?.def.tokenTypes ?? [];

  const selectedInst = selectedTokenId
    ? readTokenInstance(doc, selectedTokenId)
    : undefined;

  return (
    <div className="p3n-sim-root">
      <div className="p3n-toolbar">
        <span className="p3n-section-label">Simulation</span>
        <span className="p3n-toolbar-spacer" />
        {loadError && (
          <span className="p3n-error-badge" title={loadError}>Error</span>
        )}
        <button className="p3n-reset-btn" onClick={handleReset} disabled={!net}>
          Reset
        </button>
        <button className="p3n-step-btn" onClick={handleStep} disabled={!net || isPlaying || steppingRef.current}>
          Step
        </button>
        <button
          className={`p3n-play-btn${isPlaying ? ' p3n-play-btn-active' : ''}`}
          onClick={handlePlayPause}
          disabled={!net}
        >
          {isPlaying ? 'Pause' : 'Play'}
        </button>
      </div>

      {tokenTypes.length > 0 && (
        <TokenPalette tokenTypes={tokenTypes} />
      )}

      <div className="p3n-sim-body">
        {loadError ? (
          <div className="p3n-load-error">{loadError}</div>
        ) : net ? (
          <div className="p3n-graph-wrap">
            <P3NetRenderer
              def={net.def}
              tokens={tokens}
              canvas={canvas}
              selectedTokenId={selectedTokenId}
              onSelectToken={setSelectedTokenId}
              onDropOnPlace={handleDropOnPlace}
              onDropOnCanvas={handleDropOnCanvas}
              hiddenTokenIds={animState?.hiddenIds}
              animatingFirings={animState?.firings}
              onAnimRemoveInputs={handleAnimRemoveInputs}
              onAnimAddOutput={handleAnimAddOutput}
              onAnimComplete={handleAnimComplete}
            />
          </div>
        ) : (
          <div className="p3n-loading">Loading net…</div>
        )}

        {selectedTokenId && selectedInst !== undefined && (
          <TokenSidebar
            tokenId={selectedTokenId}
            state={selectedInst.state}
            def={net?.def}
            onClose={() => setSelectedTokenId(null)}
            onDelete={() => handleDelete(selectedTokenId)}
            onChange={(key, value) => {
              handle.change((d) => {
                findAndUpdateToken(
                  d as unknown as P3NetDoc,
                  selectedTokenId,
                  (s) => { s[key] = value; },
                );
              });
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Token palette ────────────────────────────────────────────────────────────

function TokenPalette({ tokenTypes }: { tokenTypes: TokenTypeDef[] }) {
  const handleDragStart = useCallback(
    (e: React.DragEvent, typeId: string) => {
      const payload: DragPayload = { kind: 'palette', typeId };
      e.dataTransfer.setData(DRAG_KEY, JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';
    },
    [],
  );

  return (
    <div className="p3n-palette">
      <span className="p3n-palette-label">Tokens</span>
      {tokenTypes.map((type) => (
        <div
          key={type.id}
          className="p3n-palette-chip"
          draggable
          onDragStart={(e) => handleDragStart(e, type.id)}
          title={`Drag to create a ${type.label} token`}
        >
          <div className="p3n-token p3n-token-static" style={{ background: type.color }} />
          <span className="p3n-palette-chip-label">{type.label}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Token sidebar ────────────────────────────────────────────────────────────

function TokenSidebar({
  tokenId,
  state,
  def,
  onClose,
  onDelete,
  onChange,
}: {
  tokenId: string;
  state: TokenState;
  def: ReturnType<typeof useP3Net>['net'] extends null ? undefined : NonNullable<ReturnType<typeof useP3Net>['net']>['def'] | undefined;
  onClose: () => void;
  onDelete: () => void;
  onChange: (key: string, value: unknown) => void;
}) {
  const color = def ? resolveTokenColor(state, def) : '#6b7280';
  const typeLabel = def?.tokenTypes.find((t) => t.id === state.type)?.label
    ?? String(state.type ?? tokenId);

  return (
    <div className="p3n-sidebar">
      <div className="p3n-sidebar-header">
        <div className="p3n-token p3n-token-static" style={{ background: color, flexShrink: 0 }} />
        <div className="p3n-sidebar-title-wrap">
          <span className="p3n-sidebar-type">{typeLabel}</span>
          <span className="p3n-sidebar-id">{tokenId}</span>
        </div>
        <button className="p3n-sidebar-close" onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="p3n-sidebar-body">
        {Object.keys(state).length === 0 && (
          <div className="p3n-sidebar-empty">No properties</div>
        )}
        {Object.entries(state).map(([key, value]) => (
          <div key={key} className="p3n-prop-row">
            <label className="p3n-prop-label">{key}</label>
            <PropEditor
              propKey={key}
              value={value}
              onChange={(v) => onChange(key, v)}
            />
          </div>
        ))}
      </div>
      <div className="p3n-sidebar-footer">
        <button className="p3n-delete-btn" onClick={onDelete}>Delete token</button>
      </div>
    </div>
  );
}

// ─── Property editor ──────────────────────────────────────────────────────────

function PropEditor({
  propKey,
  value,
  onChange,
}: {
  propKey: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (typeof value === 'number') {
    return (
      <input
        className="p3n-prop-input"
        type="number"
        defaultValue={value}
        key={`${propKey}-${value}`}
        onBlur={(e) => onChange(Number(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter') onChange(Number((e.target as HTMLInputElement).value)); }}
      />
    );
  }

  if (typeof value === 'string' && value.startsWith('automerge:')) {
    const docId = value.replace('automerge:', '');
    return (
      <div className="p3n-prop-patchwork-wrap">
        <a
          className="p3n-prop-patchwork-link"
          href={`/#doc=${docId}`}
          target="_blank"
          rel="noreferrer"
        >
          Open ↗
        </a>
        <patchwork-view doc-url={value} class="p3n-prop-patchwork" />
      </div>
    );
  }

  if (typeof value === 'string') {
    return (
      <input
        className="p3n-prop-input"
        type="text"
        defaultValue={value}
        key={`${propKey}-${value}`}
        onBlur={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onChange((e.target as HTMLInputElement).value); }}
      />
    );
  }

  if (typeof value === 'boolean') {
    return (
      <input
        className="p3n-prop-checkbox"
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  }

  return (
    <pre className="p3n-prop-json">{JSON.stringify(value, null, 2)}</pre>
  );
}
