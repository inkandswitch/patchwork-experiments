import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';

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

/** Which free corner/edge drives resize for a given snap. */
type ResizeKind =
  | 'corner-br'
  | 'corner-bl'
  | 'corner-tr'
  | 'corner-tl'
  | 'edge-bottom'
  | 'edge-top';

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

const DEFAULT_SIZE = { w: 288, h: 192 };
const MIN_SIZE = { w: 160, h: 100 };
const DEFAULT_ASPECT = DEFAULT_SIZE.w / DEFAULT_SIZE.h;

type Vec = { x: number; y: number };
type Size = { w: number; h: number };

/** Fit (w,h) to `aspect`, preferring the smaller scale (contain in the box). */
function fitAspect(w: number, h: number, aspect: number): Size {
  if (!(w > 0) || !(h > 0)) {
    return { w: MIN_SIZE.w, h: MIN_SIZE.w / aspect };
  }
  if (w / h > aspect) return { w: h * aspect, h };
  return { w, h: w / aspect };
}

/** Clamp size to min/max while keeping aspect ratio. */
function clampSizeKeepingAspect(
  w: number,
  h: number,
  aspect: number,
  maxW: number,
  maxH: number,
): Size {
  let fitted = fitAspect(w, h, aspect);
  const minScale = Math.max(MIN_SIZE.w / fitted.w, MIN_SIZE.h / fitted.h, 0);
  if (minScale > 1) {
    fitted = { w: fitted.w * minScale, h: fitted.h * minScale };
  }
  const maxScale = Math.min(maxW / fitted.w, maxH / fitted.h, 1);
  if (maxScale < 1) {
    fitted = { w: fitted.w * maxScale, h: fitted.h * maxScale };
  }
  return fitted;
}

function cornerBracketRotation(kind: ResizeKind): number {
  switch (kind) {
    case 'corner-br':
      return 0;
    case 'corner-bl':
      return 90;
    case 'corner-tl':
      return 180;
    case 'corner-tr':
      return 270;
    default:
      return 0;
  }
}

function snapStorageKey(docUrl?: string): string {
  return `space-time-monitor-snap:${docUrl ?? ''}`;
}

/** One preferred monitor size for this browser — not per document, not in Automerge. */
const MONITOR_SIZE_STORAGE_KEY = 'space-time-monitor-size';

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

function loadSize(): Size {
  try {
    const raw = localStorage.getItem(MONITOR_SIZE_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SIZE };
    const parsed = JSON.parse(raw) as Partial<Size>;
    const w = typeof parsed.w === 'number' ? parsed.w : DEFAULT_SIZE.w;
    const h = typeof parsed.h === 'number' ? parsed.h : DEFAULT_SIZE.h;
    return {
      w: Math.max(MIN_SIZE.w, w),
      h: Math.max(MIN_SIZE.h, h),
    };
  } catch {
    return { ...DEFAULT_SIZE };
  }
}

function saveSize(size: Size): void {
  try {
    localStorage.setItem(MONITOR_SIZE_STORAGE_KEY, JSON.stringify(size));
  } catch {
    /* ignore */
  }
}

function resizeKindForSnap(snap: SnapId): ResizeKind {
  switch (snap) {
    case 'top-left':
      return 'corner-br';
    case 'top-right':
      return 'corner-bl';
    case 'bottom-left':
      return 'corner-tr';
    case 'bottom-right':
      return 'corner-tl';
    case 'top-center':
      return 'edge-bottom';
    case 'bottom-center':
      return 'edge-top';
  }
}

function cursorForResize(kind: ResizeKind): string {
  switch (kind) {
    case 'corner-br':
    case 'corner-tl':
      return 'nwse-resize';
    case 'corner-bl':
    case 'corner-tr':
      return 'nesw-resize';
    case 'edge-bottom':
    case 'edge-top':
      return 'ns-resize';
  }
}

