import React, { useMemo, useRef, useCallback } from 'react';
import { computeLayout } from './layout';
import type { NetLayout } from './layout';
import type { NetDef, NetState, TokenTypeDef, TokenState, TokenInstance } from './lib';
import type { CanvasToken } from './doc';

// ─── Constants ────────────────────────────────────────────────────────────────

const PLACE_RADIUS = 36;
const TRANSITION_W = 52;
const TRANSITION_H = 32;
const ARC_CURVE = 30;
const CANVAS_PAD = 200;
const LAYOUT_PAD = 80;

// ─── Layout net conversion ────────────────────────────────────────────────────

type LayoutNet = {
  places: { id: string }[];
  transitions: { id: string }[];
  arcs: { from: string; to: string; kind: 'in' | 'out' }[];
};

function toLayoutNet(def: NetDef): LayoutNet {
  return {
    places: def.places.map((id) => ({ id })),
    transitions: def.transitions.map((t) => ({ id: t.id })),
    arcs: def.transitions.flatMap((t) => [
      ...t.from.map((f) => ({ from: f, to: t.id, kind: 'in' as const })),
      ...t.to.map((to) => ({ from: t.id, to, kind: 'out' as const })),
    ]),
  };
}

// ─── Arc path helpers ─────────────────────────────────────────────────────────

function edgePoint(
  cx: number,
  cy: number,
  kind: 'place' | 'transition',
  ux: number,
  uy: number,
  extra = 0,
): [number, number] {
  if (kind === 'place') {
    return [cx + ux * (PLACE_RADIUS + extra), cy + uy * (PLACE_RADIUS + extra)];
  }
  const hw = TRANSITION_W / 2;
  const hh = TRANSITION_H / 2;
  const scaleX = Math.abs(ux) > 0.001 ? hw / Math.abs(ux) : Infinity;
  const scaleY = Math.abs(uy) > 0.001 ? hh / Math.abs(uy) : Infinity;
  const tScale = Math.min(scaleX, scaleY);
  if (!isFinite(tScale)) return [cx, cy];
  return [cx + ux * (tScale + extra), cy + uy * (tScale + extra)];
}

