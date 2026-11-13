/**
 * The AI's mouse and keyboard, for a DOM world. Same contract as in Livelymerge — raw
 * events, never UI semantics; the host only adds mouse *physics* — but Patchwork has no
 * single canvas where everything listens, so each event goes to the element under the
 * pointer (through shadow roots) or the focused element, and the browser default
 * actions that synthetic events don't trigger are emulated:
 *
 *  - pointer events are followed by their compatibility mouse events, and a down+up on
 *    the same element by `click` (a quick second one also by `dblclick`; button 2 by
 *    `contextmenu`);
 *  - mouse down focuses the nearest focusable ancestor and, in text, places the caret;
 *  - an unhandled wheel scrolls the nearest scrollable ancestor;
 *  - an unhandled printable key inserts its text into the focused editable via
 *    `execCommand('insertText')` (inputs, textareas, contenteditable, CodeMirror), and
 *    Backspace/Delete/Enter/arrows/select-all/undo do the obvious thing.
 *
 * Synthetic events have `isTrusted: false`; things gated on trust (file pickers,
 * clipboard, fullscreen) won't work this way — the model can fall back to eval.
 * Coordinates are screen (viewport CSS) px.
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
const DBLCLICK_MS = 450;

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

/** Elements that are part of Talk & Draw itself; never targets for the AI's input. */
export function isOwnElement(el: Element | null): boolean {
  return !!el?.closest?.('[data-pw-tad]');
}

