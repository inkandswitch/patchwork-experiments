// The input router: DOM input on the canvas → event values, offered down the
// chain until something claims them (STAGE.md, "The input chain"; TOOLS.md
// §4, §5). It owns the open session (one gesture at a time), the body stack
// (the stage's Look or Edit always at the bottom), the held tool (one slot), the open popovers,
// pointer lock (stage/pointer.js), the Escape ladder (stage/ladder.js),
// which keys are down and who claimed them, `menu` synthesis and the cursor.
// It knows nothing about three.js or the doc: picking, rays, the chain order
// and each extension's input all come in as functions.
//
// A press goes: the held tool, the chain (the widget's owner, the holders
// nearest first, the general extensions), then the top body's default (in
// Edit, Select; Look has none). A key goes: the open gesture's declared keys, the held
// tool's, the top body's, then the chain (where the key map is the only
// taker). Presses have a position, so the body comes last there; keys have
// none, so what reserves them comes first.
//
// Pointer and wheel listeners sit on the port in the capture phase, so they
// run before OrbitControls (which listens on the canvas itself): a claimed
// press or wheel is stopped there and orbit never sees it. Anything whose
// target isn't the canvas (labels, overlays, edges) is left to the DOM.

import { offer } from "./chain.js";
import { fromEmbed } from "../embed.js";
import { reservedBy } from "../keymap.js";
import { escapeLayer } from "./ladder.js";
import { lockedNow, pointerStep } from "./pointer.js";

/** How far (px) a press may wander and still be a tap / click. */
export const SLOP = 4;
/** How long (ms) a touch held still takes to become a `menu`. */
export const HOLD_MS = 500;

/** Is this a Mac (where ctrl+click means right-click)? */
export function isMac(nav = globalThis.navigator) {
  return /Mac/i.test(`${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`);
}

/**
 * What a press released under the slop becomes: "click" (primary), "menu"
 * (right button, or ctrl+primary on a Mac), or null (middle and the rest).
 */
export function releaseKind({ button, ctrl }, mac) {
  if (button === 2) return "menu";
  if (button === 0) return ctrl && mac ? "menu" : "click";
  return null;
}

/** Is someone typing into this element (so it keeps its keys)? */
export function isTyping(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!el.isContentEditable || el.getAttribute?.("contenteditable") === "true";
}

// A copy of an event with one field changed; its lazy getters still share one memo.
function copyWith(ev, key, value) {
  const d = Object.getOwnPropertyDescriptors(ev);
  d[key] = { value, enumerable: true, writable: true, configurable: true };
  return Object.defineProperties({}, d);
}

/** The same event for one extension: every field (lazy ones still shared and memoised) plus its `holder`. */
export const withHolder = (ev, holder) => copyWith(ev, "holder", holder ?? null);

/** The same event as another type (a release that becomes a click or a menu). */
export const retype = (ev, type) => copyWith(ev, "type", type);

/**
 * Build an event value (STAGE.md, the `event` shape) from a DOM event. `hit`,
 * `widget` and `ray` are lazy, memoised getters: nothing is picked unless
 * someone reads them. Under pointer lock x, y and ndc are the canvas centre
 * and the ray is the camera's forward ray.
 *
 * @param {string} type
 * @param {Event | null} e   a PointerEvent / MouseEvent / WheelEvent / KeyboardEvent, or null
 * @param {{
 *   portRect: { left: number, top: number },
 *   canvasRect: { left: number, top: number, width: number, height: number },
 *   locked?: boolean,
 *   at?: { clientX: number, clientY: number } | null,  // where the pointer is, for key events
 *   noHit?: boolean,                                   // key events: hit and widget are null
 *   pick?: (x: number, y: number, opts?: object) => object | null,
 *   pickWidget?: (ev: object) => object | null,
 *   ray?: (x: number, y: number) => { origin: any, dir: any },
 *   centerRay?: () => { origin: any, dir: any },
 * }} ctx
 */
