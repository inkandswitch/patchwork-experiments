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
import { lastQueuedSpeech, parseAnchors, speak, stopAllSpeech, type SpeakOptions, type TtsClip } from './say';
import { getVoiceMode, synthesize } from './tts';
import { compositeSnapshot, imageScale, type Snapshot } from './snapshot';
import type { Screen } from './screen';
import { evaluate, setTadScale } from './tad';

export type Step =
  | { type: 'mouse_move'; x: number; y: number; duration?: number; modifiers?: Modifiers }
  | { type: 'mouse_path'; points: Pt[]; duration?: number; modifiers?: Modifiers }
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
const SETTLE_MAX_MS = 400;
const SETTLE_POLL_MS = 40;

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * Waits for the UI to catch up with the events we dispatched: LM UIs drain their
 * input queue and redraw on a 30 Hz frame loop, so a screenshot taken right after
 * the last event shows the state BEFORE it (the model then concludes "nothing
 * happened"). Two frames let the queue drain and render; then the canvas is
 * sampled at low resolution until two consecutive samples match, capped so a
 * running animation can't stall us.
 */
export async function settle(screen: Screen, maxMs = SETTLE_MAX_MS): Promise<void> {
  await nextFrame();
  await nextFrame();
  // Tab-capture frames trail the page by a frame or two.
  await sleep(60);
  if (!screen.isLive()) return;
  const w = 64;
  const h = Math.max(1, Math.round((w * screen.height) / Math.max(1, screen.width)));
  const probe = document.createElement('canvas');
  probe.width = w;
  probe.height = h;
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const sample = () => {
    screen.draw(ctx, w, h);
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
  /** Something the user should know (e.g. the voice fell back); wired to the transcript. */
  onNotice: ((text: string) => void) | null = null;
  speakOptions: SpeakOptions = {};
  /** Clips synthesized ahead for the running performance's say steps, by their text. */
  private prefetched = new Map<string, Promise<TtsClip | null>>();

  /** Speech options for right now: the voice mode is read per sentence. */
  private voiceOptions(extra: Partial<SpeakOptions> = {}): SpeakOptions {
    const mode = getVoiceMode();
    return {
      ...this.speakOptions,
      ...extra,
      mute: mode === 'mute',
      tts:
        mode === 'elevenlabs'
          ? (text, previous) => this.prefetched.get(text) ?? synthesize(text, (t) => this.onNotice?.(t), previous)
          : undefined,
    };
  }

  /**
   * Synthesizes every `say` in a script as the performance starts, in script order,
   * so no step waits on the network: by the time a say is reached its clip is
   * (usually) here and it starts the moment the voice is free.
   */
  private prefetchSpeech(script: readonly Step[]): void {
    if (getVoiceMode() !== 'elevenlabs') return;
    const texts: string[] = [];
    const walk = (steps: readonly Step[]) => {
      for (const st of steps) {
        if (st.type !== 'say') continue;
        texts.push(parseAnchors(st.text).text);
        for (const sub of Object.values(st.anchors ?? {})) walk(sub);
      }
    };
    walk(script);
    let previous = lastQueuedSpeech();
    for (const text of texts) {
      if (!text.trim()) continue;
      if (!this.prefetched.has(text)) {
        this.prefetched.set(text, synthesize(text, (t) => this.onNotice?.(t), previous).catch(() => null));
      }
      previous = text;
    }
  }

  /** With a voice on, speech is heard, not read: bubbles for it only when muted. */
  private speechBubbles(): boolean {
    return getVoiceMode() === 'mute';
  }
  private readonly input: SyntheticInput;
  private canceled = false;
  private running = 0;
  private bubbleSeq = 0;
  private strokeSeq = -1;
  private cursorTimer: number | null = null;

  constructor(
    private readonly screen: Screen,
    private readonly overlay: InkOverlay,
  ) {
    this.input = new SyntheticInput((s) => overlay.setAiCursor({ x: s.x, y: s.y, down: s.buttons !== 0 }));
  }

  isRunning(): boolean {
    return this.running > 0;
  }

  /** Stops the current performance: speech, animations, and any held mouse button. */
  cancel(): void {
    stopAllSpeech();
    if (!this.running) return;
    this.canceled = true;
    this.input.releaseAll();
  }

  async perform(script: Step[], opts: PerformOptions = {}): Promise<PerformResult> {
    const scale = opts.scale ?? this.scale;
    setTadScale(scale);
    const style = opts.penStyle ?? this.penStyle;
    const speakOpts = { ...this.speakOptions, ...(opts.speak ?? {}) };
    if (this.running) this.cancel();
    while (this.running) await sleep(20);
    this.canceled = false;
    this.running++;
    if (this.cursorTimer != null) clearTimeout(this.cursorTimer);
    const results: StepResult[] = [];
    this.prefetchSpeech(script);
    try {
      await this.runSteps(script, { scale, style, speakOpts, hintMs: 0 }, results);
    } finally {
      this.prefetched.clear();
      this.running--;
      if (!this.holdFastForward) this.fastForward = false;
      this.input.releaseAll();
      this.cursorTimer = window.setTimeout(() => this.overlay.setAiCursor(null), CURSOR_HIDE_MS);
    }
    return { steps: results, canceled: this.canceled, screenshot: await this.captureScreenshot(scale, 'after perform') };
  }

  /**
   * Speaks `text` (with a bubble) WITHOUT taking the perform lock, so it can run
   * alongside a performance or an eval — the model's "let me open the halo" plays
   * while its hands work. Queued behind whatever is already speaking, never a
   * takeover. `onStart` fires when this sentence is actually heard (the agent starts
   * a perform's steps on it, so the first gesture and its sentence begin together).
   * Honors cancel and fast-forward.
   */
  async narrate(text: string, opts: { onStart?: () => void } = {}): Promise<void> {
    const parsed = parseAnchors(text);
    if (!parsed.text.trim()) return;
    const id = `narr${++this.bubbleSeq}`;
    let shown = false;
    try {
      // The bubble (muted only) appears when this sentence actually starts.
      await speak(
        parsed,
        {
          onStart: () => {
            opts.onStart?.();
            if (this.speechBubbles()) {
              shown = true;
              this.overlay.showBubble({ id, kind: 'speech', text: parsed.text, at: null });
            }
          },
        },
        this.voiceOptions({ takeover: false }),
        () => this.canceled,
        () => this.fastForward,
      );
    } finally {
      if (shown) window.setTimeout(() => this.overlay.hideBubble(id), 2000);
    }
  }

  /** A screenshot for the model: waits for the UI to settle first (see settle). */
  async captureScreenshot(scale: number, label: string): Promise<Snapshot> {
    await settle(this.screen);
    return this.takeScreenshot(scale, label);
  }

  /** The canvas plus whatever ink is visible, at the given image scale — right now. */
  takeScreenshot(scale: number, label: string): Snapshot {
    const img = imageScale(this.screen.width, this.screen.height);
    img.scale = scale;
    img.width = Math.max(1, Math.round(this.screen.width * scale));
    img.height = Math.max(1, Math.round(this.screen.height * scale));
    // The capture already shows the on-screen ink; no need to draw it again.
    return compositeSnapshot(this.screen, [], img, label, performance.now(), this.screen.isLive() ? [] : this.overlay.visibleStrokes());
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
        return this.input.takeNotes();
      case 'mouse_path': {
        // Trace a polyline at an even speed (button state unchanged): a freehand stroke
        // when the button is held. Default pace ~600 px/s, like a person drawing.
        const pts = (step.points ?? []).map(cp);
        if (pts.length === 0) return undefined;
        let len = 0;
        let prev = { x: this.input.state.x, y: this.input.state.y };
        for (const p of pts) (len += Math.hypot(p.x - prev.x, p.y - prev.y)), (prev = p);
        const total = step.duration ?? Math.min(6000, Math.max(150, (len / 600) * 1000));
        prev = { x: this.input.state.x, y: this.input.state.y };
        for (const p of pts) {
          if (this.canceled) break;
          const seg = Math.hypot(p.x - prev.x, p.y - prev.y);
          await this.input.move(p.x, p.y, len > 0 ? (total * seg) / len : 0, isCanceled, step.modifiers ?? {}, isFast);
          prev = p;
        }
        return this.input.takeNotes();
      }
      case 'mouse_down':
        return [this.input.down(step.button ?? 0, step.modifiers ?? {}), this.input.takeNotes()].filter(Boolean).join('; ');
      case 'mouse_up':
        return [this.input.takeNotes(), this.input.up(step.button ?? 0, step.modifiers ?? {})].filter(Boolean).join('; ');
      case 'scroll':
        this.input.wheel(step.dx, step.dy, step.x != null ? cv(step.x) : undefined, step.y != null ? cv(step.y) : undefined, step.modifiers ?? {});
        return this.input.takeNotes();
      case 'key_down':
        this.input.keyDown(step.key, step.code, step.modifiers ?? {});
        return this.input.takeNotes();
      case 'key_up':
        this.input.keyUp(step.key, step.code, step.modifiers ?? {});
        return this.input.takeNotes();
      case 'type':
        await this.input.type(step.text, step.perCharMs, isCanceled);
        return this.input.takeNotes();
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
        setTadScale(s);
        const out = await evaluate(step.source);
        if (out.startsWith('Error: ')) throw new Error(out.slice(7));
        return out;
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
    const bubbleId = `say${++this.bubbleSeq}`;
    let shown = false;
    // One mouse, one pen: anchored groups run one after another in speech order, so a
    // drag still under way when the next span arrives is finished before that span's
    // steps start (they slip later rather than fighting over the pointer).
    let chain: Promise<void> = Promise.resolve();
    const cps = ctx.speakOpts.estimatedCharsPerSec ?? 15;
    await speak(
      parsed,
      {
        onStart: () => {
          if (this.speechBubbles()) {
            shown = true;
            this.overlay.showBubble({ id: bubbleId, kind: 'speech', text: parsed.text, at: null });
          }
        },
        onSpanStart: (span, expectedMs) => {
          const steps = step.anchors?.[span.id];
          if (!steps) return;
          const hintMs = expectedMs ?? ((span.end - span.start) / cps) * 1000;
          chain = chain.then(() => this.runSteps(steps, { ...ctx, hintMs }, results));
        },
      },
      // Queued, not a takeover: it follows the narration instead of cutting it off.
      // Its anchors line up regardless, since they fire from its own word times.
      this.voiceOptions({ ...ctx.speakOpts, rate: step.rate ?? ctx.speakOpts.rate }),
      () => this.canceled,
      () => this.fastForward,
    );
    await chain;
    if (shown) window.setTimeout(() => this.overlay.hideBubble(bubbleId), 2000);
    return parsed.text;
  }
}
