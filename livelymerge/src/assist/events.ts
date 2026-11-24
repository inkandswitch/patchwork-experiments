/**
 * The AI's mouse and keyboard: raw synthetic PointerEvent / KeyboardEvent /
 * WheelEvent dispatched on the LM canvas, where every LM UI already listens.
 * The only thing added here is mouse *physics* — a move is a stream of
 * pointermoves over real time, moves while a button is held carry `buttons` —
 * never UI semantics (what a click or a long press means is the UI's business).
 *
 * Gotchas: synthetic events have `isTrusted: false`; `setPointerCapture` on one
 * may throw (the Kit guards it, newdefs doesn't call it); key events need the
 * canvas focused. Both UIs read `offsetX/Y`, which the browser derives from the
 * `clientX/Y` we set, with a `clientX` fallback.
 */
export const AI_POINTER_ID = 7777;

export interface Modifiers {
  shift?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  meta?: boolean;
}

export interface MouseState {
  x: number;
  y: number;
  buttons: number;
  /** modifier keys currently held (via keyDown/keyUp) */
  held: Modifiers;
}

const BUTTON_MASK = [1, 4, 2, 8, 16];

/** Canonical KeyboardEvent.key for a modifier, or null. Accepts the common aliases. */
export function modifierOf(key: string): keyof Modifiers | null {
  switch (key.toLowerCase()) {
    case 'shift':
      return 'shift';
    case 'control':
    case 'ctrl':
      return 'ctrl';
    case 'alt':
    case 'option':
      return 'alt';
    case 'meta':
    case 'cmd':
    case 'command':
    case 'os':
      return 'meta';
    default:
      return null;
  }
}

const MODIFIER_KEY_NAME: Record<keyof Modifiers, string> = { shift: 'Shift', ctrl: 'Control', alt: 'Alt', meta: 'Meta' };

