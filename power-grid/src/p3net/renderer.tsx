import React, { useMemo, useRef, useCallback, useEffect } from 'react';
import { computeLayout } from './layout';
import type { NetLayout } from './layout';
import type { NetDef, NetState, TokenTypeDef, TokenState, TokenInstance } from './lib';
import type { TransitionFiring, AnimTokenInfo } from './lib';
import type { CanvasToken } from './doc';

// ─── Constants ────────────────────────────────────────────────────────────────

const PLACE_RADIUS = 36;
const TRANSITION_W = 52;
const TRANSITION_H = 32;
const ARC_CURVE = 30;
const CANVAS_PAD = 200;
const LAYOUT_PAD = 80;
const ANIM_SPEED = 300; // px/s — constant token travel speed

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

// ─── Animation helpers ────────────────────────────────────────────────────────

function dist2d(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
}

/** Returns a Promise that resolves when the Animation finishes. */
function animateEl(
  el: HTMLElement,
  keyframes: Keyframe[],
  durationMs: number,
): Promise<void> {
  return new Promise((resolve) => {
    const anim = el.animate(keyframes, {
      duration: durationMs,
      fill: 'forwards',
      easing: 'ease-in-out',
    });
    anim.onfinish = () => resolve();
    anim.oncancel = () => resolve();
  });
}

/** Creates a flying-token div at the given center (x, y) in the container. */
function createFlyingToken(
  container: HTMLElement,
  color: string,
  cx: number,
  cy: number,
  opacity = 1,
): HTMLElement {
  const el = document.createElement('div');
  el.className = 'p3n-flying-token';
  el.style.cssText = `background:${color};opacity:${opacity};transform:translate(${cx - 7}px,${cy - 7}px)`;
  container.appendChild(el);
  return el;
}

/** Creates a hull circle centred at (cx, cy) with given radius. */
function createHull(container: HTMLElement, cx: number, cy: number, r: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'p3n-token-hull';
  const size = r * 2;
  el.style.cssText = `width:${size}px;height:${size}px;transform:translate(${cx - r}px,${cy - r}px);opacity:0`;
  container.appendChild(el);
  return el;
}

// ─── Animation layer ──────────────────────────────────────────────────────────

interface AnimationLayerProps {
  firings: TransitionFiring[];
  layout: NetLayout;
  offsetX: number;
  offsetY: number;
  def: NetDef;
  onRemoveInputs: () => void;
  onAddOutput: (id: string) => void;
  onComplete: () => void;
}

