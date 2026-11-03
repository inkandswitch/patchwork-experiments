/**
 * Runs the AI's script: an ordered list of steps — raw mouse/keyboard events, pen
 * strokes, speech with word-anchored sub-steps, bubbles, eval, screenshot. The
 * host paces everything over real time (so the UI's 30 Hz frame loop sees a
 * drag as many frames, and ink appears as a gesture) and returns one result per
 * step plus a final screenshot. One `perform` call is one model turn (M4).
 *
 * All coordinates in a script are IMAGE pixels (what the model saw); `scale` maps
 * them to canvas pixels. Hand-written scripts from the console use scale 1.
 */
import { AI_INK_COLOR, AI_INK_WIDTH, animatePath, naturalDurationMs, shapeToPaths, type PenShape, type PenStyle, type Pt } from './pen';
import { SyntheticInput, sleep, type Modifiers } from './events';
import type { Stroke } from './ink';
import type { InkOverlay } from './overlay';
import { parseAnchors, speak, type SpeakOptions } from './say';
import { compositeSnapshot, imageScale, type Snapshot } from './snapshot';

export type Step =
  | { type: 'mouse_move'; x: number; y: number; duration?: number; modifiers?: Modifiers }
  | { type: 'mouse_down'; button?: number; modifiers?: Modifiers }
  | { type: 'mouse_up'; button?: number; modifiers?: Modifiers }
  | { type: 'scroll'; dx: number; dy: number; x?: number; y?: number; modifiers?: Modifiers }
  | { type: 'key_down'; key: string; code?: string; modifiers?: Modifiers }
  | { type: 'key_up'; key: string; code?: string; modifiers?: Modifiers }
  | { type: 'type'; text: string; perCharMs?: number }
  | { type: 'wait'; ms: number }
  | ({ type: 'pen'; duration?: number; style?: PenStyle; linger?: number } & PenShape)
  | { type: 'say'; text: string; anchors?: Record<string, Step[]>; bubble?: boolean; rate?: number }
  | { type: 'speech_bubble'; text: string; at?: Pt; id?: string; hold?: boolean; duration?: number }
  | { type: 'thought_bubble'; text: string; at?: Pt; id?: string; hold?: boolean; duration?: number }
  | { type: 'dismiss'; id: string }
  | { type: 'eval'; source: string }
  | { type: 'screenshot' };

export interface StepResult {
  index: number;
  type: Step['type'];
  ok: boolean;
  value?: unknown;
  error?: string;
  ms: number;
}

export interface PerformResult {
  steps: StepResult[];
  canceled: boolean;
  screenshot: Snapshot;
}

export interface PerformOptions {
  /** image px → canvas px divisor; defaults to the executor's current scale */
  scale?: number;
  penStyle?: PenStyle;
  speak?: SpeakOptions;
}

const CURSOR_HIDE_MS = 1500;
/** settle(): give up waiting for the canvas to stop changing after this long. */
const SETTLE_MAX_MS = 500;
const SETTLE_POLL_MS = 50;

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * Waits for the UI to catch up with the events we dispatched: LM UIs drain their
 * input queue and redraw on a 30 Hz frame loop, so a screenshot taken right after
 * the last event shows the state BEFORE it (the model then concludes "nothing
 * happened"). Two frames let the queue drain and render; then the canvas is
 * sampled at low resolution until two consecutive samples match, capped so a
 * running animation can't stall us.
 */
export async function settle(lmCanvas: HTMLCanvasElement, maxMs = SETTLE_MAX_MS): Promise<void> {
  await nextFrame();
  await nextFrame();
  const w = 64;
  const h = Math.max(1, Math.round((w * lmCanvas.height) / Math.max(1, lmCanvas.width)));
  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const sample = () => {
    ctx.drawImage(lmCanvas, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h).data;
  };
  const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 4) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) return false;
    return true;
  };
  const start = performance.now();
  let prev = sample();
  while (performance.now() - start < maxMs) {
    await sleep(SETTLE_POLL_MS);
    const cur = sample();
    if (same(prev, cur)) return;
    prev = cur;
  }
}

export class Executor {
  /** image → canvas: canvas = image / scale. Set per session from its ImageScale. */
  scale = 1;
  /** Skip ahead: speech is cut (anchored steps still fire), pen strokes and waits
   *  complete at once, mouse moves take a couple of frames. Cleared when the
   *  performance ends unless `holdFastForward` is set (the agent holds it for a run). */
  fastForward = false;
  holdFastForward = false;
  penStyle: PenStyle = 'crisp';
  speakOptions: SpeakOptions = {};
  private readonly input: SyntheticInput;
  private canceled = false;
  private running = 0;
  private bubbleSeq = 0;
  private strokeSeq = -1;
  private cursorTimer: number | null = null;

