import type { PetriNet } from './net';
import type { NetLayout } from './layout';

// ─── Constants ────────────────────────────────────────────────────────────────

const PLACE_RADIUS = 36;
const TRANSITION_W = 52;
const TRANSITION_H = 32;
const ARC_CURVE = 30;

// ─── Arc path helpers ─────────────────────────────────────────────────────────

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

// ─── Renderer component ───────────────────────────────────────────────────────

interface RendererProps {
  net: PetriNet;
  layout: NetLayout;
}

export function PetriNetRenderer({ net, layout }: RendererProps) {
  const allPos = Array.from(layout.values());
  const pad = 80;
  const xs = allPos.map(p => p.x);
  const ys = allPos.map(p => p.y);
  const minX = (xs.length > 0 ? Math.min(...xs) : 0) - pad;
  const minY = (ys.length > 0 ? Math.min(...ys) : 0) - pad;
  const maxX = (xs.length > 0 ? Math.max(...xs) : 400) + pad;
  const maxY = (ys.length > 0 ? Math.max(...ys) : 300) + pad;
  const vbWidth = Math.max(maxX - minX, 1);
  const vbHeight = Math.max(maxY - minY, 1);

  return (
    <svg
      className="pn-svg"
      viewBox={`${minX} ${minY} ${vbWidth} ${vbHeight}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <marker
          id="pn-arrow"
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
      {net.arcs.map((arc, i) => {
        const d = arcPath(arc.from, arc.to, layout);
        if (!d) return null;
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="#94a3b8"
            strokeWidth={1.5}
            markerEnd="url(#pn-arrow)"
          />
        );
      })}

      {/* ── Places ────────────────────────────────────────────────────────── */}
      {net.places.map(place => {
        const pos = layout.get(place.id);
        if (!pos) return null;
        return (
          <g key={place.id} className="pn-place">
            <circle
              cx={pos.x}
              cy={pos.y}
              r={PLACE_RADIUS}
              className="pn-place-circle"
            />
            <text
              x={pos.x}
              y={pos.y + PLACE_RADIUS + 15}
              className="pn-label"
              textAnchor="middle"
            >
              {place.id}
            </text>
          </g>
        );
      })}

      {/* ── Transitions ───────────────────────────────────────────────────── */}
      {net.transitions.map(t => {
        const pos = layout.get(t.id);
        if (!pos) return null;
        return (
          <g key={t.id} className="pn-transition">
            <rect
              x={pos.x - TRANSITION_W / 2}
              y={pos.y - TRANSITION_H / 2}
              width={TRANSITION_W}
              height={TRANSITION_H}
              rx={4}
              className="pn-transition-rect"
            />
            <text
              x={pos.x}
              y={pos.y + TRANSITION_H / 2 + 15}
              className="pn-label"
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
