/**
 * The ink layer: a canvas stacked above the LM canvas that shows the user's and the
 * AI's disappearing ink, the AI's cursor, its speech/thought bubbles, and a small
 * status badge. It takes pointer events only while a session is active — that is
 * how the session "steals" the mouse from whatever UI is running underneath,
 * without that UI knowing.
 *
 * The overlay is retina-scaled for crisp ink; the LM canvas underneath is 1x. All
 * coordinates are LM canvas px; the overlay's transform maps them.
 */
import {
  FADE_MS,
  LINGER_MS,
  USER_INK_COLOR,
  USER_INK_WIDTH,
  dissolveAlpha,
  drawSmoothPath,
  type InkPoint,
  type Stroke,
} from './ink';
import { AI_INK_COLOR } from './pen';

export interface StrokeOptions {
  color?: string;
  width?: number;
  /** ms a finished stroke stays fully visible before dissolving */
  linger?: number;
}

interface LiveStroke {
  stroke: Stroke;
  color: string;
  width: number;
  linger: number;
  /** performance.now() when the stroke ended; null while being drawn */
  endedAt: number | null;
}

export interface AiCursor {
  x: number;
  y: number;
  down: boolean;
}

export interface Bubble {
  id: string;
  kind: 'speech' | 'thought';
  text: string;
  /** anchor point (canvas px); null = the AI cursor, or a default spot */
  at: { x: number; y: number } | null;
  /** performance.now() when hide() was called; null while shown */
  hiddenAt: number | null;
  /** Chosen once, on first draw, avoiding the bubbles already up; then kept, so a
   *  bubble never jumps when a neighbour disappears. */
  rect?: { x: number; y: number; w: number; h: number; lines: string[] };
}

const BUBBLE_GAP = 8;

function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean {
  return a.x < b.x + b.w + BUBBLE_GAP && a.x + a.w + BUBBLE_GAP > b.x && a.y < b.y + b.h + BUBBLE_GAP && a.y + a.h + BUBBLE_GAP > b.y;
}

const BUBBLE_FADE_MS = 400;
const BUBBLE_MAX_W = 260;
const BUBBLE_FONT = '13px system-ui, sans-serif';
/** The dismiss button: a circle this big at a bubble's top-right corner, shown on hover. */
const BUBBLE_X_R = 9;

export class InkOverlay {
  readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private strokes: LiveStroke[] = [];
  private bubbles: Bubble[] = [];
  private cursor: AiCursor | null = null;
  private cursorHiddenAt: number | null = null;
  /** The bubble under the user's pointer (shows its ×). */
  private hoveredId: string | null = null;
  private swallowUp = false;
  private readonly hoverTarget: HTMLElement;
  private readonly onHoverMove = (e: PointerEvent) => this.hoverMove(e);
  private readonly onHoverDown = (e: PointerEvent) => this.hoverDown(e);
  private readonly onHoverUp = (e: PointerEvent) => this.hoverUp(e);
  private active = false;
  private rafId: number | null = null;
  private readonly ro: ResizeObserver | null;
  private disposed = false;

