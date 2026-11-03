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
}

const BUBBLE_FADE_MS = 400;
const BUBBLE_MAX_W = 260;
const BUBBLE_FONT = '13px system-ui, sans-serif';

export class InkOverlay {
  readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private strokes: LiveStroke[] = [];
  private bubbles: Bubble[] = [];
  private cursor: AiCursor | null = null;
  private cursorHiddenAt: number | null = null;
  private active = false;
  private status: string | null = null;
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

  setStatus(text: string | null): void {
    this.status = text;
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

  showBubble(b: Omit<Bubble, 'hiddenAt'>): void {
    this.bubbles = this.bubbles.filter((x) => x.id !== b.id);
    this.bubbles.push({ ...b, hiddenAt: null });
    this.requestFrame();
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

    if (this.status) {
      this.drawStatus(ctx, now);
      animating = true;
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

  private bubbleAnchor(b: Bubble): { x: number; y: number } {
    if (b.at) return b.at;
    if (this.cursor) return { x: this.cursor.x, y: this.cursor.y };
    const { width } = this.lmCanvas.getBoundingClientRect();
    return { x: width / 2, y: 90 };
  }

  private drawBubble(ctx: CanvasRenderingContext2D, b: Bubble, alpha: number): void {
    const { width: cw, height: ch } = this.lmCanvas.getBoundingClientRect();
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = BUBBLE_FONT;
    ctx.textBaseline = 'top';
    const pad = 10;
    const lines = wrapText(ctx, b.text, BUBBLE_MAX_W - pad * 2);
    const lineH = 17;
    const w = Math.min(BUBBLE_MAX_W, Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2);
    const h = lines.length * lineH + pad * 2;
    const a = this.bubbleAnchor(b);
    // Above and to the right of the anchor, kept inside the canvas.
    let x = a.x + 18;
    let y = a.y - h - 26;
    if (x + w > cw - 8) x = Math.max(8, a.x - w - 18);
    if (y < 8) y = Math.min(ch - h - 8, a.y + 30);
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.strokeStyle = AI_INK_COLOR;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 10);
    ctx.fill();
    ctx.stroke();
    // Tail: a triangle for speech, three shrinking circles for thought.
    const bx = Math.min(Math.max(a.x, x + 14), x + w - 14);
    const by = y + h;
    if (b.kind === 'speech') {
      ctx.beginPath();
      ctx.moveTo(bx - 7, by - 1);
      ctx.lineTo(a.x, a.y - 4);
      ctx.lineTo(bx + 7, by - 1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.96)';
      ctx.fillRect(bx - 6, by - 2, 12, 3);
    } else {
      for (const [f, r] of [
        [0.25, 5],
        [0.55, 3.5],
        [0.8, 2],
      ] as const) {
        ctx.beginPath();
        ctx.arc(bx + (a.x - bx) * f, by + (a.y - 6 - by) * f, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#222';
    lines.forEach((l, i) => ctx.fillText(l, x + pad, y + pad + i * lineH));
    ctx.restore();
  }

  private drawStatus(ctx: CanvasRenderingContext2D, now: number): void {
    const text = this.status!;
    // Bottom right: the top right belongs to the Automerge doc-stats widget.
    const { width, height } = this.lmCanvas.getBoundingClientRect();
    ctx.save();
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const padX = 10;
    const dotR = 4;
    const tw = ctx.measureText(text).width;
    const w = padX + dotR * 2 + 8 + tw + padX;
    const h = 26;
    const x = width - w - 12;
    const y = height - h - 12;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = USER_INK_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 13);
    ctx.fill();
    ctx.stroke();
    // Pulsing dot: 0.4..1 alpha on a ~1.2s cycle.
    const pulse = 0.7 + 0.3 * Math.sin((now / 1200) * Math.PI * 2);
    ctx.globalAlpha = pulse;
    ctx.fillStyle = USER_INK_COLOR;
    ctx.beginPath();
    ctx.arc(x + padX + dotR, y + h / 2, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#222';
    ctx.fillText(text, x + padX + dotR * 2 + 8, y + h / 2 + 0.5);
    ctx.restore();
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.ro?.disconnect();
    this.el.remove();
  }
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