export function buildEvent(type, e, ctx) {
  const { portRect, canvasRect: cr, locked = false } = ctx;
  let clientX, clientY;
  if (locked) {
    clientX = cr.left + cr.width / 2;
    clientY = cr.top + cr.height / 2;
  } else {
    const at = e && typeof e.clientX === "number" ? e : ctx.at;
    clientX = at?.clientX ?? null;
    clientY = at?.clientY ?? null;
  }
  const known = clientX != null && clientY != null;
  const x = known ? clientX - portRect.left : null;
  const y = known ? clientY - portRect.top : null;
  const ndc = locked
    ? [0, 0]
    : known
      ? [cr.width ? ((clientX - cr.left) / cr.width) * 2 - 1 : 0, cr.height ? -(((clientY - cr.top) / cr.height) * 2 - 1) : 0]
      : null;
  const fields = {
    type,
    x,
    y,
    clientX,
    clientY,
    ndc,
    holder: null,
    button: e?.button ?? null,
    buttons: e?.buttons ?? 0,
    pointerId: e?.pointerId ?? null,
    pointerType: e?.pointerType ?? (e && "button" in e ? "mouse" : null),
    shift: !!e?.shiftKey,
    alt: !!e?.altKey,
    ctrl: !!e?.ctrlKey,
    meta: !!e?.metaKey,
    key: e?.key ?? null,
    code: e?.code ?? null,
    repeat: !!e?.repeat,
    dx: e?.movementX ?? 0,
    dy: e?.movementY ?? 0,
    deltaY: e?.deltaY ?? 0,
    locked,
  };
  const noHit = ctx.noHit || !known;
  const lazy = {
    ray: () => (locked ? (ctx.centerRay?.() ?? null) : known ? (ctx.ray?.(x, y) ?? null) : null),
    hit: () => (noHit ? null : (ctx.pick?.(x, y, { snapPx: 0 }) ?? null)),
    widget: () => (noHit ? null : (ctx.pickWidget?.(ev) ?? null)),
  };
  const memo = {};
  const ev = { ...fields };
  for (const k of Object.keys(lazy)) {
    Object.defineProperty(ev, k, {
      enumerable: true,
      configurable: true,
      get: () => (k in memo ? memo[k] : (memo[k] = lazy[k]())),
    });
  }
  return ev;
}

// Call an optional method, keeping one extension's failure its own.
function call(owner, obj, name, ...args) {
  const fn = obj?.[name];
  if (typeof fn !== "function") return undefined;
  try {
    return fn.apply(obj, args);
  } catch (err) {
    console.warn(`[scene] ${owner}: ${name} failed`, err);
    return undefined;
  }
}

/**
 * A body on the stack, as the router keeps it: its input (press, click,
 * menu, move, wheel, key, keyup, cursor, suspended, resumed), whether it
 * asks for pointer lock, and the keys it declares ([{ code, label }]).
 * @typedef {{ id: string, input?: object, lock?: boolean, keys?: { code: string, label?: string }[] }} RouterBody
 */

/**
 * @param {{
 *   port: HTMLElement,                   // the canvas's positioned parent; x, y are relative to it
 *   canvas: HTMLCanvasElement,
 *   keyRoot: HTMLElement,                // keys are heard here (the tool's root)
 *   pick: (x: number, y: number, opts?: object) => object | null,
 *   pickWidget: (ev: object) => object | null,
 *   ray: (x: number, y: number) => { origin: any, dir: any },
 *   centerRay: () => { origin: any, dir: any },
 *   chainFor: (ev: object) => { order: string[], holderOf: (id: string) => string | null },
 *   inputOf: (id: string) => object | undefined,
 *   base: RouterBody,                    // the body at the bottom of the stack, always there (setBase changes it)
 *   cameraHeld: () => boolean,
 *   onHover: (ev: object | null) => void,
 *   onCursor: (name: string | null) => void,
 *   onState?: (state: object) => void,   // the body, the held tool, the gesture's keys, the pointer or the ladder changed
 *   pointerWanted?: () => boolean,       // something of the stage's wants the pointer (a selection, the open drawer)
 *   selection?: () => boolean,           // is anything selected? (the ladder's selection rung)
 *   deselect?: () => void,
 *   focusDepth?: () => number,           // how deep the focus is (the ladder's last rung)
 *   leaveFocus?: () => void,
 *   requestLock?: () => Promise<void> | void,
 *   exitLock?: () => void,
 *   mac?: boolean,
 * }} o
 */