  constructor(
    private readonly lmCanvas: HTMLCanvasElement,
    private readonly overlay: InkOverlay,
  ) {
    this.input = new SyntheticInput(lmCanvas, (s) => overlay.setAiCursor({ x: s.x, y: s.y, down: s.buttons !== 0 }));
  }

  get runtime(): any {
    return (window as any).runtime;
  }

  isRunning(): boolean {
    return this.running > 0;
  }

  /** Stops the current performance: speech, animations, and any held mouse button. */
  cancel(): void {
    if (!this.running) return;
    this.canceled = true;
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
    this.input.releaseAll();
  }

  async perform(script: Step[], opts: PerformOptions = {}): Promise<PerformResult> {
    const scale = opts.scale ?? this.scale;
    const style = opts.penStyle ?? this.penStyle;
    const speakOpts = { ...this.speakOptions, ...(opts.speak ?? {}) };
    if (this.running) this.cancel();
    while (this.running) await sleep(20);
    this.canceled = false;
    this.running++;
    if (this.cursorTimer != null) clearTimeout(this.cursorTimer);
    const results: StepResult[] = [];
    try {
      await this.runSteps(script, { scale, style, speakOpts, hintMs: 0 }, results);
    } finally {
      this.running--;
      if (!this.holdFastForward) this.fastForward = false;
      this.input.releaseAll();
      this.cursorTimer = window.setTimeout(() => this.overlay.setAiCursor(null), CURSOR_HIDE_MS);
    }
    return { steps: results, canceled: this.canceled, screenshot: await this.captureScreenshot(scale, 'after perform') };
  }

  /** A screenshot for the model: waits for the UI to settle first (see settle). */
  async captureScreenshot(scale: number, label: string): Promise<Snapshot> {
    await settle(this.lmCanvas);
    return this.takeScreenshot(scale, label);
  }

  /** The canvas plus whatever ink is visible, at the given image scale — right now. */
  takeScreenshot(scale: number, label: string): Snapshot {
    const img = imageScale(this.lmCanvas.width, this.lmCanvas.height);
    img.scale = scale;
    img.width = Math.max(1, Math.round(this.lmCanvas.width * scale));
    img.height = Math.max(1, Math.round(this.lmCanvas.height * scale));
    return compositeSnapshot(this.lmCanvas, [], img, label, performance.now(), this.overlay.visibleStrokes());
  }

  private async runSteps(
    steps: readonly Step[],
    ctx: { scale: number; style: PenStyle; speakOpts: SpeakOptions; hintMs: number },
    results: StepResult[],
  ): Promise<void> {
    for (const step of steps) {
      if (this.canceled) return;
      const index = results.length;
      const r: StepResult = { index, type: step.type, ok: true, ms: 0 };
      results.push(r);
      const t = performance.now();
      try {
        r.value = await this.runStep(step, ctx, results);
      } catch (err) {
        r.ok = false;
        r.error = err instanceof Error ? err.message : String(err);
      }
      r.ms = performance.now() - t;
    }
  }