export class SyntheticInput {
  state: MouseState;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onMouse?: (s: MouseState) => void,
  ) {
    this.state = { x: Math.round(canvas.width / 2), y: Math.round(canvas.height / 2), buttons: 0, held: {} };
  }

  /** The modifiers an event carries: those held via keyDown plus any passed explicitly. */
  private mods(extra: Modifiers = {}): Modifiers {
    const h = this.state.held;
    return { shift: !!(h.shift || extra.shift), ctrl: !!(h.ctrl || extra.ctrl), alt: !!(h.alt || extra.alt), meta: !!(h.meta || extra.meta) };
  }

  private pointerInit(type: string, button: number, extra: Modifiers = {}): PointerEventInit {
    const r = this.canvas.getBoundingClientRect();
    const { x, y, buttons } = this.state;
    const m = this.mods(extra);
    return {
      shiftKey: m.shift,
      ctrlKey: m.ctrl,
      altKey: m.alt,
      metaKey: m.meta,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      pointerId: AI_POINTER_ID,
      pointerType: 'mouse',
      isPrimary: true,
      button: type === 'pointermove' ? -1 : button,
      buttons,
      clientX: r.left + x,
      clientY: r.top + y,
      screenX: (window.screenX || 0) + r.left + x,
      screenY: (window.screenY || 0) + r.top + y,
      pressure: buttons ? 0.5 : 0,
    };
  }

  private dispatchPointer(type: string, button = 0, extra: Modifiers = {}): void {
    this.canvas.dispatchEvent(new PointerEvent(type, this.pointerInit(type, button, extra)));
    this.onMouse?.(this.state);
  }

  /** Default move duration: ~1500 px/s, clamped to 80..1200 ms. */
  static moveDuration(dist: number): number {
    return Math.min(1200, Math.max(80, (dist / 1500) * 1000));
  }

  /** Moves the pointer to (x, y) over `durationMs`, dispatching a pointermove per frame. */
  move(
    x: number,
    y: number,
    durationMs?: number,
    isCanceled: () => boolean = () => false,
    extra: Modifiers = {},
    isFast: () => boolean = () => false,
  ): Promise<void> {
    const from = { x: this.state.x, y: this.state.y };
    const dist = Math.hypot(x - from.x, y - from.y);
    const dur = durationMs ?? SyntheticInput.moveDuration(dist);
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = () => {
        if (isCanceled()) return resolve();
        // Fast-forward keeps a couple of frames of motion so the UI still sees a drag.
        const d = isFast() ? Math.min(dur, 60) : dur;
        const f = d <= 0 ? 1 : Math.min(1, (performance.now() - start) / d);
        const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; // ease in-out
        this.state.x = from.x + (x - from.x) * e;
        this.state.y = from.y + (y - from.y) * e;
        this.dispatchPointer('pointermove', 0, extra);
        if (f >= 1) return resolve();
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  down(button = 0, extra: Modifiers = {}): void {
    this.state.buttons |= BUTTON_MASK[button] ?? 1;
    this.dispatchPointer('pointerdown', button, extra);
  }

  up(button = 0, extra: Modifiers = {}): void {
    this.state.buttons &= ~(BUTTON_MASK[button] ?? 1);
    this.dispatchPointer('pointerup', button, extra);
  }

  /** Releases any held buttons and modifier keys (after a performance or a cancel,
   *  so the UI isn't left mid-drag or with Meta stuck down). */
  releaseAll(): void {
    for (let b = 0; b < BUTTON_MASK.length; b++) {
      if (this.state.buttons & BUTTON_MASK[b]) this.up(b);
    }
    for (const m of Object.keys(this.state.held) as (keyof Modifiers)[]) {
      if (this.state.held[m]) this.keyUp(MODIFIER_KEY_NAME[m]);
    }
  }

  wheel(dx: number, dy: number, x?: number, y?: number, extra: Modifiers = {}): void {
    if (x != null && y != null) {
      this.state.x = x;
      this.state.y = y;
    }
    const r = this.canvas.getBoundingClientRect();
    const m = this.mods(extra);
    this.canvas.dispatchEvent(
      new WheelEvent('wheel', {
        shiftKey: m.shift,
        ctrlKey: m.ctrl,
        altKey: m.alt,
        metaKey: m.meta,
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        deltaX: dx,
        deltaY: dy,
        deltaMode: 0,
        clientX: r.left + this.state.x,
        clientY: r.top + this.state.y,
      }),
    );
    this.onMouse?.(this.state);
  }

  private keyInit(key: string, code: string | undefined, mods: Modifiers): KeyboardEventInit {
    const m = this.mods(mods);
    return {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      key,
      code: code ?? codeFor(key),
      shiftKey: m.shift,
      ctrlKey: m.ctrl,
      altKey: m.alt,
      metaKey: m.meta,
      repeat: false,
    };
  }

  private focus(): void {
    try {
      this.canvas.focus({ preventScroll: true });
    } catch {
      /* ignore */
    }
  }

  keyDown(key: string, code?: string, mods: Modifiers = {}): void {
    this.focus();
    // Pressing a modifier holds it: every pointer, wheel and key event until the
    // matching keyUp carries it, the way a real cmd-click does.
    const mod = modifierOf(key);
    if (mod) {
      key = MODIFIER_KEY_NAME[mod];
      this.state.held[mod] = true;
    }
    this.canvas.dispatchEvent(new KeyboardEvent('keydown', this.keyInit(key, code, mods)));
    if (key.length === 1 && !mods.ctrl && !mods.meta) {
      this.canvas.dispatchEvent(
        new KeyboardEvent('keypress', { ...this.keyInit(key, code, mods), charCode: key.charCodeAt(0) } as any),
      );
    }
  }

  keyUp(key: string, code?: string, mods: Modifiers = {}): void {
    const mod = modifierOf(key);
    if (mod) {
      key = MODIFIER_KEY_NAME[mod];
      this.state.held[mod] = false;
    }
    this.canvas.dispatchEvent(new KeyboardEvent('keyup', this.keyInit(key, code, mods)));
  }

  /** Types text as a keydown/keypress/keyup per character, `perCharMs` apart. */
  async type(text: string, perCharMs = 40, isCanceled: () => boolean = () => false): Promise<void> {
    for (const ch of text) {
      if (isCanceled()) return;
      const key = ch === '\n' ? 'Enter' : ch;
      const mods: Modifiers = ch !== ch.toLowerCase() && ch.length === 1 ? { shift: true } : {};
      this.keyDown(key, undefined, mods);
      this.keyUp(key, undefined, mods);
      await sleep(perCharMs);
    }
  }
}

export function codeFor(key: string): string {
  if (key.length === 1) {
    if (/[a-z]/i.test(key)) return 'Key' + key.toUpperCase();
    if (/[0-9]/.test(key)) return 'Digit' + key;
    if (key === ' ') return 'Space';
  }
  if (key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift') return key + 'Left';
  return key;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
