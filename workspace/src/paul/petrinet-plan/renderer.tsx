import { createMemo, For, onCleanup, onMount, Show } from 'solid-js';
import { computeLayout } from './layout';
import type { NetLayout } from './layout';
import type { NetDef, NetState, TokenState, TokenInstance } from './lib';
import type { TransitionFiring, AnimTokenInfo } from './lib';

const PLACE_RADIUS = 36;
const TRANSITION_W = 52;
const TRANSITION_H = 32;
const ARC_CURVE = 30;
const CANVAS_PAD = 200;
const LAYOUT_PAD = 80;
const ANIM_SPEED = 300;

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
      ...(t.fromAll ?? []).map((f) => ({ from: f, to: t.id, kind: 'in' as const })),
      ...t.to.map((to) => ({ from: t.id, to, kind: 'out' as const })),
    ]),
  };
}

function edgePoint(
  cx: number, cy: number,
  kind: 'place' | 'transition',
  ux: number, uy: number,
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

function arcPath(fromId: string, toId: string, layout: NetLayout, ox: number, oy: number): string | null {
  const fl = layout.get(fromId);
  const tl = layout.get(toId);
  if (!fl || !tl) return null;

  const fx = fl.x + ox, fy = fl.y + oy;
  const tx = tl.x + ox, ty = tl.y + oy;
  const dx = tx - fx, dy = ty - fy;
  const dist = Math.sqrt(dx * dx + dy * dy) || 1;
  const ux = dx / dist, uy = dy / dist;
  const px = -uy * ARC_CURVE, py = ux * ARC_CURVE;

  const [sx, sy] = edgePoint(fx, fy, fl.kind, ux, uy);
  const [ex, ey] = edgePoint(tx, ty, tl.kind, -ux, -uy, 6);
  const mx = (fx + tx) / 2 + px;
  const my = (fy + ty) / 2 + py;

  return `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`;
}

export function resolveTokenColor(state: TokenState, def: NetDef): string {
  if (def.getColor) return def.getColor(state);
  return def.tokenTypes.find((t) => t.id === state.type)?.color ?? '#6b7280';
}

export type DragPayload =
  | { kind: 'place'; tokenId: string; placeId: string }
  | { kind: 'palette'; typeId: string };

export const DRAG_KEY = 'application/p3n-token';

const TOKEN_R = 7;
const JITTER_R = 10;

function docOffset(documentUrl: string | undefined): { dx: number; dy: number } {
  if (!documentUrl) return { dx: 0, dy: 0 };
  let h = 0;
  for (let i = 0; i < documentUrl.length; i++) {
    h = (h * 31 + documentUrl.charCodeAt(i)) >>> 0;
  }
  const angle = ((h % 10000) / 10000) * Math.PI * 2;
  const r = (((h >>> 16) % 100) / 100) * JITTER_R;
  return {
    dx: Math.round(Math.cos(angle) * r),
    dy: Math.round(Math.sin(angle) * r),
  };
}

function dist2d(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
}

function animateEl(el: HTMLElement, keyframes: Keyframe[], durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    const anim = el.animate(keyframes, { duration: durationMs, fill: 'forwards', easing: 'ease-in-out' });
    anim.onfinish = () => resolve();
    anim.oncancel = () => resolve();
  });
}

function createFlyingToken(container: HTMLElement, color: string, cx: number, cy: number, opacity = 1): HTMLElement {
  const el = document.createElement('div');
  el.className = 'p3n-flying-token';
  el.style.cssText = `background:${color};opacity:${opacity};transform:translate(${cx - TOKEN_R}px,${cy - TOKEN_R}px)`;
  container.appendChild(el);
  return el;
}

function createHull(container: HTMLElement, cx: number, cy: number, r: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'p3n-token-hull';
  const size = r * 2;
  el.style.cssText = `width:${size}px;height:${size}px;transform:translate(${cx - r}px,${cy - r}px);opacity:0`;
  container.appendChild(el);
  return el;
}

type AnimLayerProps = {
  firings: TransitionFiring[];
  layout: NetLayout;
  offsetX: number;
  offsetY: number;
  def: NetDef;
  onRemoveInputs: () => void;
  onAddOutput: (id: string) => void;
  onComplete: () => void;
};