  private async runStep(
    step: Step,
    ctx: { scale: number; style: PenStyle; speakOpts: SpeakOptions; hintMs: number },
    results: StepResult[],
  ): Promise<unknown> {
    const s = ctx.scale;
    const cv = (v: number) => v / s;
    const cp = (p: Pt): Pt => ({ x: p.x / s, y: p.y / s });
    const isCanceled = () => this.canceled;
    const isFast = () => this.fastForward;
    switch (step.type) {
      case 'mouse_move':
        await this.input.move(cv(step.x), cv(step.y), step.duration, isCanceled, step.modifiers ?? {}, isFast);
        return undefined;
      case 'mouse_down':
        this.input.down(step.button ?? 0, step.modifiers ?? {});
        return undefined;
      case 'mouse_up':
        this.input.up(step.button ?? 0, step.modifiers ?? {});
        return undefined;
      case 'scroll':
        this.input.wheel(step.dx, step.dy, step.x != null ? cv(step.x) : undefined, step.y != null ? cv(step.y) : undefined, step.modifiers ?? {});
        return undefined;
      case 'key_down':
        this.input.keyDown(step.key, step.code, step.modifiers ?? {});
        return undefined;
      case 'key_up':
        this.input.keyUp(step.key, step.code, step.modifiers ?? {});
        return undefined;
      case 'type':
        await this.input.type(step.text, step.perCharMs, isCanceled);
        return undefined;
      case 'wait': {
        // In chunks, so fast-forward and cancel cut a long wait short.
        const until = performance.now() + step.ms;
        while (performance.now() < until && !this.canceled && !this.fastForward) {
          await sleep(Math.min(50, until - performance.now()));
        }
        return undefined;
      }
      case 'pen':
        return this.pen(step, ctx);
      case 'say':
        return this.say(step, ctx, results);
      case 'speech_bubble':
      case 'thought_bubble': {
        const id = step.id ?? `b${++this.bubbleSeq}`;
        this.overlay.showBubble({
          id,
          kind: step.type === 'speech_bubble' ? 'speech' : 'thought',
          text: step.text,
          at: step.at ? cp(step.at) : null,
        });
        if (!step.hold) {
          const ms = step.duration ?? Math.max(1500, step.text.length * 60) + 2000;
          window.setTimeout(() => this.overlay.hideBubble(id), ms);
        }
        return id;
      }
      case 'dismiss':
        this.overlay.hideBubble(step.id);
        return undefined;
      case 'eval': {
        const rt = this.runtime;
        if (!rt || typeof rt.printIt !== 'function') throw new Error('no runtime');
        return rt.printIt(step.source);
      }
      case 'screenshot':
        return (await this.captureScreenshot(s, 'screenshot')).dataUrl;
    }
  }

  private async pen(
    step: Extract<Step, { type: 'pen' }>,
    ctx: { scale: number; style: PenStyle; hintMs: number },
  ): Promise<void> {
    const s = ctx.scale;
    const cp = (p: Pt): Pt => ({ x: p.x / s, y: p.y / s });
    let shape: PenShape;
    switch (step.shape) {
      case 'polyline':
        shape = { shape: 'polyline', points: step.points.map(cp) };
        break;
      case 'circle':
        shape = { shape: 'circle', center: cp(step.center), r: step.r / s };
        break;
      case 'arrow':
        shape = { shape: 'arrow', from: cp(step.from), to: cp(step.to) };
        break;
      case 'box':
        shape = { shape: 'box', x0: step.x0 / s, y0: step.y0 / s, x1: step.x1 / s, y1: step.y1 / s };
        break;
      case 'underline':
        shape = { shape: 'underline', from: cp(step.from), to: cp(step.to) };
        break;
    }
    const paths = shapeToPaths(shape, step.style ?? ctx.style);
    // No duration: the natural pace, stretched to the spoken span when anchored.
    const total = step.duration ?? Math.max(naturalDurationMs(paths), ctx.hintMs);
    const per = total / paths.length;
    for (const path of paths) {
      if (this.canceled) return;
      const stroke: Stroke = { id: this.strokeSeq--, points: [], t0: performance.now(), t1: null };
      this.overlay.beginStroke(stroke, { color: AI_INK_COLOR, width: AI_INK_WIDTH, linger: step.linger });
      await animatePath(
        path,
        per,
        (pts) => {
          for (const p of pts) stroke.points.push({ x: p.x, y: p.y, t: performance.now() });
          this.overlay.strokeChanged();
        },
        () => this.canceled,
        () => this.fastForward,
      );
      stroke.t1 = performance.now();
      this.overlay.endStroke(stroke);
    }
  }

  private async say(
    step: Extract<Step, { type: 'say' }>,
    ctx: { scale: number; style: PenStyle; speakOpts: SpeakOptions; hintMs: number },
    results: StepResult[],
  ): Promise<unknown> {
    const parsed = parseAnchors(step.text);
    const bubbleId = step.bubble ? `say${++this.bubbleSeq}` : null;
    if (bubbleId) this.overlay.showBubble({ id: bubbleId, kind: 'speech', text: parsed.text, at: null });
    const pending: Promise<void>[] = [];
    const cps = ctx.speakOpts.estimatedCharsPerSec ?? 15;
    await speak(
      parsed,
      {
        onSpanStart: (span) => {
          const steps = step.anchors?.[span.id];
          if (!steps) return;
          const hintMs = ((span.end - span.start) / cps) * 1000;
          pending.push(this.runSteps(steps, { ...ctx, hintMs }, results));
        },
      },
      { ...ctx.speakOpts, rate: step.rate ?? ctx.speakOpts.rate },
      () => this.canceled,
      () => this.fastForward,
    );
    await Promise.all(pending);
    if (bubbleId) window.setTimeout(() => this.overlay.hideBubble(bubbleId), 2000);
    return parsed.text;
  }
}
