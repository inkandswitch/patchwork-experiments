import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

type MonitorProps = {
  mountRef: RefObject<HTMLDivElement>;
  loading: boolean;
  error: string | null;
  docUrl?: string;
};

type SnapId =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

const SNAP_IDS: SnapId[] = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

/** Gap kept between the monitor and the canvas edges at each snap position. */
const SNAP_MARGIN = 16;
/** How far ahead (seconds of travel) a throw is projected when picking a snap. */
const THROW_LOOKAHEAD_S = 0.16;
/** Spring pulling the monitor to its snap point: natural frequency + damping. */
const SPRING_OMEGA = 12;
const SPRING_ZETA = 0.72;

type Vec = { x: number; y: number };

function snapStorageKey(docUrl?: string): string {
  return `space-time-monitor-snap:${docUrl ?? ''}`;
}

function loadSnap(docUrl?: string): SnapId {
  try {
    const stored = localStorage.getItem(snapStorageKey(docUrl));
    if (stored && (SNAP_IDS as string[]).includes(stored)) return stored as SnapId;
  } catch {
    /* ignore */
  }
  return 'top-right';
}

function saveSnap(docUrl: string | undefined, id: SnapId): void {
  try {
    localStorage.setItem(snapStorageKey(docUrl), id);
  } catch {
    /* ignore */
  }
}