export function Monitor({ mountRef, loading, error, docUrl }: MonitorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<Vec>({ x: 0, y: 0 });
  const velRef = useRef<Vec>({ x: 0, y: 0 });
  const sizeRef = useRef<Size>(loadSize());
  const rafRef = useRef<number | null>(null);
  const snapRef = useRef<SnapId>(loadSnap(docUrl));
  const dragRef = useRef<{
    pointerId: number;
    grabX: number;
    grabY: number;
    samples: Array<{ t: number; x: number; y: number }>;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    kind: ResizeKind;
    startClientX: number;
    startClientY: number;
    startW: number;
    startH: number;
    aspect: number;
    anchorLeft: number;
    anchorRight: number;
    anchorTop: number;
    anchorBottom: number;
    centerX: number;
  } | null>(null);
  const [lifted, setLifted] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [resizing, setResizing] = useState(false);
  const [snapId, setSnapId] = useState<SnapId>(() => snapRef.current);
  const [size, setSize] = useState<Size>(() => ({ ...sizeRef.current }));

  const applyTransform = () => {
    const el = rootRef.current;
    if (!el) return;
    const scale = lifted ? 1.03 : 1;
    el.style.transform = `translate3d(${posRef.current.x}px, ${posRef.current.y}px, 0) scale(${scale})`;
  };

  const applySize = (next: Size) => {
    sizeRef.current = next;
    setSize(next);
  };

  const snapTargets = (mw = sizeRef.current.w, mh = sizeRef.current.h): Record<SnapId, Vec> | null => {
    const el = rootRef.current;
    const parent = el?.parentElement;
    if (!el || !parent) return null;
    const cw = parent.clientWidth;
    const ch = parent.clientHeight;
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

  const clampSize = (w: number, h: number, aspect = sizeRef.current.w / sizeRef.current.h): Size => {
    const parent = rootRef.current?.parentElement;
    const maxW = parent ? Math.max(MIN_SIZE.w, parent.clientWidth - 2 * SNAP_MARGIN) : 10_000;
    const maxH = parent ? Math.max(MIN_SIZE.h, parent.clientHeight - 2 * SNAP_MARGIN) : 10_000;
    const ratio = Number.isFinite(aspect) && aspect > 0 ? aspect : DEFAULT_ASPECT;
    return clampSizeKeepingAspect(w, h, ratio, maxW, maxH);
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
    setSnapId(best);
    saveSnap(docUrl, best);
    springTo(targets[best]);
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (resizeRef.current) return;
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
    const resize = resizeRef.current;
    if (resize && event.pointerId === resize.pointerId) {
      const dx = event.clientX - resize.startClientX;
      const dy = event.clientY - resize.startClientY;
      const aspect = resize.aspect;
      let nextW = resize.startW;
      let nextH = resize.startH;
      switch (resize.kind) {
        case 'corner-br':
          nextW = resize.startW + dx;
          nextH = resize.startH + dy;
          break;
        case 'corner-bl':
          nextW = resize.startW - dx;
          nextH = resize.startH + dy;
          break;
        case 'corner-tr':
          nextW = resize.startW + dx;
          nextH = resize.startH - dy;
          break;
        case 'corner-tl':
          nextW = resize.startW - dx;
          nextH = resize.startH - dy;
          break;
        case 'edge-bottom':
          // Height from the free edge; width follows aspect (centered).
          nextH = resize.startH + dy;
          nextW = nextH * aspect;
          break;
        case 'edge-top':
          nextH = resize.startH - dy;
          nextW = nextH * aspect;
          break;
      }
      if (resize.kind.startsWith('corner-')) {
        ({ w: nextW, h: nextH } = fitAspect(nextW, nextH, aspect));
      }
      const clamped = clampSize(nextW, nextH, aspect);
      applySize(clamped);
      switch (resize.kind) {
        case 'corner-br':
          posRef.current = { x: resize.anchorLeft, y: resize.anchorTop };
          break;
        case 'corner-bl':
          posRef.current = { x: resize.anchorRight - clamped.w, y: resize.anchorTop };
          break;
        case 'corner-tr':
          posRef.current = { x: resize.anchorLeft, y: resize.anchorBottom - clamped.h };
          break;
        case 'corner-tl':
          posRef.current = {
            x: resize.anchorRight - clamped.w,
            y: resize.anchorBottom - clamped.h,
          };
          break;
        case 'edge-bottom':
          posRef.current = { x: resize.centerX - clamped.w / 2, y: resize.anchorTop };
          break;
        case 'edge-top':
          posRef.current = {
            x: resize.centerX - clamped.w / 2,
            y: resize.anchorBottom - clamped.h,
          };
          break;
      }
      applyTransform();
      return;
    }

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
    const resize = resizeRef.current;
    if (resize && event.pointerId === resize.pointerId) {
      resizeRef.current = null;
      setResizing(false);
      const el = rootRef.current;
      if (el) {
        try {
          el.releasePointerCapture(event.pointerId);
        } catch {
          /* ignore */
        }
      }
      saveSize(sizeRef.current);
      // Re-settle to the current snap with the new size (keeps docked edges flush).
      const targets = snapTargets();
      if (targets) {
        posRef.current = { ...targets[snapRef.current] };
        applyTransform();
      }
      const rect = el?.getBoundingClientRect();
      const over = !!rect &&
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      setHovered(over);
      return;
    }

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

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const el = rootRef.current;
    if (!el) return;
    cancelAnimation();
    velRef.current = { x: 0, y: 0 };
    dragRef.current = null;
    const kind = resizeKindForSnap(snapRef.current);
    const { w, h } = sizeRef.current;
    const p = posRef.current;
    el.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      kind,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startW: w,
      startH: h,
      aspect: w / h,
      anchorLeft: p.x,
      anchorRight: p.x + w,
      anchorTop: p.y,
      anchorBottom: p.y + h,
      centerX: p.x + w / 2,
    };
    setResizing(true);
    setLifted(false);
  };

  // Position at the current snap on mount, and re-anchor to it when the canvas
  // resizes (unless the user is actively dragging/throwing it).
  useLayoutEffect(() => {
    const settleToSnap = () => {
      if (dragRef.current || resizeRef.current || rafRef.current !== null) return;
      const clamped = clampSize(sizeRef.current.w, sizeRef.current.h);
      if (clamped.w !== sizeRef.current.w || clamped.h !== sizeRef.current.h) {
        applySize(clamped);
        saveSize(clamped);
      }
      const targets = snapTargets(clamped.w, clamped.h);
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

  const resizeKind = resizeKindForSnap(snapId);
  const showHandle = hovered || resizing;
  const isEdge = resizeKind === 'edge-bottom' || resizeKind === 'edge-top';

  const handlePosition = ((): CSSProperties => {
    const base: CSSProperties = {
      touchAction: 'none',
      cursor: cursorForResize(resizeKind),
      opacity: showHandle ? 1 : 0,
      pointerEvents: showHandle ? 'auto' : 'none',
      transition: resizing ? undefined : 'opacity 120ms ease',
    };
    switch (resizeKind) {
      case 'corner-br':
        return { ...base, right: 0, bottom: 0 };
      case 'corner-bl':
        return { ...base, left: 0, bottom: 0 };
      case 'corner-tr':
        return { ...base, right: 0, top: 0 };
      case 'corner-tl':
        return { ...base, left: 0, top: 0 };
      case 'edge-bottom':
        return { ...base, left: '50%', bottom: 0, transform: 'translateX(-50%)' };
      case 'edge-top':
        return { ...base, left: '50%', top: 0, transform: 'translateX(-50%)' };
    }
  })();

  return (
    <div
      ref={rootRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        if (!resizing) setHovered(false);
      }}
      className={`st-monitor pointer-events-auto absolute left-0 top-0 z-20 flex items-center justify-center overflow-hidden rounded-lg border border-base-300 bg-black leading-[0] ${
        lifted ? 'cursor-grabbing shadow-2xl' : 'cursor-grab shadow-lg'
      }`}
      style={{
        touchAction: 'none',
        willChange: 'transform',
        transformOrigin: 'center',
        width: size.w,
        height: size.h,
      }}
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
      <div
        role="separator"
        aria-label="Resize monitor"
        onPointerDown={onResizePointerDown}
        className={`absolute z-10 flex items-center justify-center ${
          isEdge ? 'h-4 w-12' : 'h-5 w-5'
        }`}
        style={handlePosition}
      >
        {isEdge ? (
          // Free-edge grip: short capsule with a centered ridge.
          <div className="flex h-1.5 w-8 items-center justify-center rounded-full bg-white/85 shadow-sm ring-1 ring-black/25">
            <div className="h-0.5 w-3.5 rounded-full bg-black/40" />
          </div>
        ) : (
          // Corner L-bracket — reads clearly as a window resize affordance.
          <div
            className="h-3 w-3 border-white/90"
            style={{
              borderBottomWidth: 2.5,
              borderRightWidth: 2.5,
              borderBottomStyle: 'solid',
              borderRightStyle: 'solid',
              transform: `rotate(${cornerBracketRotation(resizeKind)}deg)`,
              filter: 'drop-shadow(0 0 1.5px rgba(0,0,0,0.65))',
            }}
          />
        )}
      </div>
    </div>
  );
}