function AnimationLayer({
  firings,
  layout,
  offsetX,
  offsetY,
  def,
  onRemoveInputs,
  onAddOutput,
  onComplete,
}: AnimationLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Stable refs so the effect doesn't need to re-run when callbacks change
  const onRemoveInputsRef = useRef(onRemoveInputs);
  const onAddOutputRef = useRef(onAddOutput);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => { onRemoveInputsRef.current = onRemoveInputs; }, [onRemoveInputs]);
  useEffect(() => { onAddOutputRef.current = onAddOutput; }, [onAddOutput]);
  useEffect(() => { onCompleteRef.current = onComplete; }, [onComplete]);

  useEffect(() => {
    const container: HTMLElement | null = containerRef.current;
    if (!container || firings.length === 0) return;
    // Capture as non-null for use inside async callbacks
    const c = container;

    let cancelled = false;
    const created: HTMLElement[] = [];

    function make(el: HTMLElement): HTMLElement {
      created.push(el);
      return el;
    }

    async function animateFiring(firing: TransitionFiring): Promise<void> {
      const tPos = layout.get(firing.transitionId);
      if (!tPos) return;
      const tx = tPos.x + offsetX;
      const ty = tPos.y + offsetY;

      // ── Phase 1: input tokens fly to transition center ──────────────────
      const inputEls = firing.inputs.map((inp) => {
        const srcPos = layout.get(inp.placeId);
        const sx = srcPos ? srcPos.x + offsetX : tx;
        const sy = srcPos ? srcPos.y + offsetY : ty;
        const color = resolveTokenColor(inp.state, def);
        return { el: make(createFlyingToken(c, color, sx, sy)), sx, sy };
      });

      onRemoveInputsRef.current();

      await Promise.all(
        inputEls.map(({ el, sx, sy }) => {
          const d = dist2d(sx, sy, tx, ty);
          const duration = Math.max(200, (d / ANIM_SPEED) * 1000);
          return animateEl(el, [
            { transform: `translate(${sx - 7}px,${sy - 7}px)` },
            { transform: `translate(${tx - 7}px,${ty - 7}px)` },
          ], duration);
        }),
      );

      if (cancelled) return;

      // ── Phase 2: hull fades in ──────────────────────────────────────────
      const HULL_R = 20;
      const hull = make(createHull(c, tx, ty, HULL_R));
      await animateEl(hull, [{ opacity: 0, transform: `translate(${tx - HULL_R * 0.7}px,${ty - HULL_R * 0.7}px) scale(0.7)` }, { opacity: 1, transform: `translate(${tx - HULL_R}px,${ty - HULL_R}px) scale(1)` }], 200);

      if (cancelled) return;

      // ── Phase 3: inputs fade out, outputs fade in ───────────────────────
      const outputEls = firing.outputs.map((out) => {
        const color = resolveTokenColor(out.state, def);
        return { el: make(createFlyingToken(c, color, tx, ty, 0)), out };
      });

      await Promise.all([
        ...inputEls.map(({ el }) =>
          animateEl(el, [{ opacity: 1 }, { opacity: 0 }], 200),
        ),
        ...outputEls.map(({ el }) =>
          animateEl(el, [{ opacity: 0 }, { opacity: 1 }], 200),
        ),
      ]);

      if (cancelled) return;

      // ── Phase 4: hull fades out ─────────────────────────────────────────
      await animateEl(hull, [{ opacity: 1 }, { opacity: 0 }], 150);

      if (cancelled) return;

      // ── Phase 5: output tokens fly to destinations ──────────────────────
      await Promise.all(
        outputEls.map(({ el, out }) => {
          const dstPos = layout.get(out.placeId);
          const dx = dstPos ? dstPos.x + offsetX : tx;
          const dy = dstPos ? dstPos.y + offsetY : ty;
          const d = dist2d(tx, ty, dx, dy);
          const duration = Math.max(200, (d / ANIM_SPEED) * 1000);
          return animateEl(el, [
            { transform: `translate(${tx - 7}px,${ty - 7}px)` },
            { transform: `translate(${dx - 7}px,${dy - 7}px)` },
          ], duration).then(() => {
            if (!cancelled) onAddOutputRef.current(out.id);
          });
        }),
      );
    }

    Promise.all(firings.map((f) => animateFiring(f))).then(() => {
      if (!cancelled) onCompleteRef.current();
    });

    return () => {
      cancelled = true;
      for (const el of created) el.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firings]);

  return <div ref={containerRef} className="p3n-anim-layer" />;
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
  /** Token IDs to hide in their places during animation. */
  hiddenTokenIds?: Set<string>;
  /** Firings currently being animated. */
  animatingFirings?: TransitionFiring[];
  /** Called when the animation layer removes input tokens from the doc. */
  onAnimRemoveInputs?: () => void;
  /** Called when each output token lands at its destination. */
  onAnimAddOutput?: (id: string) => void;
  /** Called when all firing animations have completed. */
  onAnimComplete?: () => void;
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
  hiddenTokenIds,
  animatingFirings,
  onAnimRemoveInputs,
  onAnimAddOutput,
  onAnimComplete,
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

  // Stable no-op fallbacks so AnimationLayer always gets real functions
  const noop = useCallback(() => {}, []);
  const noopId = useCallback((_id: string) => {}, []);

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
        const placeTokens = (tokens[placeId] ?? []).filter(
          (t) => !hiddenTokenIds?.has(t.id),
        );

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
          />
        );
      })}

      {/* ── Transition labels ─────────────────────────────────────────────── */}
      {def.transitions.map((t) => {
        const pos = layout.get(t.id);
        if (!pos) return null;
        return (
          <div
            key={`tlbl-${t.id}`}
            className="p3n-transition-label"
            style={{ left: pos.x + offsetX, top: pos.y + offsetY + TRANSITION_H / 2 + 8 }}
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

      {/* ── Animation layer ──────────────────────────────────────────────── */}
      {animatingFirings && animatingFirings.length > 0 && (
        <AnimationLayer
          firings={animatingFirings}
          layout={layout}
          offsetX={offsetX}
          offsetY={offsetY}
          def={def}
          onRemoveInputs={onAnimRemoveInputs ?? noop}
          onAddOutput={onAnimAddOutput ?? noopId}
          onComplete={onAnimComplete ?? noop}
        />
      )}
    </div>
  );
}
