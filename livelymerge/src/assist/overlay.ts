/**
 * The ink layer: a canvas stacked above the LM canvas that shows the user's (and
 * later the AI's) disappearing ink and a small status badge. It takes pointer events
 * only while a session is active — that is how the session "steals" the mouse from
 * whatever UI is running underneath, without that UI knowing.
 *
 * The overlay is retina-scaled for crisp ink; the LM canvas underneath is 1x. All
 * stroke coordinates are LM canvas px; the overlay's transform maps them.
 */
import {
  FADE_MS,
  LINGER_MS,
  USER_INK_COLOR,
  USER_INK_WIDTH,
  dissolveAlpha,
  drawSmoothPath,
  type Stroke,
} from './ink';

interface LiveStroke {
  stroke: Stroke;
  color: string;
  width: number;
  /** performance.now() when the stroke ended; null while being drawn */
  endedAt: number | null;
}

export class InkOverlay {
  readonly el: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private strokes: LiveStroke[] = [];
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

  beginStroke(stroke: Stroke, color = USER_INK_COLOR, width = USER_INK_WIDTH): void {
    this.strokes.push({ stroke, color, width, endedAt: null });
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

  /** Instantly drop every stroke (session aborted / overlay disposed). */
  clear(): void {
    this.strokes = [];
    this.requestFrame();
  }

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
        alpha = dissolveAlpha(since);
        if (since < LINGER_MS + FADE_MS) animating = true;
        if (alpha <= 0) continue;
      } else {
        animating = true;
      }
      drawSmoothPath(ctx, s.stroke.points, s.color, s.width, alpha);
      keep.push(s);
    }
    this.strokes = keep;

    if (this.status) {
      this.drawStatus(ctx, now);
      animating = true;
    }
    if (animating) this.requestFrame();
  }

  private drawStatus(ctx: CanvasRenderingContext2D, now: number): void {
    const text = this.status!;
    const { width } = this.lmCanvas.getBoundingClientRect();
    ctx.save();
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    const padX = 10;
    const dotR = 4;
    const tw = ctx.measureText(text).width;
    const w = padX + dotR * 2 + 8 + tw + padX;
    const h = 26;
    const x = width - w - 12;
    const y = 12;
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