function AnimationLayer(props: AnimLayerProps) {
  let containerEl: HTMLDivElement | undefined;

  onMount(() => {
    if (!containerEl || props.firings.length === 0) return;
    const c = containerEl;
    let cancelled = false;
    const created: HTMLElement[] = [];

    function make(el: HTMLElement): HTMLElement { created.push(el); return el; }

    async function animateFiring(firing: TransitionFiring): Promise<void> {
      const tPos = props.layout.get(firing.transitionId);
      if (!tPos) return;
      const tx = tPos.x + props.offsetX;
      const ty = tPos.y + props.offsetY;

      const inputEls = firing.inputs.map((inp) => {
        const srcPos = props.layout.get(inp.placeId);
        const baseX = srcPos ? srcPos.x + props.offsetX : tx;
        const baseY = srcPos ? srcPos.y + props.offsetY : ty;
        const { dx, dy } = docOffset(inp.state.documentUrl);
        const sx = baseX + dx;
        const sy = baseY + dy;
        return { el: make(createFlyingToken(c, resolveTokenColor(inp.state, props.def), sx, sy)), sx, sy };
      });

      props.onRemoveInputs();

      await Promise.all(
        inputEls.map(({ el, sx, sy }) => {
          const d = dist2d(sx, sy, tx, ty);
          const duration = Math.max(200, (d / ANIM_SPEED) * 1000);
          return animateEl(el, [
            { transform: `translate(${sx - TOKEN_R}px,${sy - TOKEN_R}px)` },
            { transform: `translate(${tx - TOKEN_R}px,${ty - TOKEN_R}px)` },
          ], duration);
        }),
      );

      if (cancelled) return;

      const HULL_R = 20;
      const hull = make(createHull(c, tx, ty, HULL_R));
      await animateEl(hull, [
        { opacity: 0, transform: `translate(${tx - HULL_R * 0.7}px,${ty - HULL_R * 0.7}px) scale(0.7)` },
        { opacity: 1, transform: `translate(${tx - HULL_R}px,${ty - HULL_R}px) scale(1)` },
      ], 200);

      if (cancelled) return;

      const outputEls = firing.outputs.map((out) => {
        const dstPos = props.layout.get(out.placeId);
        const baseX = dstPos ? dstPos.x + props.offsetX : tx;
        const baseY = dstPos ? dstPos.y + props.offsetY : ty;
        const { dx, dy } = docOffset(out.state.documentUrl);
        return {
          el: make(createFlyingToken(c, resolveTokenColor(out.state, props.def), tx, ty, 0)),
          out,
          finalX: baseX + dx,
          finalY: baseY + dy,
        };
      });

      await Promise.all([
        ...inputEls.map(({ el }) => animateEl(el, [{ opacity: 1 }, { opacity: 0 }], 200)),
        ...outputEls.map(({ el }) => animateEl(el, [{ opacity: 0 }, { opacity: 1 }], 200)),
      ]);

      if (cancelled) return;

      await animateEl(hull, [{ opacity: 1 }, { opacity: 0 }], 150);

      if (cancelled) return;

      await Promise.all(
        outputEls.map(({ el, out, finalX, finalY }) => {
          const d = dist2d(tx, ty, finalX, finalY);
          const duration = Math.max(200, (d / ANIM_SPEED) * 1000);
          return animateEl(el, [
            { transform: `translate(${tx - TOKEN_R}px,${ty - TOKEN_R}px)` },
            { transform: `translate(${finalX - TOKEN_R}px,${finalY - TOKEN_R}px)` },
          ], duration).then(() => {
            if (!cancelled) props.onAddOutput(out.id);
          });
        }),
      );
    }

    Promise.all(props.firings.map((f) => animateFiring(f))).then(() => {
      if (!cancelled) props.onComplete();
    });

    onCleanup(() => {
      cancelled = true;
      for (const el of created) el.remove();
    });
  });

  return <div ref={containerEl} class="p3n-anim-layer" />;
}

export type RendererProps = {
  def: NetDef;
  tokens: NetState;
  selectedTokenId: string | null;
  onSelectToken: (id: string | null) => void;
  onDropOnPlace: (payload: DragPayload, placeId: string) => void;
  hiddenTokenIds?: Set<string>;
  animatingFirings?: TransitionFiring[];
  onAnimRemoveInputs?: () => void;
  onAnimAddOutput?: (id: string) => void;
  onAnimComplete?: () => void;
};