export function createRouter(o) {
  const { port, canvas, keyRoot, chainFor, inputOf } = o;
  const mac = o.mac ?? isMac();
  const doc = canvas.ownerDocument ?? document;
  const win = doc.defaultView ?? globalThis;
  let disposed = false;

  // ─── events ───────────────────────────────────────────────────────────────

  const isLocked = () => doc.pointerLockElement === canvas;
  let lastAt = null; // { clientX, clientY }: where the pointer last was over the canvas

  const make = (type, e, extra) =>
    buildEvent(type, e, {
      portRect: port.getBoundingClientRect(),
      canvasRect: canvas.getBoundingClientRect(),
      locked: isLocked(),
      at: lastAt,
      pick: o.pick,
      pickWidget: o.pickWidget,
      ray: o.ray,
      centerRay: o.centerRay,
      ...extra,
    });

  // The body stack, the base at the bottom; the held tool; the open popovers.
  const baseEntry = (b) => ({ owner: null, id: b?.id ?? "base", input: b?.input ?? {}, lock: !!b?.lock, keys: b?.keys ?? [], suspended: false });
  const stack = [baseEntry(o.base)]; // [{ owner, id, input, lock, keys, suspended }], top last
  const top = () => stack.at(-1);
  let tool = null; // { owner, command, name, input, keys, pointer }
  const popovers = []; // [{ owner, close }], latest last

  // An event offered to one handler set under a name that is never an extension's.
  const offerTo = (name, handlers, type, ev) => offer([name], () => handlers, type, () => withHolder(ev, null));

  // Offer an event: the held tool first, then the chain, then the top body
  // (its default: in Edit, Select). The chain is only worked out if the
  // tool passes, so an event the tool takes never picks.
  function dispatch(type, ev) {
    if (tool) {
      const r = offerTo(tool.owner, tool.input, type, ev);
      if (r) return r;
    }
    return offerChain(type, ev) ?? offerTo(top().owner ?? "scene", top().input, type, ev);
  }
  function offerChain(type, ev) {
    const { order = [], holderOf } = chainFor(ev) ?? {};
    return offer(order, inputOf, type, (id) => withHolder(ev, holderOf?.(id) ?? null));
  }

  // ─── the cursor ───────────────────────────────────────────────────────────

  let cursorNow; // undefined until first resolved, so the first answer always goes out
  function setCursor(name) {
    const v = name || null;
    if (v === cursorNow) return;
    cursorNow = v;
    o.onCursor?.(v);
  }
  // The open session's cursor, else the tool's, else the first extension
  // down the chain with an opinion, else the body's.
  function resolveCursor(ev) {
    const s = gesture && !gesture.dead ? gesture.session : null;
    if (s?.cursor) return setCursor(s.cursor);
    if (!ev) return setCursor(null);
    if (tool) {
      const c = call(tool.owner, tool.input, "cursor", withHolder(ev, null));
      if (c) return setCursor(c);
    }
    const { order = [], holderOf } = chainFor(ev) ?? {};
    for (const id of order) {
      const c = call(id, inputOf(id), "cursor", withHolder(ev, holderOf?.(id) ?? null));
      if (c) return setCursor(c);
    }
    setCursor(call(top().owner, top().input, "cursor", withHolder(ev, null)) ?? null);
  }

  // ─── hover ────────────────────────────────────────────────────────────────

  let hoverQueued = null; // the latest DOM move waiting for the next frame
  let hoverFrame = 0;
  function queueHover(e) {
    if (hoverQueued) {
      hoverQueued = e;
      return;
    }
    hoverQueued = e;
    hoverFrame = requestAnimationFrame(() => {
      const de = hoverQueued;
      hoverQueued = null;
      hoverFrame = 0;
      if (disposed || (gesture?.session && !gesture.dead)) return;
      const ev = make("move", de);
      o.onHover?.(ev);
      resolveCursor(ev);
    });
  }
  function cancelHover() {
    if (hoverFrame) cancelAnimationFrame(hoverFrame);
    hoverFrame = 0;
    hoverQueued = null;
  }

  // ─── gestures ─────────────────────────────────────────────────────────────
  //
  // One press at a time. `session` is set when something claimed it; an
  // unclaimed press is still watched, so a release under the slop can offer a
  // click (or menu). `dead` means it was cancelled (Escape, a touch hold, the
  // owner stopping): its release does nothing.

  let gesture = null; // { pointerId, button, ctrl, pointerType, x0, y0, lx, ly, moved, session, owner, dead, holdTimer }
  const openSession = () => (gesture && !gesture.dead && gesture.session ? gesture.session : null);

  const travelled = (g, e) =>
    isLocked() ? Math.hypot(g.lx, g.ly) : Math.hypot((e.clientX ?? g.x0) - g.x0, (e.clientY ?? g.y0) - g.y0);

  const claim = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };

  function release(g) {
    clearTimeout(g.holdTimer);
    g.holdTimer = 0;
    if (!g.session) return;
    try {
      if (canvas.hasPointerCapture?.(g.pointerId)) canvas.releasePointerCapture(g.pointerId);
    } catch {
      // synthetic pointers can't be captured
    }
  }

  // Cancel the open session (if any) and let the rest of the gesture go by.
  function killGesture() {
    const g = gesture;
    if (!g || g.dead) return;
    const had = !!g.session;
    g.dead = true;
    clearTimeout(g.holdTimer);
    g.holdTimer = 0;
    if (g.session) call(g.owner, g.session, "cancel");
    if (had) changed();
  }

  // A release (or touch hold) that didn't travel: click, or menu.
  function offerRelease(kind, ev, e) {
    if (!kind) return;
    if (dispatch(kind, retype(ev, kind))) e?.preventDefault?.();
  }

  function onPointerDown(e) {
    if (e.target !== canvas) return;
    // a second pointer while a gesture is claimed is swallowed; while one is
    // unclaimed it belongs to orbit (a pinch), and the first is no longer a click
    if (gesture && !gesture.dead && gesture.pointerId !== e.pointerId) {
      if (gesture.session) return claim(e);
      gesture.moved = true;
      clearTimeout(gesture.holdTimer);
      return;
    }
    if (gesture) {
      // the same pointer pressing again: its release went missing
      killGesture();
      release(gesture);
      gesture = null;
    }
    // claimed presses preventDefault, which also stops the browser moving
    // focus, so bring keys to this view by hand
    if (keyRoot && doc.activeElement !== keyRoot) keyRoot.focus?.({ preventScroll: true });
    lastAt = { clientX: e.clientX, clientY: e.clientY };
    // after the browser released the lock, a press on the world only takes it back
    if (pointerEvent({ type: "press" })) {
      claim(e);
      return;
    }
    const g = {
      pointerId: e.pointerId,
      button: e.button,
      ctrl: !!e.ctrlKey,
      pointerType: e.pointerType || "mouse",
      x0: e.clientX,
      y0: e.clientY,
      lx: 0,
      ly: 0,
      moved: false,
      session: null,
      owner: null,
      dead: false,
      holdTimer: 0,
    };
    gesture = g;
    cancelHover();
    const ev = make("press", e);
    const r = dispatch("press", ev);
    if (gesture !== g) return; // something in press tore it down
    if (r) {
      g.session = r.result && typeof r.result === "object" ? r.result : {};
      g.owner = r.id;
      claim(e);
      try {
        canvas.setPointerCapture?.(e.pointerId);
      } catch {
        // synthetic pointers can't be captured
      }
      if (g.session.cursor) setCursor(g.session.cursor);
      changed();
    }
    if (g.pointerType === "touch") {
      g.holdTimer = setTimeout(() => {
        g.holdTimer = 0;
        if (gesture !== g || g.dead || g.moved) return;
        killGesture();
        offerRelease("menu", ev);
      }, HOLD_MS);
    }
  }

  function onPointerMove(e) {
    const g = gesture && gesture.pointerId === e.pointerId ? gesture : null;
    // A mouse that moves with no button down was released where we didn't
    // hear it (outside the window, behind a dialog): the gesture is cancelled
    // (put back, never committed where nobody saw it land), rather than
    // carrying on with the hover. (Chrome says so first, as a lost capture.)
    if (g && !g.dead && g.pointerType === "mouse" && e.buttons === 0) return onPointerCancel(e);
    if (e.target !== canvas && !g) return;
    const locked = isLocked();
    if (!locked) lastAt = { clientX: e.clientX, clientY: e.clientY };
    let ev = null;
    const evNow = () => (ev ??= make("move", e));
    // the top body and the held tool hear every move (mouse-look under lock)
    const b = top();
    if (typeof b.input.move === "function") call(b.owner ?? "scene", b.input, "move", withHolder(evNow(), null));
    if (tool && typeof tool.input.move === "function") call(tool.owner, tool.input, "move", withHolder(evNow(), null));
    if (g && !g.dead) {
      if (locked) {
        g.lx += e.movementX ?? 0;
        g.ly += e.movementY ?? 0;
      }
      if (!g.moved && travelled(g, e) > SLOP) {
        g.moved = true;
        clearTimeout(g.holdTimer);
        g.holdTimer = 0;
      }
      if (g.session && g.moved) {
        call(g.owner, g.session, "move", evNow());
        if (g.session.cursor) setCursor(g.session.cursor);
      }
      if (g.session) return;
    }
    if (!e.buttons && e.target === canvas) queueHover(e);
  }

  function onPointerUp(e) {
    const g = gesture;
    if (!g || g.pointerId !== e.pointerId) {
      // a second pointer's release, while the first's session is open
      if (g?.session && !g.dead && e.target === canvas) claim(e);
      return;
    }
    gesture = null;
    release(g);
    if (g.dead) {
      if (g.session) claim(e);
      return;
    }
    if (!g.moved && travelled(g, e) > SLOP) g.moved = true;
    const ev = make("click", e);
    const kind = releaseKind(g, mac);
    if (g.session) {
      claim(e);
      if (g.moved) call(g.owner, g.session, "end", retype(ev, "move"));
      else if (!call(g.owner, g.session, "tap", ev)) {
        call(g.owner, g.session, "cancel");
        offerRelease(kind, ev, e);
      }
      changed();
      resolveCursor(e.target === canvas ? retype(ev, "move") : null);
      return;
    }
    if (!g.moved) offerRelease(kind, ev, e);
  }

  function onPointerCancel(e) {
    const g = gesture;
    if (!g || g.pointerId !== e.pointerId) return;
    killGesture(); // cancel, never commit
    gesture = null;
    release(g);
    setCursor(null);
  }

  // The browser took the capture away without a pointerup (the element was
  // hidden, the capture lost to another): the gesture is cancelled, never
  // committed.
  function onLostCapture(e) {
    const g = gesture;
    if (!g || g.dead || !g.session || g.pointerId !== e.pointerId) return;
    onPointerCancel(e);
  }

  function onPointerLeave() {
    cancelHover();
    o.onHover?.(null);
    call(top().owner ?? "scene", top().input, "leave");
    if (tool) call(tool.owner, tool.input, "leave");
  }

  function onDblClick(e) {
    if (e.target !== canvas) return;
    if (dispatch("dblclick", make("dblclick", e))) e.preventDefault();
  }

  function onContextMenu(e) {
    // `menu` is synthesised from the release; the browser's menu never shows
    if (e.target === canvas) e.preventDefault();
  }

  function onWheel(e) {
    if (e.target !== canvas) return;
    const r = dispatch("wheel", make("wheel", e));
    if (r || o.cameraHeld?.()) {
      // claimed, or the camera is held: orbit mustn't zoom
      e.preventDefault();
      e.stopPropagation();
    }
  }

  // ─── the Escape ladder ────────────────────────────────────────────────────

  /** The ladder's state now (stage/ladder.js). The field rung is the DOM's: a typing target blurs before this is asked. */
  function ladderState() {
    return {
      lock: isLocked(),
      field: false,
      popover: popovers.length > 0,
      gesture: !!openSession(),
      tool: !!tool,
      selection: !!o.selection?.(),
      focus: Number(o.focusDepth?.() ?? 0) || 0,
    };
  }

  /** Escape: pop the top layer, exactly one. @returns the layer popped, or null */
  function escape() {
    const layer = escapeLayer(ladderState());
    switch (layer) {
      case "popover": {
        const p = popovers.at(-1);
        call(p.owner, p, "close");
        // (a close that didn't release itself is let go of all the same)
        const i = popovers.indexOf(p);
        if (i >= 0) popovers.splice(i, 1);
        break;
      }
      case "gesture":
        killGesture();
        break;
      case "tool":
        putDown();
        break;
      case "selection":
        o.deselect?.();
        break;
      case "focus":
        o.leaveFocus?.();
        break;
      default:
        // the lock is the browser's own: the page never sees that Escape
        return null;
    }
    changed();
    return layer;
  }

  // ─── keys ─────────────────────────────────────────────────────────────────

  // code → { owner, key, code, up(ev) }: who claimed each key that's down
  const down = new Map();

  const keyEvent = (type, e) => make(type, e, { noHit: true });

  function onKeyDown(e) {
    if (fromEmbed(e, keyRoot)) return;
    const target = e.composedPath?.()[0] ?? e.target;
    if (isTyping(target)) {
      // the field rung: Escape leaves the field, and is nothing else (a search
      // field with text clears first: its query is a layer of its own)
      if (e.key === "Escape") {
        if (target.type === "search" && target.value) {
          e.preventDefault();
          target.value = "";
          target.dispatchEvent(new Event("input", { bubbles: true }));
        } else target.blur?.();
      }
      return;
    }
    if (e.key === "Escape") {
      if (escape()) e.preventDefault();
      return;
    }
    // a menu's or a dialog's keys are its own (arrows, Enter on a focused choice): only Escape is the ladder's
    if (target !== keyRoot && target?.closest?.('[role="menu"], [role="dialog"]')) return;
    pointerEvent({ type: "key" });
    const ev = keyEvent("key", e);
    const code = e.code || e.key;
    let claimer = null;
    // what reserves keys first: the gesture's, the held tool's, the body's (keymap.js reservedBy)
    const g = gesture && !gesture.dead && gesture.session ? gesture : null;
    const b = top();
    const by = reservedBy(code, { gesture: g?.session ?? null, tool, body: b });
    if (by === "gesture") {
      const s = g.session;
      if (call(g.owner, s, "key", withHolder(ev, null))) claimer = { owner: g.owner, up: (kev) => call(g.owner, s, "keyup", kev) };
    } else if (by === "tool") {
      const t = tool;
      if (call(t.owner, t.input, "key", withHolder(ev, null))) claimer = { owner: t.owner, up: (kev) => call(t.owner, t.input, "keyup", kev) };
    } else if (by === "body") {
      if (call(b.owner ?? "scene", b.input, "key", withHolder(ev, null))) claimer = { owner: b.owner, body: b, up: (kev) => call(b.owner ?? "scene", b.input, "keyup", kev) };
    } else {
      const r = offerChain("key", ev);
      if (r) claimer = { owner: r.id, up: (kev) => call(r.id, inputOf(r.id), "keyup", kev) };
    }
    // a reserved key is its reserver's even when it does nothing with it
    if (!claimer && !by) return;
    e.preventDefault();
    if (!claimer) return;
    const was = down.get(code);
    if (was && was.owner !== claimer.owner) was.up(retype(ev, "keyup"));
    if (!was || was.owner !== claimer.owner) down.set(code, { ...claimer, key: e.key, code: e.code });
  }

  function onKeyUp(e) {
    if (fromEmbed(e, keyRoot)) return;
    const code = e.code || e.key;
    const c = down.get(code);
    if (!c) return;
    down.delete(code);
    c.up(keyEvent("keyup", e));
    e.preventDefault();
  }

  // A keyup for every claimed key still down (blur, hidden page, lost lock),
  // or only those one extension holds, or one body.
  function releaseKeys(owner = undefined, body = null) {
    for (const [code, c] of [...down]) {
      if (owner !== undefined && c.owner !== owner) continue;
      if (body && c.body !== body) continue;
      down.delete(code);
      c.up(keyEvent("keyup", { key: c.key, code: c.code }));
    }
  }

  // Leaving the window (Cmd-Tab, a native dialog) mid-gesture: its release
  // may never come back to us, so the gesture is cancelled (put back) now.
  function dropGesture() {
    const g = gesture;
    if (!g) return;
    killGesture();
    gesture = null;
    release(g);
    setCursor(null);
  }
  const onBlur = () => {
    dropGesture();
    releaseKeys();
  };
  const onVisibility = () => {
    if (doc.visibilityState !== "hidden") return;
    dropGesture();
    releaseKeys();
  };

  // ─── the pointer (stage/pointer.js) ───────────────────────────────────────

  let ptr = { lock: !!stack[0].lock, wanted: false, released: false, refused: false };
  let exiting = false; // the lock is going because this page let it go, not the browser
  let requested = false; // a request is out, unanswered

  /** Apply a pointer event to the state, then lock or unlock to match. @returns whether a press was only a relock */
  function pointerEvent(ev) {
    const { state, consumed } = pointerStep(ptr, ev);
    const was = ptr;
    ptr = state;
    apply();
    if (state !== was) changed();
    return consumed;
  }

  function apply() {
    if (disposed) return;
    const want = lockedNow(ptr);
    if (want && !isLocked() && !requested) requestLockNow();
    else if (!want && (isLocked() || requested)) exitLockNow();
  }

  function requestLockNow() {
    requested = true;
    let p;
    try {
      p = o.requestLock ? o.requestLock() : canvas.requestPointerLock?.();
      p = p && typeof p.then === "function" ? p : Promise.resolve();
    } catch (err) {
      p = Promise.reject(err);
    }
    p.catch((err) => refusedNow(err));
  }
  function exitLockNow() {
    requested = false;
    if (!isLocked()) return;
    exiting = true;
    try {
      if (o.exitLock) o.exitLock();
      else doc.exitPointerLock?.();
    } catch {
      exiting = false;
    }
  }

  // The browser said no (pointerlockerror, or the request's promise
  // rejecting; often both): refused, once.
  function refusedNow(err) {
    if (!requested || isLocked()) return;
    requested = false;
    if (err) console.warn("[scene] pointer lock refused", err);
    pointerEvent({ type: "refuse" });
  }

  function onLockChange() {
    const now = isLocked();
    if (now) {
      requested = false;
      // granted after all, but no longer wanted
      if (!lockedNow(ptr)) exitLockNow();
      changed();
      return;
    }
    const ours = exiting;
    exiting = false;
    releaseKeys();
    // the browser let go (its Escape): released, until the next press on the world
    if (!ours) pointerEvent({ type: "release" });
    else changed();
  }
  const onLockError = () => refusedNow(null);

  /** Something of the stage's may want the pointer now (a selection, the drawer): look again. */
  function refresh() {
    const wanted = !!tool?.pointer || popovers.length > 0 || !!o.pointerWanted?.();
    if (wanted !== ptr.wanted) pointerEvent({ type: "want", wanted });
    else changed();
  }

  // ─── what the stage is told ───────────────────────────────────────────────

  let stateKey = "";
  function changed() {
    if (disposed || !o.onState) return;
    const st = snapshot();
    const key = JSON.stringify(st);
    if (key === stateKey) return;
    stateKey = key;
    o.onState(st);
  }
  function snapshot() {
    const b = top();
    const s = openSession();
    return {
      body: { id: b.id, owner: b.owner, depth: stack.length - 1, lock: !!b.lock, keys: [...(b.keys ?? [])] },
      bodies: stack.map((x) => ({ id: x.id, owner: x.owner })),
      held: tool ? { ext: tool.owner, command: tool.command, name: tool.name ?? tool.command, keys: [...(tool.keys ?? [])], pointer: !!tool.pointer } : null,
      gesture: s ? { owner: gesture.owner, keys: [...(Array.isArray(s.keys) ? s.keys : [])] } : null,
      pointer: { locked: isLocked(), lock: ptr.lock, wanted: ptr.wanted, released: ptr.released, refused: ptr.refused },
      escape: escapeLayer(ladderState()),
    };
  }

  // ─── the body stack ───────────────────────────────────────────────────────

  // After the stack changes: the old top (if still there) is suspended, the
  // new one resumed (if it had been), the pointer worked out for it, and the
  // cursor again.
  function settle(prevTop) {
    const t = top();
    if (t !== prevTop) {
      if (prevTop && stack.includes(prevTop) && !prevTop.suspended) {
        prevTop.suspended = true;
        releaseKeys(undefined, prevTop);
        call(prevTop.owner ?? "scene", prevTop.input, "suspended");
      }
      if (t.suspended) {
        t.suspended = false;
        call(t.owner ?? "scene", t.input, "resumed");
      }
      pointerEvent({ type: "body", lock: t.lock });
    }
    changed();
    if (!gesture?.session) resolveCursor(lastAt && !isLocked() ? make("move", null) : null);
  }

  /**
   * Push a body on the stack (its owner's: an extension id).
   * @param {string} owner  @param {RouterBody} body
   * @returns {() => void} pop it (wherever it is in the stack; anything over it goes with it)
   */
  function pushBody(owner, body) {
    if (disposed) return () => {};
    const prevTop = top();
    const entry = { owner, id: body.id, input: body.input ?? {}, lock: !!body.lock, keys: body.keys ?? [], suspended: false };
    stack.push(entry);
    settle(prevTop);
    return () => popBody(entry);
  }
  // A body leaving takes every body over it too: they stood on it.
  function popBody(entry) {
    const i = stack.indexOf(entry);
    if (i <= 0) return false;
    const prevTop = top();
    const gone = stack.splice(i);
    for (const x of gone.reverse()) {
      releaseKeys(undefined, x);
      call(x.owner ?? "scene", x.input, "left");
    }
    settle(prevTop);
    return true;
  }

  /**
   * Make `body` the base, the body at the bottom of the stack (the stage's
   * Look or Edit): every body standing on the old one leaves first, then
   * the base itself is replaced (its keys let go; "left" told to the old,
   * "resumed" to nothing: the new base starts on top).
   * @param {RouterBody} body
   */
  function setBase(body) {
    if (disposed) return;
    if (stack.length > 1) popBody(stack[1]);
    const old = stack[0];
    if (old.id === body?.id && old.input === (body?.input ?? {})) return;
    releaseKeys(undefined, old);
    stack[0] = baseEntry(body);
    call("scene", old.input, "left");
    settle(old);
  }

  // ─── the held tool ────────────────────────────────────────────────────────

  /**
   * Hold a tool: the slot's one occupant; whatever was held is put down first.
   * @param {string} owner  @param {{ command: string | null (a tool held directly, not through a command), name?: string, input: object, keys?: object[], pointer?: boolean }} t
   * @returns {() => void} put it down (if it's still the one held)
   */
  function hold(owner, t) {
    if (disposed) return () => {};
    putDown();
    const entry = { owner, command: t.command, name: t.name, input: t.input ?? {}, keys: t.keys ?? [], pointer: !!t.pointer };
    tool = entry;
    refresh();
    changed();
    if (!gesture?.session) resolveCursor(lastAt && !isLocked() ? make("move", null) : null);
    return () => {
      if (tool === entry) putDown();
    };
  }
  function putDown() {
    const t = tool;
    if (!t) return;
    tool = null;
    releaseKeys(t.owner);
    call(t.owner, t.input, "put");
    refresh();
    changed();
  }

  // ─── popovers ─────────────────────────────────────────────────────────────

  /** An open menu or dialog: it wants the pointer, and Escape closes it. @returns release (when it closes itself) */
  function popover(owner, close) {
    if (disposed) return () => {};
    const p = { owner, close };
    popovers.push(p);
    refresh();
    return () => {
      const i = popovers.indexOf(p);
      if (i < 0) return;
      popovers.splice(i, 1);
      refresh();
    };
  }

  // ─── stopping ─────────────────────────────────────────────────────────────

  /** An extension stopped: its open session, keys, bodies, tool and popovers go. */
  function stopOwner(id) {
    if (gesture?.owner === id) killGesture();
    releaseKeys(id);
    const mine = stack.findIndex((x, i) => i > 0 && x.owner === id);
    if (mine > 0) popBody(stack[mine]);
    if (tool?.owner === id) putDown();
    for (const p of popovers.filter((p) => p.owner === id)) popovers.splice(popovers.indexOf(p), 1);
    refresh();
  }

  // ─── wiring ───────────────────────────────────────────────────────────────

  const listeners = [
    [port, "pointerdown", onPointerDown, { capture: true }],
    [port, "pointermove", onPointerMove, { capture: true }],
    [port, "pointerup", onPointerUp, { capture: true }],
    [port, "pointercancel", onPointerCancel, { capture: true }],
    [port, "dblclick", onDblClick, { capture: true }],
    [port, "contextmenu", onContextMenu, { capture: true }],
    [port, "wheel", onWheel, { capture: true, passive: false }],
    [canvas, "pointerleave", onPointerLeave, undefined],
    [canvas, "lostpointercapture", onLostCapture, undefined],
    [keyRoot, "keydown", onKeyDown, undefined],
    [keyRoot, "keyup", onKeyUp, undefined],
    [win, "blur", onBlur, undefined],
    [doc, "visibilitychange", onVisibility, undefined],
    [doc, "pointerlockchange", onLockChange, undefined],
    [doc, "pointerlockerror", onLockError, undefined],
  ];
  for (const [t, type, fn, opts] of listeners) t?.addEventListener(type, fn, opts);
  changed();

  return {
    pushBody,
    setBase,
    /** the top body: { id, owner } */
    body: () => ({ id: top().id, owner: top().owner }),
    /** the stack, bottom first: [{ id, owner }] */
    bodies: () => stack.map((x) => ({ id: x.id, owner: x.owner })),
    /** pop the top body (never the base). @returns whether one went */
    leave: () => popBody(top()),
    hold,
    putDown,
    /** the held tool, as { owner, command }, or null */
    held: () => (tool ? { owner: tool.owner, command: tool.command } : null),
    popover,
    escape,
    refresh,
    state: snapshot,
    stopOwner,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const [t, type, fn, opts] of listeners) t?.removeEventListener(type, fn, opts);
      cancelHover();
      if (gesture) {
        killGesture();
        release(gesture);
        gesture = null;
      }
      down.clear();
      stack.length = 1;
      tool = null;
      popovers.length = 0;
      if (requested || isLocked()) exitLockNow();
    },
  };
}