function arcPath(
  fromId: string,
  toId: string,
  layout: NetLayout,
  ox: number,
  oy: number,
): string | null {
  const fl = layout.get(fromId);
  const tl = layout.get(toId);
  if (!fl || !tl) return null;

  const fx = fl.x + ox;
  const fy = fl.y + oy;
  const tx = tl.x + ox;
  const ty = tl.y + oy;

  const dx = tx - fx;
  const dy = ty - fy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const px = -uy * ARC_CURVE;
  const py = ux * ARC_CURVE;

  const [sx, sy] = edgePoint(fx, fy, fl.kind, ux, uy);
  const [ex, ey] = edgePoint(tx, ty, tl.kind, -ux, -uy, 6);
  const mx = (fx + tx) / 2 + px;
  const my = (fy + ty) / 2 + py;

  return `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
}

// ─── Token colour ─────────────────────────────────────────────────────────────

export function resolveTokenColor(
  state: TokenState,
  def: NetDef,
): string {
  if (def.getColor) return def.getColor(state);
  // Fallback: look up palette chip color by state.type
  const typeDef = def.tokenTypes.find((t) => t.id === state.type);
  return typeDef?.color ?? '#6b7280';
}

// ─── Drag payload ─────────────────────────────────────────────────────────────

export type DragPayload =
  | { kind: 'place'; tokenId: string; placeId: string }
  | { kind: 'canvas'; tokenId: string }
  | { kind: 'palette'; typeId: string };

export const DRAG_KEY = 'application/p3n-token';

// ─── Token dot (shared visual) ────────────────────────────────────────────────

interface TokenDotProps {
  token: TokenInstance | CanvasToken;
  def: NetDef;
  selected: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onClick: (e: React.MouseEvent) => void;
}

function TokenDot({ token, def, selected, onDragStart, onClick }: TokenDotProps) {
  const color = resolveTokenColor(token.state as TokenState, def);
  return (
    <div
      className={`p3n-token${selected ? ' p3n-token-selected' : ''}`}
      style={{ background: color }}
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      title={token.id}
    />
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface RendererProps {
  def: NetDef;
  tokens: NetState;
  canvas: CanvasToken[];
  selectedTokenId: string | null;
  onSelectToken: (id: string | null) => void;
  onDropOnPlace: (payload: DragPayload, placeId: string) => void;
  onDropOnCanvas: (payload: DragPayload, x: number, y: number) => void;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

export function P3NetRenderer({
  def,
  tokens,
  canvas,
  selectedTokenId,
  onSelectToken,
  onDropOnPlace,
  onDropOnCanvas,
}: RendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layoutNet = useMemo(() => toLayoutNet(def), [def]);
  const layout = useMemo(() => computeLayout(layoutNet), [layoutNet]);

  const { containerW, containerH, offsetX, offsetY } = useMemo(() => {
    const allPos = Array.from(layout.values());
    if (allPos.length === 0) {
      return { containerW: 600, containerH: 400, offsetX: CANVAS_PAD, offsetY: CANVAS_PAD };
    }
    const xs = allPos.map((p) => p.x);
    const ys = allPos.map((p) => p.y);
    const minX = Math.min(...xs) - LAYOUT_PAD - CANVAS_PAD;
    const minY = Math.min(...ys) - LAYOUT_PAD - CANVAS_PAD;
    const maxX = Math.max(...xs) + LAYOUT_PAD + CANVAS_PAD;
    const maxY = Math.max(...ys) + LAYOUT_PAD + CANVAS_PAD;
    return {
      containerW: maxX - minX,
      containerH: maxY - minY,
      offsetX: -minX,
      offsetY: -minY,
    };
  }, [layout]);

  // ── DnD ──────────────────────────────────────────────────────────────────────

  const handleTokenDragStart = useCallback(
    (e: React.DragEvent, payload: DragPayload) => {
      e.stopPropagation();
      e.dataTransfer.setData(DRAG_KEY, JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'move';
    },
    [],
  );

  const handlePlaceDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_KEY)) {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handlePlaceDrop = useCallback(
    (e: React.DragEvent, placeId: string) => {
      e.preventDefault();
      e.stopPropagation();
      const raw = e.dataTransfer.getData(DRAG_KEY);
      if (!raw) return;
      onDropOnPlace(JSON.parse(raw) as DragPayload, placeId);
    },
    [onDropOnPlace],
  );

  const handleContainerDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes(DRAG_KEY)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  }, []);

  const handleContainerDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData(DRAG_KEY);
      if (!raw || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left - offsetX;
      const y = e.clientY - rect.top - offsetY;
      onDropOnCanvas(JSON.parse(raw) as DragPayload, x, y);
    },
    [offsetX, offsetY, onDropOnCanvas],
  );

  return (
    <div
      ref={containerRef}
      className="p3n-net-container"
      style={{ width: containerW, height: containerH }}
      onDragOver={handleContainerDragOver}
      onDrop={handleContainerDrop}
      onClick={(e) => {
        if (!(e.target as Element).closest('.p3n-token, .p3n-canvas-token-wrap')) {
          onSelectToken(null);
        }
      }}
    >
      {/* ── Arc SVG overlay ──────────────────────────────────────────────── */}
      <svg className="p3n-arc-layer" width={containerW} height={containerH}>
        <defs>
          <marker
            id="p3n-arrow"
            viewBox="0 0 10 8"
            refX="9"
            refY="4"
            markerWidth="5"
            markerHeight="5"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 4 L 0 8 z" fill="#94a3b8" />
          </marker>
        </defs>
        {layoutNet.arcs.map((arc, i) => {
          const d = arcPath(arc.from, arc.to, layout, offsetX, offsetY);
          if (!d) return null;
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={1.5}
              markerEnd="url(#p3n-arrow)"
            />
          );
        })}
      </svg>

      {/* ── Places ───────────────────────────────────────────────────────── */}
      {def.places.map((placeId) => {
        const pos = layout.get(placeId);
        if (!pos) return null;
        const placeTokens = tokens[placeId] ?? [];

        return (
          <div
            key={placeId}
            className={`p3n-place${placeTokens.length > 0 ? ' p3n-place-active' : ''}`}
            style={{ left: pos.x + offsetX, top: pos.y + offsetY }}
            onDragOver={handlePlaceDragOver}
            onDrop={(e) => handlePlaceDrop(e, placeId)}
          >
            <div className="p3n-place-tokens">
              {placeTokens.map((t) => (
                <TokenDot
                  key={t.id}
                  token={t}
                  def={def}
                  selected={t.id === selectedTokenId}
                  onDragStart={(e) =>
                    handleTokenDragStart(e, { kind: 'place', tokenId: t.id, placeId })
                  }
                  onClick={(e) => { e.stopPropagation(); onSelectToken(t.id); }}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* ── Place labels ─────────────────────────────────────────────────── */}
      {def.places.map((placeId) => {
        const pos = layout.get(placeId);
        if (!pos) return null;
        return (
          <div
            key={`lbl-${placeId}`}
            className="p3n-place-label"
            style={{ left: pos.x + offsetX, top: pos.y + offsetY + PLACE_RADIUS + 6 }}
          >
            {placeId}
          </div>
        );
      })}

      {/* ── Transitions ──────────────────────────────────────────────────── */}
      {def.transitions.map((t) => {
        const pos = layout.get(t.id);
        if (!pos) return null;
        return (
          <div
            key={t.id}
            className="p3n-transition"
            style={{ left: pos.x + offsetX, top: pos.y + offsetY }}
          >
            {t.id}
          </div>
        );
      })}

      {/* ── Canvas tokens ────────────────────────────────────────────────── */}
      {canvas.map((ct) => {
        const typeLabel = def.tokenTypes.find(
          (tt) => tt.id === ct.state.type,
        )?.label ?? String(ct.state.type ?? ct.id);
        return (
          <div
            key={ct.id}
            className="p3n-canvas-token-wrap"
            style={{ left: ct.x + offsetX, top: ct.y + offsetY }}
          >
            <TokenDot
              token={ct}
              def={def}
              selected={ct.id === selectedTokenId}
              onDragStart={(e) =>
                handleTokenDragStart(e, { kind: 'canvas', tokenId: ct.id })
              }
              onClick={(e) => { e.stopPropagation(); onSelectToken(ct.id); }}
            />
            <div className="p3n-canvas-token-label">{typeLabel}</div>
          </div>
        );
      })}
    </div>
  );
}
