import { useMemo } from 'react';
import type { PetriNet as LayoutNet } from '../petrinet/net';
import { computeLayout } from '../petrinet/layout';
import type { NetLayout } from '../petrinet/layout';
import type { NetDef, NetState } from './lib';

// ─── Constants ────────────────────────────────────────────────────────────────

const PLACE_RADIUS = 36;
const TRANSITION_W = 52;
const TRANSITION_H = 32;
const ARC_CURVE = 30;
const TOKEN_R = 5;

// Dot positions (relative to place centre) for 1–5 tokens
const TOKEN_POSITIONS: [number, number][][] = [
  [[0, 0]],
  [[-10, 0], [10, 0]],
  [[-10, 8], [10, 8], [0, -10]],
  [[-10, -8], [10, -8], [-10, 8], [10, 8]],
  [[-10, -8], [10, -8], [-10, 8], [10, 8], [0, 0]],
];

// ─── Convert NetDef → petrinet layout input ───────────────────────────────────

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

// ─── Arc path ─────────────────────────────────────────────────────────────────

function arcPath(fromId: string, toId: string, layout: NetLayout): string | null {
  const fl = layout.get(fromId);
  const tl = layout.get(toId);
  if (!fl || !tl) return null;

  const dx = tl.x - fl.x;
  const dy = tl.y - fl.y;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const px = -uy * ARC_CURVE;
  const py = ux * ARC_CURVE;

  const [sx, sy] = edgePoint(fl.x, fl.y, fl.kind, ux, uy);
  const [ex, ey] = edgePoint(tl.x, tl.y, tl.kind, -ux, -uy, 6);
  const mx = (fl.x + tl.x) / 2 + px;
  const my = (fl.y + tl.y) / 2 + py;

  return `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
}

function edgePoint(
  cx: number,
  cy: number,
  kind: 'place' | 'transition',
  ux: number,
  uy: number,
  extra = 0,
): [number, number] {
  if (kind === 'place') {
    const r = PLACE_RADIUS + extra;
    return [cx + ux * r, cy + uy * r];
  }
  const hw = TRANSITION_W / 2;
  const hh = TRANSITION_H / 2;
  const tScale = Math.min(
    Math.abs(ux) > 0.001 ? hw / Math.abs(ux) : Infinity,
    Math.abs(uy) > 0.001 ? hh / Math.abs(uy) : Infinity,
  );
  return [cx + ux * (tScale + extra), cy + uy * (tScale + extra)];
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

interface Props {
  def: NetDef;
  tokens: NetState;
}

export function P3NetRenderer({ def, tokens }: Props) {
  const layoutNet = useMemo(() => toLayoutNet(def), [def]);
  const layout = useMemo(() => computeLayout(layoutNet), [layoutNet]);

  const allPos = Array.from(layout.values());
  const pad = 80;
  const xs = allPos.map((p) => p.x);
  const ys = allPos.map((p) => p.y);
  const minX = (xs.length > 0 ? Math.min(...xs) : 0) - pad;
  const minY = (ys.length > 0 ? Math.min(...ys) : 0) - pad;
  const maxX = (xs.length > 0 ? Math.max(...xs) : 400) + pad;
  const maxY = (ys.length > 0 ? Math.max(...ys) : 300) + pad;

  return (
    <svg
      className="p3n-svg"
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      preserveAspectRatio="xMidYMid meet"
    >
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

      {/* ── Arcs ──────────────────────────────────────────────────────────── */}
      {layoutNet.arcs.map((arc, i) => {
        const d = arcPath(arc.from, arc.to, layout);
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

      {/* ── Places ────────────────────────────────────────────────────────── */}
      {def.places.map((placeId) => {
        const pos = layout.get(placeId);
        if (!pos) return null;
        const placeTokens = tokens[placeId] ?? [];
        const count = placeTokens.length;
        const hasTokens = count > 0;

        return (
          <g key={placeId}>
            <circle
              cx={pos.x}
              cy={pos.y}
              r={PLACE_RADIUS}
              className={hasTokens ? 'p3n-place-circle p3n-place-active' : 'p3n-place-circle'}
            />
            <text
              x={pos.x}
              y={pos.y + PLACE_RADIUS + 15}
              className="p3n-label"
              textAnchor="middle"
            >
              {placeId}
            </text>

            {/* Token dots or count */}
            {count > 0 && count <= 5 && (
              TOKEN_POSITIONS[count - 1].map(([dx, dy], i) => (
                <circle
                  key={i}
                  cx={pos.x + dx}
                  cy={pos.y + dy}
                  r={TOKEN_R}
                  className="p3n-token-dot"
                />
              ))
            )}
            {count > 5 && (
              <text
                x={pos.x}
                y={pos.y + 5}
                className="p3n-token-count"
                textAnchor="middle"
              >
                {count}
              </text>
            )}
          </g>
        );
      })}

      {/* ── Transitions ───────────────────────────────────────────────────── */}
      {def.transitions.map((t) => {
        const pos = layout.get(t.id);
        if (!pos) return null;
        return (
          <g key={t.id}>
            <rect
              x={pos.x - TRANSITION_W / 2}
              y={pos.y - TRANSITION_H / 2}
              width={TRANSITION_W}
              height={TRANSITION_H}
              rx={4}
              className="p3n-transition-rect"
            />
            <text
              x={pos.x}
              y={pos.y + TRANSITION_H / 2 + 15}
              className="p3n-label"
              textAnchor="middle"
            >
              {t.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