  constructor(private readonly lmCanvas: HTMLCanvasElement) {
    const el = document.createElement('canvas');
    el.className = 'lm-assist-overlay';
    el.tabIndex = -1;
    Object.assign(el.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      zIndex: '30',
      pointerEvents: 'none',
      touchAction: 'none',
      cursor: 'crosshair',
      outline: 'none',
    } as Partial<CSSStyleDeclaration>);
    lmCanvas.insertAdjacentElement('afterend', el);
    this.el = el;
    this.ctx = el.getContext('2d')!;
    this.syncSize();
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.syncSize()) : null;
    this.ro?.observe(lmCanvas);
    // Hover and the × click come from capture-phase listeners on the container: the
    // overlay itself ignores the pointer when idle (so the UI underneath keeps
    // working), and only a click on a bubble's × is taken away from the UI.
    this.hoverTarget = lmCanvas.parentElement ?? lmCanvas;
    this.hoverTarget.addEventListener('pointermove', this.onHoverMove, { capture: true });
    this.hoverTarget.addEventListener('pointerdown', this.onHoverDown, { capture: true });
    this.hoverTarget.addEventListener('pointerup', this.onHoverUp, { capture: true });
  }

  private pointIn(e: PointerEvent): { x: number; y: number } {
    const r = this.lmCanvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  /** Topmost shown bubble containing the point (with a margin for the ×), if any. */
  private bubbleAt(p: { x: number; y: number }): Bubble | null {
    for (let i = this.bubbles.length - 1; i >= 0; i--) {
      const b = this.bubbles[i];
      const r = b.rect;
      if (!r || b.hiddenAt != null) continue;
      if (p.x >= r.x - BUBBLE_X_R && p.x <= r.x + r.w + BUBBLE_X_R && p.y >= r.y - BUBBLE_X_R && p.y <= r.y + r.h) return b;
    }
    return null;
  }

  private onX(b: Bubble, p: { x: number; y: number }): boolean {
    const r = b.rect!;
    return Math.hypot(p.x - (r.x + r.w), p.y - r.y) <= BUBBLE_X_R + 3;
  }

  private hoverMove(e: PointerEvent): void {
    if (e.pointerId === 7777) return; // the AI's own pointer never hovers bubbles
    const b = this.bubbleAt(this.pointIn(e));
    const id = b ? b.id : null;
    if (id !== this.hoveredId) {
      this.hoveredId = id;
      this.requestFrame();
    }
  }

  private hoverDown(e: PointerEvent): void {
    if (e.pointerId === 7777) return;
    const p = this.pointIn(e);
    const b = this.bubbleAt(p);
    if (!b || !this.onX(b, p)) return;
    // Dismiss at once, and keep this click (and its release) from the UI underneath.
    this.bubbles = this.bubbles.filter((x) => x !== b);
    this.hoveredId = null;
    this.swallowUp = true;
    e.preventDefault();
    e.stopImmediatePropagation();
    this.requestFrame();
  }

  private hoverUp(e: PointerEvent): void {
    if (!this.swallowUp) return;
    this.swallowUp = false;
    e.preventDefault();
    e.stopImmediatePropagation();
  }

  private syncSize(): void {
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = this.lmCanvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (this.el.width !== w || this.el.height !== h) {
      this.el.width = w;
      this.el.height = h;
      this.requestFrame();
    }
  }

  /** While active the overlay owns the pointer. */
  setActive(active: boolean): void {
    this.active = active;
    this.el.style.pointerEvents = active ? 'auto' : 'none';
    this.requestFrame();
  }

  // ---- ink -----------------------------------------------------------------

  beginStroke(stroke: Stroke, opts: StrokeOptions = {}): void {
    this.strokes.push({
      stroke,
      color: opts.color ?? USER_INK_COLOR,
      width: opts.width ?? USER_INK_WIDTH,
      linger: opts.linger ?? LINGER_MS,
      endedAt: null,
    });
    this.requestFrame();
  }

  /** Points are appended to the Stroke object by the caller; this just redraws. */
  strokeChanged(): void {
    this.requestFrame();
  }

  endStroke(stroke: Stroke): void {
    const live = this.strokes.find((s) => s.stroke === stroke);
    if (live) live.endedAt = performance.now();
    this.requestFrame();
  }

  /** Every stroke still visible, with its color — for the agent's screenshot tool. */
  visibleStrokes(): { points: InkPoint[]; color: string }[] {
    const now = performance.now();
    return this.strokes
      .filter((s) => s.endedAt == null || dissolveAlpha(now - s.endedAt, s.linger) > 0)
      .map((s) => ({ points: s.stroke.points, color: s.color }));
  }

  /** Instantly drop every stroke, bubble and the cursor (session aborted / disposed). */
  clear(): void {
    this.strokes = [];
    this.bubbles = [];
    this.cursor = null;
    this.requestFrame();
  }

  // ---- AI cursor and bubbles ------------------------------------------------

  setAiCursor(c: AiCursor | null): void {
    if (c) {
      this.cursor = c;
      this.cursorHiddenAt = null;
    } else if (this.cursor && this.cursorHiddenAt == null) {
      this.cursorHiddenAt = performance.now();
    }
    this.requestFrame();
  }

  showBubble(b: Omit<Bubble, 'hiddenAt' | 'rect'>): void {
    this.bubbles = this.bubbles.filter((x) => x.id !== b.id);
    this.bubbles.push({ ...b, hiddenAt: null });
    this.requestFrame();
  }

  /**
   * Where a new bubble of size w×h goes. Anchored: the usual spot above-right of the
   * anchor, else the other three corners around it; unanchored: centered at the top.
   * Any spot that would overlap a bubble already up is skipped; failing all, it goes
   * below the lowest bubble it collides with.
   */
  private placeBubble(w: number, h: number, a: { x: number; y: number } | null, taken: { x: number; y: number; w: number; h: number }[]): { x: number; y: number } {
    const { width: cw, height: ch } = this.lmCanvas.getBoundingClientRect();
    const clamp = (p: { x: number; y: number }) => ({
      x: Math.min(Math.max(8, p.x), Math.max(8, cw - w - 8)),
      y: Math.min(Math.max(8, p.y), Math.max(8, ch - h - 8)),
    });
    const free = (p: { x: number; y: number }) => !taken.some((t) => overlaps({ x: p.x, y: p.y, w, h }, t));
    const candidates: { x: number; y: number }[] = a
      ? [
          { x: a.x + 18, y: a.y - h - 26 },
          { x: a.x - w - 18, y: a.y - h - 26 },
          { x: a.x + 18, y: a.y + 30 },
          { x: a.x - w - 18, y: a.y + 30 },
        ]
      : [{ x: (cw - w) / 2, y: 16 }];
    for (const c of candidates) {
      const p = clamp(c);
      if (free(p)) return p;
    }
    // Stack: step down past whatever is in the way, as far as the canvas allows.
    let p = clamp(candidates[0]);
    for (let i = 0; i < 20; i++) {
      const hit = taken.filter((t) => overlaps({ x: p.x, y: p.y, w, h }, t));
      if (hit.length === 0) return p;
      const below = Math.max(...hit.map((t) => t.y + t.h)) + BUBBLE_GAP;
      if (below + h > ch - 8) break;
      p = { x: p.x, y: below };
    }
    return p;
  }

  hideBubble(id: string): void {
    const b = this.bubbles.find((x) => x.id === id);
    if (b && b.hiddenAt == null) b.hiddenAt = performance.now();
    this.requestFrame();
  }

  // ---- drawing ---------------------------------------------------------------

  private requestFrame(): void {
    if (this.disposed || this.rafId != null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.draw();
    });
  }

  private draw(): void {
    const now = performance.now();
    const dpr = window.devicePixelRatio || 1;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.el.width, this.el.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let animating = false;
    const keep: LiveStroke[] = [];
    for (const s of this.strokes) {
      let alpha = 1;
      if (s.endedAt != null) {
        const since = now - s.endedAt;
        alpha = dissolveAlpha(since, s.linger);
        if (since < s.linger + FADE_MS) animating = true;
        if (alpha <= 0) continue;
      } else {
        animating = true;
      }
      drawSmoothPath(ctx, s.stroke.points, s.color, s.width, alpha);
      keep.push(s);
    }
    this.strokes = keep;

    const keepB: Bubble[] = [];
    for (const b of this.bubbles) {
      let alpha = 1;
      if (b.hiddenAt != null) {
        alpha = 1 - (now - b.hiddenAt) / BUBBLE_FADE_MS;
        if (alpha <= 0) continue;
        animating = true;
      }
      this.drawBubble(ctx, b, alpha);
      keepB.push(b);
    }
    this.bubbles = keepB;

    if (this.cursor) {
      let alpha = 1;
      if (this.cursorHiddenAt != null) {
        alpha = 1 - (now - this.cursorHiddenAt) / BUBBLE_FADE_MS;
        if (alpha <= 0) {
          this.cursor = null;
          this.cursorHiddenAt = null;
        } else animating = true;
      }
      if (this.cursor) this.drawCursor(ctx, this.cursor, alpha);
    }

    if (animating) this.requestFrame();
  }

  private drawCursor(ctx: CanvasRenderingContext2D, c: AiCursor, alpha: number): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(c.x, c.y);
    if (c.down) {
      ctx.strokeStyle = AI_INK_COLOR;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 9, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Classic arrow pointer.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(4, 12.5);
    ctx.lineTo(7, 19);
    ctx.lineTo(9.5, 18);
    ctx.lineTo(6.5, 11.5);
    ctx.lineTo(11.5, 11.5);
    ctx.closePath();
    ctx.fillStyle = AI_INK_COLOR;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.fill();
    ctx.stroke();
    ctx.font = 'bold 9px system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#fff';
    ctx.fillRect(12, 16, 18, 12);
    ctx.fillStyle = AI_INK_COLOR;
    ctx.fillText('AI', 14, 18);
    ctx.restore();
  }

  /** Where a bubble's tail points: its own `at`, else the AI cursor, else nowhere. */
  private bubbleAnchor(b: Bubble): { x: number; y: number } | null {
    if (b.at) return b.at;
    if (this.cursor && this.cursorHiddenAt == null) return { x: this.cursor.x, y: this.cursor.y };
    return null;
  }

  private drawBubble(ctx: CanvasRenderingContext2D, b: Bubble, alpha: number): void {
    const { width: cw, height: ch } = this.lmCanvas.getBoundingClientRect();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = BUBBLE_FONT;
    ctx.textBaseline = 'top';
    const pad = 10;
    const lineH = 17;
    const a = this.bubbleAnchor(b);
    if (!b.rect) {
      const lines = wrapText(ctx, b.text, BUBBLE_MAX_W - pad * 2);
      const w = Math.min(BUBBLE_MAX_W, Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2);
      const h = lines.length * lineH + pad * 2;
      const taken = this.bubbles.filter((o) => o !== b && o.rect).map((o) => o.rect!);
      const p = this.placeBubble(w, h, a, taken);
      b.rect = { x: p.x, y: p.y, w, h, lines };
    }
    const { x, y, w, h, lines } = b.rect;
    void cw;
    void ch;

    // The tail starts on the edge facing the anchor and is short (≤ 22 px): a bubble
    // far from its anchor gets a stub pointing the right way, never a long spike.
    const tail = a ? bubbleTail(x, y, w, h, a) : null;
    const body = () => {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 10);
    };
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.strokeStyle = AI_INK_COLOR;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    if (tail && b.kind === 'speech') {
      ctx.beginPath();
      ctx.moveTo(tail.b1.x, tail.b1.y);
      ctx.lineTo(tail.tip.x, tail.tip.y);
      ctx.lineTo(tail.b2.x, tail.b2.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    body();
    ctx.fill();
    ctx.stroke();
    if (tail && b.kind === 'speech') {
      // Hide the body's border where the tail joins it.
      ctx.beginPath();
      ctx.moveTo(tail.b1.x, tail.b1.y);
      ctx.lineTo(tail.tip.x, tail.tip.y);
      ctx.lineTo(tail.b2.x, tail.b2.y);
      ctx.closePath();
      ctx.fill();
    }
    if (tail && b.kind === 'thought') {
      for (const [d, r] of [
        [8, 4.5],
        [18, 3],
        [27, 2],
      ] as const) {
        ctx.beginPath();
        ctx.arc(tail.base.x + tail.dir.x * d, tail.base.y + tail.dir.y * d, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#222';
    lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * lineH));
    if (b.id === this.hoveredId) {
      // The dismiss button, at the top-right corner.
      const cx = x + w;
      const cy = y;
      ctx.beginPath();
      ctx.arc(cx, cy, BUBBLE_X_R, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = AI_INK_COLOR;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cx - 3.5, cy - 3.5);
      ctx.lineTo(cx + 3.5, cy + 3.5);
      ctx.moveTo(cx + 3.5, cy - 3.5);
      ctx.lineTo(cx - 3.5, cy + 3.5);
      ctx.stroke();
    }
    ctx.restore();
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.ro?.disconnect();
    this.hoverTarget.removeEventListener('pointermove', this.onHoverMove, { capture: true });
    this.hoverTarget.removeEventListener('pointerdown', this.onHoverDown, { capture: true });
    this.hoverTarget.removeEventListener('pointerup', this.onHoverUp, { capture: true });
    this.el.remove();
  }
}

/** Tail geometry for a bubble at (x, y, w, h) pointing at `a`; null when `a` is inside. */
export function bubbleTail(
  x: number,
  y: number,
  w: number,
  h: number,
  a: { x: number; y: number },
): { base: { x: number; y: number }; b1: { x: number; y: number }; b2: { x: number; y: number }; tip: { x: number; y: number }; dir: { x: number; y: number } } | null {
  const inside = a.x >= x && a.x <= x + w && a.y >= y && a.y <= y + h;
  if (inside) return null;
  const clampX = Math.min(Math.max(a.x, x + 16), x + w - 16);
  const clampY = Math.min(Math.max(a.y, y + 16), y + h - 16);
  let base: { x: number; y: number };
  let along: { x: number; y: number }; // unit vector along the edge
  if (a.y > y + h) {
    base = { x: clampX, y: y + h };
    along = { x: 1, y: 0 };
  } else if (a.y < y) {
    base = { x: clampX, y };
    along = { x: 1, y: 0 };
  } else if (a.x < x) {
    base = { x, y: clampY };
    along = { x: 0, y: 1 };
  } else {
    base = { x: x + w, y: clampY };
    along = { x: 0, y: 1 };
  }
  const dx = a.x - base.x;
  const dy = a.y - base.y;
  const dist = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / dist, y: dy / dist };
  const len = Math.min(22, dist - 4);
  const half = 6;
  return {
    base,
    dir,
    b1: { x: base.x - along.x * half, y: base.y - along.y * half },
    b2: { x: base.x + along.x * half, y: base.y + along.y * half },
    tip: { x: base.x + dir.x * Math.max(len, 6), y: base.y + dir.y * Math.max(len, 6) },
  };
}

export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const trial = line ? line + ' ' + word : word;
      if (ctx.measureText(trial).width > maxW && line) {
        lines.push(line);
        line = word;
      } else line = trial;
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}