export function Monitor({ mountRef, loading, error, docUrl }: MonitorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<Vec>({ x: 0, y: 0 });
  const velRef = useRef<Vec>({ x: 0, y: 0 });
  const rafRef = useRef<number | null>(null);
  const snapRef = useRef<SnapId>(loadSnap(docUrl));
  const dragRef = useRef<{
    pointerId: number;
    grabX: number;
    grabY: number;
    samples: Array<{ t: number; x: number; y: number }>;
  } | null>(null);
  const [lifted, setLifted] = useState(false);

  const applyTransform = () => {
    const el = rootRef.current;
    if (!el) return;
    const scale = lifted ? 1.03 : 1;
    el.style.transform = `translate3d(${posRef.current.x}px, ${posRef.current.y}px, 0) scale(${scale})`;
  };

  const snapTargets = (): Record<SnapId, Vec> | null => {
    const el = rootRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return null;
    const cw = parent.clientWidth;
    const ch = parent.clientHeight;
    const mw = el.offsetWidth;
    const mh = el.offsetHeight;
    if (mw === 0 || mh === 0) return null;
    const leftX = SNAP_MARGIN;
    const centerX = (cw - mw) / 2;
    const rightX = cw - mw - SNAP_MARGIN;
    const topY = SNAP_MARGIN;
    const bottomY = ch - mh - SNAP_MARGIN;
    return {
      'top-left': { x: leftX, y: topY },
      'top-center': { x: centerX, y: topY },
      'top-right': { x: rightX, y: topY },
      'bottom-left': { x: leftX, y: bottomY },
      'bottom-center': { x: centerX, y: bottomY },
      'bottom-right': { x: rightX, y: bottomY },
    };
  };

  const cancelAnimation = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  // Spring the monitor toward `target`, carrying whatever velocity the throw
  // left it with. The spring is the "gravity" pulling it to the snap point;
  // the initial velocity is the momentum. Slightly underdamped for a playful
  // settle.
  const springTo = (target: Vec) => {
    cancelAnimation();
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      const p = posRef.current;
      const v = velRef.current;
      const ax = -2 * SPRING_ZETA * SPRING_OMEGA * v.x - SPRING_OMEGA * SPRING_OMEGA * (p.x - target.x);
      const ay = -2 * SPRING_ZETA * SPRING_OMEGA * v.y - SPRING_OMEGA * SPRING_OMEGA * (p.y - target.y);
      v.x += ax * dt;
      v.y += ay * dt;
      p.x += v.x * dt;
      p.y += v.y * dt;
      applyTransform();
      const speed = Math.hypot(v.x, v.y);
      const dist = Math.hypot(p.x - target.x, p.y - target.y);
      if (speed < 4 && dist < 0.5) {
        p.x = target.x;
        p.y = target.y;
        v.x = 0;
        v.y = 0;
        applyTransform();
        rafRef.current = null;
        setLifted(false);
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const throwToSnap = () => {
    const targets = snapTargets();
    if (!targets) {
      setLifted(false);
      return;
    }
    // Bias the choice toward where the throw is heading: project the current
    // position forward by the release velocity, then pick the nearest snap.
    const p = posRef.current;
    const v = velRef.current;
    const projected = {
      x: p.x + v.x * THROW_LOOKAHEAD_S,
      y: p.y + v.y * THROW_LOOKAHEAD_S,
    };
    let best: SnapId = snapRef.current;
    let bestDist = Infinity;
    for (const id of SNAP_IDS) {
      const t = targets[id];
      const d = (t.x - projected.x) ** 2 + (t.y - projected.y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = id;
      }
    }
    snapRef.current = best;
    saveSnap(docUrl, best);
    springTo(targets[best]);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const el = rootRef.current;
    if (!el) return;
    cancelAnimation();
    velRef.current = { x: 0, y: 0 };
    el.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      grabX: event.clientX - posRef.current.x,
      grabY: event.clientY - posRef.current.y,
      samples: [{ t: performance.now(), x: posRef.current.x, y: posRef.current.y }],
    };
    setLifted(true);
    event.preventDefault();
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    posRef.current = {
      x: event.clientX - drag.grabX,
      y: event.clientY - drag.grabY,
    };
    applyTransform();
    const now = performance.now();
    drag.samples.push({ t: now, x: posRef.current.x, y: posRef.current.y });
    while (drag.samples.length > 2 && now - drag.samples[0]!.t > 120) drag.samples.shift();
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    const el = rootRef.current;
    if (el) {
      try {
        el.releasePointerCapture(event.pointerId);
      } catch {
        /* ignore */
      }
    }
    // Velocity from the tail of the drag samples (~last 50ms) so a flick that
    // ends mid-motion still carries momentum.
    const samples = drag.samples;
    const last = samples[samples.length - 1]!;
    let ref = samples[0]!;
    for (let i = samples.length - 1; i >= 0; i--) {
      if (last.t - samples[i]!.t >= 50) {
        ref = samples[i]!;
        break;
      }
    }
    const dt = (last.t - ref.t) / 1000;
    velRef.current = dt > 0 ? { x: (last.x - ref.x) / dt, y: (last.y - ref.y) / dt } : { x: 0, y: 0 };
    throwToSnap();
  };

  // Position at the current snap on mount, and re-anchor to it when the canvas
  // resizes (unless the user is actively dragging/throwing it).
  useLayoutEffect(() => {
    const settleToSnap = () => {
      if (dragRef.current || rafRef.current !== null) return;
      const targets = snapTargets();
      if (!targets) return;
      posRef.current = { ...targets[snapRef.current] };
      applyTransform();
    };
    settleToSnap();
    const parent = rootRef.current?.parentElement;
    const ro = new ResizeObserver(() => settleToSnap());
    if (parent) ro.observe(parent);
    if (rootRef.current) ro.observe(rootRef.current);
    return () => {
      ro.disconnect();
      cancelAnimation();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the transform (specifically the lift scale) in sync when `lifted` flips.
  useLayoutEffect(() => {
    applyTransform();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lifted]);

  return (
    <div
      ref={rootRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className={`st-monitor pointer-events-auto absolute left-0 top-0 z-20 flex h-48 w-72 items-center justify-center overflow-hidden rounded-lg border border-base-300 bg-black leading-[0] ${
        lifted ? 'cursor-grabbing shadow-2xl' : 'cursor-grab shadow-lg'
      }`}
      style={{ touchAction: 'none', willChange: 'transform', transformOrigin: 'center' }}
    >
      <div ref={mountRef} className="pointer-events-none block origin-center [&_canvas]:block" />
      {loading && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white">
          Loading…
        </div>
      )}
      {error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-error/10 p-3 text-center text-xs text-error">
          {error}
        </div>
      )}
    </div>
  );
}