/** The innermost element at (x, y), descending into open shadow roots. */
export function deepElementFromPoint(x: number, y: number): Element | null {
  let el: Element | null = null;
  const stack = document.elementsFromPoint(x, y);
  for (const e of stack) {
    if (!isOwnElement(e)) {
      el = e;
      break;
    }
  }
  for (let i = 0; el && i < 32; i++) {
    const root = (el as HTMLElement).shadowRoot;
    if (!root) break;
    const inner = root.elementsFromPoint(x, y).find((e) => !isOwnElement(e)) ?? null;
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/** document.activeElement, descending into shadow roots (and same-origin iframes no). */
export function deepActiveElement(): Element | null {
  let el: Element | null = document.activeElement;
  for (let i = 0; el && i < 32; i++) {
    const inner = (el as HTMLElement).shadowRoot?.activeElement ?? null;
    if (!inner) break;
    el = inner;
  }
  return el;
}

/** Parent across shadow boundaries. */
function composedParent(el: Element): Element | null {
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

function composedAncestors(el: Element | null): Element[] {
  const out: Element[] = [];
  for (let e = el; e; e = composedParent(e)) out.push(e);
  return out;
}

const FOCUSABLE = 'input,textarea,select,button,a[href],[tabindex],[contenteditable=""],[contenteditable=true],[contenteditable=plaintext-only]';

function focusableAncestor(el: Element | null): HTMLElement | null {
  for (const e of composedAncestors(el)) {
    if (e instanceof HTMLElement && e.matches(FOCUSABLE) && !(e as HTMLInputElement).disabled) return e;
  }
  return null;
}

function isTextInput(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return ['text', 'search', 'url', 'tel', 'email', 'password', 'number', ''].includes(el.type);
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (isTextInput(el)) return !el.readOnly && !el.disabled;
  return (el as HTMLElement).isContentEditable === true;
}

function scrollableAncestor(el: Element | null, dx: number, dy: number): Element | null {
  for (const e of composedAncestors(el)) {
    const cs = getComputedStyle(e);
    const canY = dy !== 0 && /(auto|scroll|overlay)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 1;
    const canX = dx !== 0 && /(auto|scroll|overlay)/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1;
    if (canX || canY) return e;
  }
  return document.scrollingElement;
}

/** Puts the caret at (x, y) if that is inside editable text. */
function placeCaret(x: number, y: number, target: Element): void {
  const anyDoc = document as any;
  try {
    if (isTextInput(target)) return; // the browser picks the offset only for trusted clicks; leave it
    let range: Range | null = null;
    if (typeof anyDoc.caretPositionFromPoint === 'function') {
      const shadowRoots = composedAncestors(target)
        .map((e) => e.getRootNode())
        .filter((r): r is ShadowRoot => r instanceof ShadowRoot);
      const pos = anyDoc.caretPositionFromPoint(x, y, shadowRoots.length ? { shadowRoots } : undefined);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
      }
    } else if (typeof anyDoc.caretRangeFromPoint === 'function') {
      range = anyDoc.caretRangeFromPoint(x, y);
    }
    if (!range) return;
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  } catch {
    /* ignore */
  }
}

/** The input currently driving the AI pointer (for the pointer-capture shim). */
let activeInput: SyntheticInput | null = null;
let captureShimInstalled = false;

/**
 * Pointer capture for the AI's pointer. The browser doesn't know pointer 7777, so a UI
 * calling `el.setPointerCapture(e.pointerId)` in its pointerdown handler gets a
 * NotFoundError — which aborts most drag code right there. Wrap the three methods so
 * our id is captured by us instead (later moves/ups go to the capturing element, with
 * got/lostpointercapture), and every other id goes to the browser as before.
 */
function installPointerCaptureShim(): void {
  if (captureShimInstalled || typeof Element === 'undefined') return;
  captureShimInstalled = true;
  const proto = Element.prototype as any;
  const set = proto.setPointerCapture;
  const release = proto.releasePointerCapture;
  const has = proto.hasPointerCapture;
  proto.setPointerCapture = function (id: number) {
    if (id === AI_POINTER_ID) return activeInput?.capturePointer(this as Element);
    return set.call(this, id);
  };
  proto.releasePointerCapture = function (id: number) {
    if (id === AI_POINTER_ID) return activeInput?.releasePointer(this as Element);
    return release.call(this, id);
  };
  proto.hasPointerCapture = function (id: number) {
    if (id === AI_POINTER_ID) return !!activeInput && activeInput.capturedBy() === this;
    return has.call(this, id);
  };
}

/** The nearest element that would start a native (HTML5) drag. */
function draggableAncestor(el: Element | null): HTMLElement | null {
  for (const e of composedAncestors(el)) {
    if (!(e instanceof HTMLElement)) continue;
    if (isEditable(e)) return null; // pressing in text selects, it doesn't drag
    const attr = e.getAttribute('draggable');
    if (attr === 'false') return null;
    if (attr === 'true') return e;
    // Links and images drag by default — but only when that is what was pressed.
    if (e === el && (e instanceof HTMLImageElement || (e instanceof HTMLAnchorElement && e.href))) return e;
  }
  return null;
}

/** A short description of an element, for step results ("what did my click hit?"). */
export function describeTarget(el: Element | null): string {
  if (!el) return '(nothing)';
  const id = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
  const label = (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? (el.textContent ?? '').trim()).replace(/\s+/g, ' ').slice(0, 40);
  return `<${el.tagName.toLowerCase()}${id}${cls}>${label ? ` "${label}"` : ''}`;
}

interface DragState {
  source: HTMLElement;
  dt: DataTransfer;
  over: Element | null;
  dropAllowed: boolean;
}

export class SyntheticInput {
  state: MouseState;
  private hover: Element | null = null;
  private downTarget: Element | null = null;
  private lastClick: { t: number; x: number; y: number; target: Element; count: number } | null = null;
  /** Element holding pointer capture for the AI pointer (via the shim). */
  private capture: Element | null = null;
  /** A press on something draggable: becomes a native drag once the pointer moves. */
  private pendingDrag: { source: HTMLElement; x0: number; y0: number } | null = null;
  private drag: DragState | null = null;
  /** movementX/Y for the move event being dispatched. */
  private movement = { x: 0, y: 0 };
  /** Things worth telling the model about the gesture under way (drag started, …). */
  private notes: string[] = [];

  constructor(private readonly onMouse?: (s: MouseState) => void) {
    this.state = { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2), buttons: 0, held: {} };
    installPointerCaptureShim();
    activeInput = this;
  }

  capturePointer(el: Element): void {
    if (this.capture === el) return;
    if (this.capture) this.releasePointer(this.capture);
    this.capture = el;
    this.fire(el, new PointerEvent('gotpointercapture', { ...this.pointerInit('gotpointercapture', 0), bubbles: true }));
  }

  releasePointer(el?: Element): void {
    const c = this.capture;
    if (!c || (el && el !== c)) return;
    this.capture = null;
    this.fire(c, new PointerEvent('lostpointercapture', { ...this.pointerInit('lostpointercapture', 0), bubbles: true }));
  }

  capturedBy(): Element | null {
    return this.capture;
  }

  /** Notes collected since the last call (drag started/dropped, …), for step results. */
  /**
   * dispatchEvent, but exceptions thrown by the page's listeners (which the browser
   * only reports to window.onerror) are collected into the step's notes, so the model
   * — and we — can see WHY a UI ignored a gesture.
   */
  private fire(target: EventTarget, ev: Event): boolean {
    const onErr = (e: ErrorEvent) => {
      const msg = e.error instanceof Error ? `${e.error.name}: ${e.error.message}` : e.message;
      const line = `page threw on ${ev.type}: ${msg}`;
      if (!this.notes.includes(line)) this.notes.push(line);
      console.warn('Talk & Draw:', line, e.error);
    };
    window.addEventListener('error', onErr);
    try {
      return target.dispatchEvent(ev);
    } finally {
      window.removeEventListener('error', onErr);
    }
  }

  takeNotes(): string | undefined {
    const n = this.notes.join('; ');
    this.notes = [];
    return n || undefined;
  }

  /** The modifiers an event carries: those held via keyDown plus any passed explicitly. */
  private mods(extra: Modifiers = {}): Modifiers {
    const h = this.state.held;
    return { shift: !!(h.shift || extra.shift), ctrl: !!(h.ctrl || extra.ctrl), alt: !!(h.alt || extra.alt), meta: !!(h.meta || extra.meta) };
  }

  private target(): Element {
    return deepElementFromPoint(this.state.x, this.state.y) ?? document.body;
  }

  private mouseInit(button: number, extra: Modifiers = {}, detail = 0): MouseEventInit {
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
      button,
      buttons,
      detail,
      clientX: x,
      clientY: y,
      screenX: (window.screenX || 0) + x,
      screenY: (window.screenY || 0) + y,
      movementX: this.movement.x,
      movementY: this.movement.y,
    };
  }

  private pointerInit(type: string, button: number, extra: Modifiers = {}): PointerEventInit {
    return {
      ...this.mouseInit(type === 'pointermove' ? -1 : button, extra),
      pointerId: AI_POINTER_ID,
      pointerType: 'mouse',
      isPrimary: true,
      pressure: this.state.buttons ? 0.5 : 0,
      width: 1,
      height: 1,
    };
  }

  /** pointer + compatibility mouse event; returns false if either was canceled. */
  private dispatchPair(target: Element, ptype: string, mtype: string, button: number, extra: Modifiers, detail = 0): boolean {
    const init = this.pointerInit(ptype, button, extra);
    // Drawing tools (tldraw's pen among them) read the samples of a move from
    // getCoalescedEvents(), which is EMPTY on a constructed event unless given: without
    // this they see the pointerdown and then no points at all — a dot, not a stroke.
    if (ptype === 'pointermove' || ptype === 'pointerrawupdate') {
      (init as any).coalescedEvents = [new PointerEvent(ptype, init)];
      (init as any).predictedEvents = [];
    }
    const p = new PointerEvent(ptype, init);
    const okP = this.fire(target, p);
    // A canceled pointerdown suppresses the compatibility mouse events (per spec).
    if (ptype === 'pointerdown' && !okP) return false;
    const okM = this.fire(target, new MouseEvent(mtype, this.mouseInit(mtype === 'mousemove' ? 0 : button, extra, detail)));
    return okP && okM;
  }

  private updateHover(target: Element, extra: Modifiers): void {
    if (target === this.hover) return;
    const prev = this.hover;
    this.hover = target;
    if (prev && prev.isConnected) {
      this.fire(prev, new PointerEvent('pointerout', { ...this.pointerInit('pointerout', 0, extra), relatedTarget: target }));
      this.fire(prev, new MouseEvent('mouseout', { ...this.mouseInit(0, extra), relatedTarget: target }));
      const stay = new Set(composedAncestors(target));
      for (const e of composedAncestors(prev)) {
        if (stay.has(e)) break;
        this.fire(e, new PointerEvent('pointerleave', { ...this.pointerInit('pointerleave', 0, extra), bubbles: false }));
        this.fire(e, new MouseEvent('mouseleave', { ...this.mouseInit(0, extra), bubbles: false }));
      }
    }
    this.fire(target, new PointerEvent('pointerover', { ...this.pointerInit('pointerover', 0, extra), relatedTarget: prev }));
    this.fire(target, new MouseEvent('mouseover', { ...this.mouseInit(0, extra), relatedTarget: prev }));
    const was = new Set(prev ? composedAncestors(prev) : []);
    for (const e of composedAncestors(target).reverse()) {
      if (was.has(e)) continue;
      this.fire(e, new PointerEvent('pointerenter', { ...this.pointerInit('pointerenter', 0, extra), bubbles: false }));
      this.fire(e, new MouseEvent('mouseenter', { ...this.mouseInit(0, extra), bubbles: false }));
    }
  }

  /** Default move duration: ~1500 px/s, clamped to 80..1200 ms. */
  static moveDuration(dist: number): number {
    return Math.min(1200, Math.max(80, (dist / 1500) * 1000));
  }

  /** Moves the pointer to (x, y) over `durationMs`, dispatching a move per frame. */
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
        const d = isFast() ? Math.min(dur, 60) : dur;
        const f = d <= 0 ? 1 : Math.min(1, (performance.now() - start) / d);
        const e = f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2; // ease in-out
        const nx = from.x + (x - from.x) * e;
        const ny = from.y + (y - from.y) * e;
        this.movement = { x: Math.round(nx - this.state.x), y: Math.round(ny - this.state.y) };
        this.state.x = nx;
        this.state.y = ny;
        this.moveStep(extra);
        this.movement = { x: 0, y: 0 };
        this.onMouse?.(this.state);
        if (f >= 1) return resolve();
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  /** One pointer position update: a native drag step, or ordinary move events. */
  private moveStep(extra: Modifiers): void {
    // A press on something draggable turns into a native drag after a few px, the way
    // the browser does it (pragmatic-drag-and-drop & co. only listen to drag events).
    const pd = this.pendingDrag;
    if (pd && !this.drag && this.state.buttons & 1 && Math.hypot(this.state.x - pd.x0, this.state.y - pd.y0) > 4) {
      this.pendingDrag = null;
      this.startDrag(pd.source, extra);
    }
    if (this.drag) {
      this.dragStep(extra);
      return;
    }
    const hit = this.target();
    this.updateHover(hit, extra);
    // Without capture, moves go to whatever is under the pointer (as in the browser);
    // with capture, to the capturing element.
    const t = this.capture?.isConnected ? this.capture : hit;
    this.dispatchPair(t, 'pointermove', 'mousemove', 0, extra);
  }

  private dragInit(extra: Modifiers, dt: DataTransfer): DragEventInit {
    return { ...this.mouseInit(0, extra), dataTransfer: dt };
  }

  private startDrag(source: HTMLElement, extra: Modifiers): void {
    const dt = new DataTransfer();
    // The browser cancels the pointer when a native drag begins.
    const pc = this.capture?.isConnected ? this.capture : this.downTarget ?? source;
    this.fire(pc, new PointerEvent('pointercancel', { ...this.pointerInit('pointercancel', 0, extra), cancelable: false }));
    this.releasePointer();
    const ok = this.fire(source, new DragEvent('dragstart', this.dragInit(extra, dt)));
    if (!ok) {
      this.notes.push(`drag of ${describeTarget(source)} was refused by the page (dragstart canceled)`);
      return;
    }
    this.drag = { source, dt, over: null, dropAllowed: false };
    this.notes.push(`native drag started from ${describeTarget(source)}`);
    this.fire(source, new DragEvent('drag', this.dragInit(extra, dt)));
  }

  private dragStep(extra: Modifiers): void {
    const d = this.drag!;
    const t = this.target();
    d.source.isConnected && this.fire(d.source, new DragEvent('drag', this.dragInit(extra, d.dt)));
    if (t !== d.over) {
      const prev = d.over;
      this.fire(t, new DragEvent('dragenter', { ...this.dragInit(extra, d.dt), relatedTarget: prev }));
      if (prev?.isConnected) this.fire(prev, new DragEvent('dragleave', { ...this.dragInit(extra, d.dt), relatedTarget: t }));
      d.over = t;
    }
    // A canceled dragover is how a page says "you may drop here".
    d.dropAllowed = !this.fire(t, new DragEvent('dragover', this.dragInit(extra, d.dt)));
  }

  private finishDrag(extra: Modifiers): string {
    const d = this.drag!;
    this.dragStep(extra);
    this.drag = null;
    const t = d.over ?? this.target();
    let result: string;
    if (d.dropAllowed) {
      this.fire(t, new DragEvent('drop', this.dragInit(extra, d.dt)));
      result = `dropped on ${describeTarget(t)}`;
    } else {
      this.fire(t, new DragEvent('dragleave', this.dragInit(extra, d.dt)));
      result = `drop refused over ${describeTarget(t)} (no drop target accepted it)`;
    }
    if (d.source.isConnected) this.fire(d.source, new DragEvent('dragend', this.dragInit(extra, d.dt)));
    return result;
  }

  down(button = 0, extra: Modifiers = {}): string {
    const t = this.target();
    this.updateHover(t, extra);
    this.state.buttons |= BUTTON_MASK[button] ?? 1;
    this.downTarget = t;
    this.pendingDrag = null;
    const ok = this.dispatchPair(t, 'pointerdown', 'mousedown', button, extra, 1);
    if (ok && button === 0) {
      // The browser's default actions for a press: focus, a caret in text, and the
      // start of a native drag if this is something draggable.
      const f = focusableAncestor(t);
      if (f) {
        try {
          f.focus({ preventScroll: true });
        } catch {
          /* ignore */
        }
        if ((f as HTMLElement).isContentEditable) placeCaret(this.state.x, this.state.y, t);
      } else {
        (deepActiveElement() as HTMLElement | null)?.blur?.();
      }
      const src = draggableAncestor(t);
      if (src) this.pendingDrag = { source: src, x0: this.state.x, y0: this.state.y };
    }
    this.onMouse?.(this.state);
    return `pressed ${describeTarget(t)}${ok ? '' : ' (the page handled it: default prevented)'}${this.pendingDrag ? ' — draggable' : ''}`;
  }

  up(button = 0, extra: Modifiers = {}): string {
    this.state.buttons &= ~(BUTTON_MASK[button] ?? 1);
    const downT = this.downTarget;
    this.downTarget = null;
    this.pendingDrag = null;
    if (this.drag && button === 0) {
      // After a native drag the browser sends no mouseup/click.
      const r = this.finishDrag(extra);
      this.onMouse?.(this.state);
      return r;
    }
    const hit = this.target();
    const t = this.capture?.isConnected ? this.capture : hit;
    this.dispatchPair(t, 'pointerup', 'mouseup', button, extra, 1);
    this.releasePointer();
    let result = `released over ${describeTarget(hit)}`;
    // click goes to the nearest common ancestor of press and release targets.
    if (downT && downT.isConnected) {
      const downAnc = new Set(composedAncestors(downT));
      const common = composedAncestors(hit).find((e) => downAnc.has(e)) ?? null;
      if (common) {
        if (button === 2) {
          this.fire(common, new MouseEvent('contextmenu', this.mouseInit(2, extra)));
        } else if (button === 0) {
          const now = performance.now();
          const lc = this.lastClick;
          const count =
            lc && lc.target === common && now - lc.t < DBLCLICK_MS && Math.hypot(lc.x - this.state.x, lc.y - this.state.y) < 6 ? lc.count + 1 : 1;
          this.fire(common, new PointerEvent('click', { ...this.pointerInit('click', 0, extra), detail: count }));
          if (count === 2) this.fire(common, new MouseEvent('dblclick', this.mouseInit(0, extra, 2)));
          this.lastClick = { t: now, x: this.state.x, y: this.state.y, target: common, count };
          result = `${count === 2 ? 'double-' : ''}clicked ${describeTarget(common)}`;
        } else {
          this.fire(common, new PointerEvent('auxclick', this.pointerInit('auxclick', button, extra)));
        }
      }
    }
    this.onMouse?.(this.state);
    return result;
  }

  /** Releases any held buttons and modifier keys. */
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
    const t = this.target();
    const m = this.mods(extra);
    const ok = this.fire(t, 
      new WheelEvent('wheel', {
        ...this.mouseInit(0, extra),
        shiftKey: m.shift,
        deltaX: dx,
        deltaY: dy,
        deltaMode: 0,
      }),
    );
    if (ok && !m.ctrl && !m.meta) scrollableAncestor(t, dx, dy)?.scrollBy({ left: dx, top: dy, behavior: 'instant' as ScrollBehavior });
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

  private keyTarget(): Element {
    const a = deepActiveElement();
    return a && !isOwnElement(a) ? a : document.body;
  }

  keyDown(key: string, code?: string, mods: Modifiers = {}): void {
    const mod = modifierOf(key);
    if (mod) {
      key = MODIFIER_KEY_NAME[mod];
      this.state.held[mod] = true;
    }
    const target = this.keyTarget();
    const ok = this.fire(target, new KeyboardEvent('keydown', this.keyInit(key, code, mods)));
    if (!ok || mod) return;
    const m = this.mods(mods);
    const printable = [...key].length === 1;
    if (printable && !m.ctrl && !m.meta) {
      this.fire(target, new KeyboardEvent('keypress', { ...this.keyInit(key, code, mods), charCode: key.codePointAt(0) } as any));
    }
    this.defaultKeyAction(target, key, m, printable);
  }

  /** What the browser would do for an unhandled key in an editable. */
  private defaultKeyAction(target: Element, key: string, m: Modifiers, printable: boolean): void {
    const cmd = m.meta || m.ctrl;
    const exec = (c: string, v?: string) => {
      try {
        return document.execCommand(c, false, v);
      } catch {
        return false;
      }
    };
    if (cmd) {
      const k = key.toLowerCase();
      if (k === 'a') exec('selectAll');
      else if (k === 'z') exec(m.shift ? 'redo' : 'undo');
      else if (k === 'y') exec('redo');
      return;
    }
    if (!isEditable(target)) return;
    if (printable) {
      exec('insertText', key);
      return;
    }
    switch (key) {
      case 'Backspace':
        exec('delete');
        return;
      case 'Delete':
        exec('forwardDelete');
        return;
      case 'Enter':
        if (target instanceof HTMLTextAreaElement) exec('insertText', '\n');
        else if ((target as HTMLElement).isContentEditable) exec(m.shift ? 'insertLineBreak' : 'insertParagraph');
        return;
      case 'Tab':
        return;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'Home':
      case 'End':
        this.moveCaret(target, key, !!m.shift);
        return;
    }
  }

  private moveCaret(target: Element, key: string, extend: boolean): void {
    if (isTextInput(target)) {
      const el = target;
      const len = el.value.length;
      const s = el.selectionStart ?? len;
      const e = el.selectionEnd ?? len;
      let pos = key === 'ArrowLeft' ? Math.max(0, (extend ? e : s) - 1) : key === 'ArrowRight' ? Math.min(len, (extend ? e : e) + 1) : key === 'Home' ? 0 : len;
      if (!extend && s !== e && (key === 'ArrowLeft' || key === 'ArrowRight')) pos = key === 'ArrowLeft' ? s : e;
      try {
        if (extend) el.setSelectionRange(Math.min(s, pos), Math.max(s, pos));
        else el.setSelectionRange(pos, pos);
      } catch {
        /* type=number etc. */
      }
      return;
    }
    const sel = window.getSelection() as any;
    if (sel?.modify) {
      const dir = key === 'ArrowLeft' || key === 'Home' ? 'backward' : 'forward';
      const unit = key === 'Home' || key === 'End' ? 'lineboundary' : 'character';
      sel.modify(extend ? 'extend' : 'move', dir, unit);
    }
  }

  keyUp(key: string, code?: string, mods: Modifiers = {}): void {
    const mod = modifierOf(key);
    if (mod) {
      key = MODIFIER_KEY_NAME[mod];
      this.state.held[mod] = false;
    }
    this.keyTarget().dispatchEvent(new KeyboardEvent('keyup', this.keyInit(key, code, mods)));
  }

  /** Types text as a keydown(+insert)/keyup per character, `perCharMs` apart. */
  async type(text: string, perCharMs = 25, isCanceled: () => boolean = () => false): Promise<void> {
    for (const ch of text) {
      if (isCanceled()) return;
      const key = ch === '\n' ? 'Enter' : ch;
      const mods: Modifiers = ch !== ch.toLowerCase() && [...ch].length === 1 ? { shift: true } : {};
      this.keyDown(key, undefined, mods);
      this.keyUp(key, undefined, mods);
      if (perCharMs > 0) await sleep(perCharMs);
    }
  }
}

export function codeFor(key: string): string {
  if ([...key].length === 1) {
    if (/[a-z]/i.test(key)) return 'Key' + key.toUpperCase();
    if (/[0-9]/.test(key)) return 'Digit' + key;
    if (key === ' ') return 'Space';
  }
  if (key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift') return key + 'Left';
  return key;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