export function P3NetRenderer(props: RendererProps) {
  let containerEl: HTMLDivElement | undefined;

  const layoutNet = createMemo(() => toLayoutNet(props.def));
  const layout = createMemo(() => computeLayout(layoutNet()));

  const dims = createMemo(() => {
    const allPos = Array.from(layout().values());
    if (allPos.length === 0) {
      return { containerW: 600, containerH: 400, offsetX: CANVAS_PAD, offsetY: CANVAS_PAD };
    }
    const xs = allPos.map((p) => p.x);
    const ys = allPos.map((p) => p.y);
    const minX = Math.min(...xs) - LAYOUT_PAD - CANVAS_PAD;
    const minY = Math.min(...ys) - LAYOUT_PAD - CANVAS_PAD;
    const maxX = Math.max(...xs) + LAYOUT_PAD + CANVAS_PAD;
    const maxY = Math.max(...ys) + LAYOUT_PAD + CANVAS_PAD;
    return { containerW: maxX - minX, containerH: maxY - minY, offsetX: -minX, offsetY: -minY };
  });

  function handleTokenDragStart(e: DragEvent, payload: DragPayload) {
    e.stopPropagation();
    e.dataTransfer!.setData(DRAG_KEY, JSON.stringify(payload));
    e.dataTransfer!.effectAllowed = 'move';
  }

  function handlePlaceDrop(e: DragEvent, placeId: string) {
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer!.getData(DRAG_KEY);
    if (!raw) return;
    props.onDropOnPlace(JSON.parse(raw) as DragPayload, placeId);
  }

  const noop = () => {};
  const noopId = (_id: string) => {};

  return (
    <div
      ref={containerEl}
      class="p3n-net-container"
      style={{ width: `${dims().containerW}px`, height: `${dims().containerH}px` }}
      onClick={(e) => {
        if (!(e.target as Element).closest('.p3n-token')) props.onSelectToken(null);
      }}
    >
      <svg class="p3n-arc-layer" width={dims().containerW} height={dims().containerH}>
        <defs>
          <marker id="p3n-arrow" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M 0 0 L 10 4 L 0 8 z" fill="#94a3b8" />
          </marker>
        </defs>
        <For each={layoutNet().arcs}>
          {(arc) => {
            const d = arcPath(arc.from, arc.to, layout(), dims().offsetX, dims().offsetY);
            return d ? (
              <path d={d} fill="none" stroke="#94a3b8" stroke-width={1.5} marker-end="url(#p3n-arrow)" />
            ) : null;
          }}
        </For>
      </svg>

      <For each={props.def.places}>
        {(placeId) => {
          const pos = () => layout().get(placeId);
          const placeTokens = () =>
            (props.tokens[placeId] ?? []).filter((t) => !props.hiddenTokenIds?.has(t.id)) as TokenInstance[];

          return (
            <Show when={pos()}>
              {(p) => (
                <div
                  class="p3n-place"
                  style={{ left: `${p().x + dims().offsetX}px`, top: `${p().y + dims().offsetY}px` }}
                  onDragOver={(e) => { if (e.dataTransfer!.types.includes(DRAG_KEY)) { e.preventDefault(); e.stopPropagation(); } }}
                  onDrop={(e) => handlePlaceDrop(e, placeId)}
                >
                  <div class="p3n-place-tokens">
                    <For each={placeTokens()}>
                      {(t) => {
                        const offset = () => docOffset(t.state.documentUrl);
                        return (
                          <div
                            class={`p3n-token${t.id === props.selectedTokenId ? ' p3n-token-selected' : ''}`}
                            style={{
                              background: resolveTokenColor(t.state, props.def),
                              left: '50%',
                              top: '50%',
                              transform: `translate(calc(-50% + ${offset().dx}px), calc(-50% + ${offset().dy}px))`,
                            }}
                            draggable
                            onDragStart={(e) => handleTokenDragStart(e, { kind: 'place', tokenId: t.id, placeId })}
                            onClick={(e) => { e.stopPropagation(); props.onSelectToken(t.id); }}
                            title={t.id}
                          />
                        );
                      }}
                    </For>
                  </div>
                </div>
              )}
            </Show>
          );
        }}
      </For>

      <For each={props.def.places}>
        {(placeId) => {
          const pos = () => layout().get(placeId);
          return (
            <Show when={pos()}>
              {(p) => (
                <div
                  class="p3n-place-label"
                  style={{ left: `${p().x + dims().offsetX}px`, top: `${p().y + dims().offsetY + PLACE_RADIUS + 6}px` }}
                >
                  {placeId}
                </div>
              )}
            </Show>
          );
        }}
      </For>

      <For each={props.def.transitions}>
        {(t) => {
          const pos = () => layout().get(t.id);
          return (
            <Show when={pos()}>
              {(p) => (
                <div
                  class="p3n-transition"
                  style={{ left: `${p().x + dims().offsetX}px`, top: `${p().y + dims().offsetY}px` }}
                />
              )}
            </Show>
          );
        }}
      </For>

      <For each={props.def.transitions}>
        {(t) => {
          const pos = () => layout().get(t.id);
          return (
            <Show when={pos()}>
              {(p) => (
                <div
                  class="p3n-transition-label"
                  style={{ left: `${p().x + dims().offsetX}px`, top: `${p().y + dims().offsetY + TRANSITION_H / 2 + 8}px` }}
                >
                  {t.id}
                </div>
              )}
            </Show>
          );
        }}
      </For>

      <Show when={props.animatingFirings && props.animatingFirings.length > 0}>
        <AnimationLayer
          firings={props.animatingFirings!}
          layout={layout()}
          offsetX={dims().offsetX}
          offsetY={dims().offsetY}
          def={props.def}
          onRemoveInputs={props.onAnimRemoveInputs ?? noop}
          onAddOutput={props.onAnimAddOutput ?? noopId}
          onComplete={props.onAnimComplete ?? noop}
        />
      </Show>
    </div>
  );
}
