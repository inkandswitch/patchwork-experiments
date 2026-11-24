// The input router: DOM input on the canvas → event values, offered down the
// chain until something claims them (STAGE.md, "The input chain"). It owns
// the open session (one gesture at a time), the body stack (stage/body-stack.js:
// the stage's Look always at the bottom), the hands (stage/hands.js: one stack
// of what the viewer holds: the held tools, popovers, the Edit hand), pointer
// lock (stage/pointer.js), Escape (stage/ladder.js), which keys are down and
// who claimed them, `menu` synthesis and the cursor. Each of those modules is
// a pure rule; the router keeps their state and does what they say. It knows
// nothing about three.js or the doc: picking, rays, the chain order and each
// extension's input all come in as functions.
//
// An event goes: the hands, top first, then the chain (the widget's owner,
// the holders nearest first, the view plugins), then the top body's
// default (Look has none). Each hand consumes it (true, a session) or
// passes it on (false or null), having acted on it or not: the Edit hand
// takes a click it has something to select or clear with (a widget's owner
// under it first); a popover consumes everything (it is modal); the X-ray
// passes everything. Picking up a tool puts it on top; it never puts
// another down. A key goes: the open gesture's declared keys, the topmost
// hand's that declares it, the top body's, then the chain (where the key
// map is the only taker). Presses have a position, so the body comes last
// there; keys have none, so what reserves them comes first.
//
// Pointer and wheel listeners sit on the port in the capture phase, so they
// run before OrbitControls (which listens on the canvas itself): a claimed
// press or wheel is stopped there and orbit never sees it. Anything whose
// target isn't the canvas (labels, overlays, edges) is left to the DOM.

import { offer } from "./chain.js";
import { fromEmbed } from "../shared/embed.js";
import { isTyping, keyHolder, keyOfCode } from "./key-order.js";
import { baseOnly, ownedBody, settleTop, topBody, withBody, withoutBody } from "./body-stack.js";
import { handOf, popoverSpec, refuses, toolSpec, tools, wantsPointer, whichTool, withHand, withoutHand } from "./hands.js";
import { escapeLayer } from "./ladder.js";
import { lockedNow, pointerStep } from "./pointer.js";
import { realTime } from "./time.js";

/** How many routes the router keeps: the last events it dispatched (routes()). */
export const ROUTES = 50;

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

/** Is `el` in something over the canvas that keeps the look while the pointer is on it (`data-keeps-look`: the use prompt)? */
export const keepsLook = (el) => !!el?.closest?.("[data-keeps-look]");

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
 * someone reads them. Under pointer lock x, y are the canvas centre
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
 *   mods?: { shift?, alt?, ctrl?, meta? },             // the modifier keys down at the key root: each flag is the DOM's or this
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
  const fields = {
    type,
    x,
    y,
    holder: null,
    button: e?.button ?? null,
    buttons: e?.buttons ?? 0,
    shift: !!e?.shiftKey || !!ctx.mods?.shift,
    alt: !!e?.altKey || !!ctx.mods?.alt,
    ctrl: !!e?.ctrlKey || !!ctx.mods?.ctrl,
    meta: !!e?.metaKey || !!ctx.mods?.meta,
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
 * A hand on the stack, as its holder gives it: its kind (what it is, for
 * whoever shows it and for the commands that name it; routing never asks:
 * "tool", a held tool; "popover"; a plugin's own), the name the hint and
 * peers show, its input (offered
 * every event first, top hand first: true or a session consumes it, false
 * or null passes it on), the keys it declares (the topmost declaring a key
 * has it), whether it wants the pointer free, its escape() (true: Escape did
 * something, the hand stays; else it is put down) and escaping() (what
 * escape() would do now, as a ladder layer, or null), and put() (told once,
 * whenever it leaves the stack, from wherever it is in it).
 * @typedef {{ kind: string, name?: string, command?: string | null, input?: object, keys?: { code: string, label?: string }[], pointer?: boolean, escape?: () => boolean, escaping?: () => string | null, put?: () => void }} RouterHand
 */

/**
 * @param {{
 *   port: HTMLElement,                   // the canvas's positioned parent; x, y are relative to it
 *   canvas: HTMLCanvasElement,
 *   keyRoot: HTMLElement,                // keys are heard here, and what the input is (every press): the tool's root, around the port and its edges
 *   pick: (x: number, y: number, opts?: object) => object | null,
 *   pickWidget: (ev: object) => object | null,
 *   ray: (x: number, y: number) => { origin: any, dir: any },
 *   centerRay: () => { origin: any, dir: any },
 *   chainFor: (ev: object) => { order: string[], holderOf: (id: string) => string | null, widget?: string | null },  // widget: order[0], when it's the widget's owner
 *   inputOf: (id: string) => object | undefined,
 *   base: RouterBody,                    // the body at the bottom of the stack, always there
 *   cameraHeld: () => boolean,
 *   onHover: (ev: object | null) => void,
 *   onCursor: (name: string | null) => void,
 *   onState?: (state: object) => void,   // the body, the hands, the gesture's keys, the pointer or the ladder changed
 *   pointerWanted?: () => boolean,       // something of the stage's wants the pointer (a selection, a wantPointer())
 *   restLayer?: () => "selection" | "focus" | null,  // what the view's own Escape does now, with no hand held (ladder.js restLayer)
 *   escapeRest?: () => void,             // do it
 *   requestLock?: () => Promise<void> | void,
 *   exitLock?: () => void,
 *   touch?: boolean,                     // is the input touch before any press (a coarse pointer)? Every press then says
 *   mac?: boolean,
 * }} o
 */
export function createRouter(o) {
  const { port, canvas, keyRoot, chainFor, inputOf } = o;
  const time = o.time ?? realTime(); // the stage's (time.js): hover waits a frame, a touch hold its HOLD_MS
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
      mods: heldMods(),
      ...extra,
    });

  // The body stack, Look at the bottom (body-stack.js); the hands, top last
  // (hands.js). Each body, hand and gesture is its own `serial` (one count for
  // all): the same body left and entered again is a new one (the keys it held
  // were let go), which the state says (the touch pad's controls are a layer's).
  let made = 0;
  let bodies = baseOnly({ owner: null, id: o.base?.id ?? "base", input: o.base?.input ?? {}, lock: !!o.base?.lock, keys: o.base?.keys ?? [], serial: ++made });
  const top = () => topBody(bodies);
  let hands = [];

  // An event offered to one handler set under a name that is never an extension's.
  const offerTo = (name, handlers, type, ev) => offer([name], () => handlers, type, () => withHolder(ev, null));

  // Offer an event: the hands, top first, then the chain, then the top body
  // (its default). The chain is only worked out if every hand passes, so an
  // event a hand takes never picks (the Edit hand's click reads the widget
  // and the hit itself).
  function dispatch(type, ev) {
    const pre = [];
    for (const h of [...hands].reverse()) {
      pre.push({ step: "hand", owner: h.owner, kind: h.kind, name: h.name });
      const r = offerTo(h.owner ?? "scene", h.input, type, ev);
      if (r) return routed(type, pre, null, null, { at: "pre", i: pre.length - 1 }, r);
    }
    const chain = chainFor(ev) ?? {};
    const { order = [], holderOf } = chain;
    let r = offer(order, inputOf, type, (id) => withHolder(ev, holderOf?.(id) ?? null));
    if (r) return routed(type, pre, chain, null, { at: "chain", i: order.indexOf(r.id) }, r);
    const b = top();
    r = offerTo(b.owner ?? "scene", b.input, type, ev);
    return routed(type, pre, chain, b, r && { at: "body" }, r);
  }
  function offerChain(type, ev) {
    const chain = chainFor(ev) ?? {};
    const { order = [], holderOf } = chain;
    const r = offer(order, inputOf, type, (id) => withHolder(ev, holderOf?.(id) ?? null));
    return routed(type, [], chain, null, r && { at: "chain", i: order.indexOf(r.id) }, r);
  }

  // ─── the input route ──────────────────────────────────────────────────────
  // Each dispatched event's route, as raw as it was offered (the hands it
  // passed, the chain the view gave, the body), kept for the last ROUTES
  // events and spelt out only when someone reads routes().
  const routeLog = [];
  function routed(type, pre, chain, body, took, r) {
    routeLog.push({ type, at: time.now(), pre, chain, body: body ? { owner: body.owner, id: body.id } : null, took: took || null });
    if (routeLog.length > ROUTES) routeLog.shift();
    return r;
  }
  /** One route spelt out: { type, at, path, steps: [{ step, owner, … }], took: the index of the step that took it, or -1 }. */
  function spell({ type, at, pre, chain, body, took }) {
    const order = chain?.order ?? [];
    const upTo = took?.at === "chain" ? took.i + 1 : took?.at === "pre" ? 0 : order.length;
    const steps = [
      ...pre,
      ...order.slice(0, upTo).map((owner) => ({ step: chain.stepOf?.(owner) ?? "holder", owner, holder: chain.holderOf?.(owner) ?? null })),
      ...(body ? [{ step: body.owner == null ? "default" : "body", owner: body.owner, body: body.id }] : []),
    ];
    const i = !took ? -1 : took.at === "pre" ? took.i : took.at === "chain" ? pre.length + took.i : steps.length - 1;
    return { type, at, path: chain?.path ?? null, steps, took: i };
  }

  // ─── the cursor ───────────────────────────────────────────────────────────

  let cursorNow; // undefined until first resolved, so the first answer always goes out
  function setCursor(name) {
    const v = name || null;
    if (v === cursorNow) return;
    cursorNow = v;
    o.onCursor?.(v);
  }
  // The open session's cursor, else the first hand's with one (top first),
  // else the first extension down the chain with an opinion, else the body's.
  function resolveCursor(ev) {
    const s = gesture && !gesture.dead ? gesture.session : null;
    if (s?.cursor) return setCursor(s.cursor);
    if (!ev) return setCursor(null);
    for (const h of [...hands].reverse()) {
      const c = call(h.owner, h.input, "cursor", withHolder(ev, null));
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
  let hoverFrame = null; // its cancel
  function queueHover(e) {
    if (hoverQueued) {
      hoverQueued = e;
      return;
    }
    hoverQueued = e;
    hoverFrame = time.frame(() => {
      const de = hoverQueued;
      hoverQueued = null;
      hoverFrame = null;
      if (disposed || (gesture?.session && !gesture.dead)) return;
      const ev = make("move", de);
      o.onHover?.(ev);
      resolveCursor(ev);
    });
  }
  function cancelHover() {
    hoverFrame?.();
    hoverFrame = null;
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
    g.holdTimer?.();
    g.holdTimer = null;
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
    g.holdTimer?.();
    g.holdTimer = null;
    if (g.session) call(g.owner, g.session, "cancel");
    if (had) changed();
  }

  // A release (or touch hold) that didn't travel: click, or menu.
  function offerRelease(kind, ev, e) {
    if (!kind) return;
    if (dispatch(kind, retype(ev, kind))) e?.preventDefault?.();
  }

  // Every press on the view says what the input is, wherever it lands (the
  // canvas, the chip, a prompt's button, an edge's bar), before anything
  // hears it: a finger lets the lock go and never takes it; a mouse after a
  // finger leaves it to the next press on the world (stage/pointer.js).
  function onInput(e) {
    pointerEvent({ type: "input", touch: e.pointerType === "touch" });
  }

  function onPointerDown(e) {
    if (e.target !== canvas) return;
    // a second pointer while a gesture is claimed is swallowed; while one is
    // unclaimed it belongs to orbit (a pinch), and the first is no longer a click
    if (gesture && !gesture.dead && gesture.pointerId !== e.pointerId) {
      if (gesture.session) return claim(e);
      gesture.moved = true;
      gesture.holdTimer?.();
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
    tapped = false;
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
      holdTimer: null,
      serial: ++made,
    };
    gesture = g;
    cancelHover();
    const ev = make("press", e);
    // what is pressed is where the pointer is: the hover a frame would have
    // brought (a touch has none before it), so a menu from this press, and
    // the look and the use prompt where the look is the pointer's (not the
    // eye's: under lock the press is the eye's anyway), name the thing under it
    o.onHover?.(ev);
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
      g.holdTimer = time.after(HOLD_MS, () => {
        g.holdTimer = null;
        if (gesture !== g || g.dead || g.moved) return;
        killGesture();
        offerRelease("menu", ev);
      });
    }
  }

  function onPointerMove(e) {
    const g = gesture && gesture.pointerId === e.pointerId ? gesture : null;
    // A mouse that moves with no button down was released where we didn't
    // hear it (outside the window, behind a dialog): the gesture is cancelled
    // (put back, never committed where nobody saw it land), rather than
    // carrying on with the hover. (Chrome says so first, as a lost capture.)
    if (g && !g.dead && g.pointerType === "mouse" && e.buttons === 0) return onPointerCancel(e);
    if (e.target !== canvas && !g) {
      // off the canvas: a look kept for something over it (the use prompt) lasts only while the pointer is on that thing
      // (a mouse's: a finger moving elsewhere, on the touch pad, is another finger, not the mouse going)
      if (kept && e.pointerType !== "touch" && !keepsLook(e.target)) onPointerLeave();
      return;
    }
    const locked = isLocked();
    if (!locked) lastAt = { clientX: e.clientX, clientY: e.clientY };
    let ev = null;
    const evNow = () => (ev ??= make("move", e));
    // the top body and every hand hear every move (mouse-look under lock)
    const b = top();
    if (typeof b.input.move === "function") call(b.owner ?? "scene", b.input, "move", withHolder(evNow(), null));
    for (const h of [...hands]) if (typeof h.input.move === "function") call(h.owner, h.input, "move", withHolder(evNow(), null));
    if (g && !g.dead) {
      if (locked) {
        g.lx += e.movementX ?? 0;
        g.ly += e.movementY ?? 0;
      }
      if (!g.moved && travelled(g, e) > SLOP) {
        g.moved = true;
        g.holdTimer?.();
        g.holdTimer = null;
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
    if (g.pointerType === "touch") tapped = !g.moved && travelled(g, e) <= SLOP;
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

  // The look is what's under the pointer on the canvas. Off the canvas onto
  // something over it that keeps the look ([data-keeps-look]: the use
  // prompt, whose buttons are the verbs of what's looked at), it is kept
  // while the pointer stays on that thing, so a button there can be reached
  // and clicked; anywhere else (other overlays, out of the port) it goes.
  //
  // A finger hovers nowhere: it leaves as it lifts. Its look is what it
  // pressed (the press sets the hover), and a tap's is kept when it lifts,
  // until the next press, so the prompt's buttons for what was tapped can
  // be reached with another tap. A finger that dragged (orbit, a carry, a
  // look) keeps none.
  let kept = false;
  let tapped = false; // the last finger on the world tapped (and lifted)
  function onCanvasLeave(e) {
    if (e?.pointerType === "touch") {
      if (!tapped) onPointerLeave();
      return;
    }
    if (keepsLook(e?.relatedTarget)) {
      kept = true;
      return;
    }
    onPointerLeave();
  }
  function onPortLeave(e) {
    if (kept && e?.pointerType !== "touch") onPointerLeave();
  }
  function onPointerLeave() {
    kept = false;
    cancelHover();
    o.onHover?.(null);
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

  // ─── Escape (stage/ladder.js) ─────────────────────────────────────────────

  /** Escape's state now. The field is the DOM's: a typing target blurs before this is asked. */
  function ladderState() {
    const h = hands.at(-1);
    return {
      lock: isLocked(),
      field: false,
      gesture: !!openSession(),
      hand: h ? { kind: h.kind, escaping: call(h.owner, h, "escaping") ?? null } : null,
      rest: o.restLayer?.() ?? null,
    };
  }

  /** Escape: pop the top layer, exactly one. @returns the layer popped, or null */
  function escape() {
    const st = ladderState();
    const layer = escapeLayer(st);
    if (!layer || layer === "lock" || layer === "field") return null; // the lock is the browser's own: the page never sees that Escape
    if (layer === "gesture") killGesture();
    else if (st.hand) {
      const h = hands.at(-1);
      if (!call(h.owner, h, "escape")) drop(h);
    } else o.escapeRest?.();
    changed();
    return layer;
  }

  // ─── keys ─────────────────────────────────────────────────────────────────

  // code → { owner, layer?, key, code, up(ev) }: who claimed each key that's down (`layer`: the body or hand it is)
  const down = new Map();

  // The modifier keys down, as a keyboard has them: a keydown at the view's
  // root puts one down (claimed or not, before anyone hears it, so its own
  // keydown says it), a keyup anywhere in the window, a blur or a hidden
  // page lets it go. Every event's flags are the DOM's or these. A
  // keyboard's own are in its events already (these only agree); a key
  // pressed for one (the touch pad's Alt, "Place freely") is in no event's
  // flags, so without these every move would say it's up.
  const MOD = { Shift: "shift", Alt: "alt", Control: "ctrl", Meta: "meta" };
  const modsDown = new Set(); // codes
  function heldMods() {
    const m = {};
    for (const code of modsDown) m[MOD[keyOfCode(code)]] = true;
    return m;
  }
  const onAnyKeyUp = (e) => modsDown.delete(e.code);

  const keyEvent = (type, e) => make(type, e, { noHit: true });

  function onKeyDown(e) {
    if (fromEmbed(e, keyRoot)) return;
    if (MOD[keyOfCode(e.code)]) modsDown.add(e.code);
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
    // what reserves keys first: the gesture's, the topmost hand's that declares it, the body's (./key-order.js keyHolder);
    // a key with ctrl or meta held (⌘Z, not Z; a modifier itself still can be) is no reserver's: it goes to the chain
    const g = gesture && !gesture.dead && gesture.session ? gesture : null;
    const b = top();
    const chorded = (ev.ctrl || ev.meta) && !MOD[keyOfCode(e.code)];
    const holder = chorded ? null : keyHolder(code, { gesture: g?.session ?? null, hands, body: b });
    const by = holder?.from ?? null;
    if (by === "gesture") {
      const s = g.session;
      if (call(g.owner, s, "key", withHolder(ev, null))) claimer = { owner: g.owner, up: (kev) => call(g.owner, s, "keyup", kev) };
    } else if (by === "hand") {
      const h = holder.layer;
      if (call(h.owner, h.input, "key", withHolder(ev, null))) claimer = { owner: h.owner, layer: h, up: (kev) => call(h.owner, h.input, "keyup", kev) };
    } else if (by === "body") {
      if (call(b.owner ?? "scene", b.input, "key", withHolder(ev, null))) claimer = { owner: b.owner, layer: b, up: (kev) => call(b.owner ?? "scene", b.input, "keyup", kev) };
    }
    // (a reserved key's route is its reserver alone)
    if (by) routed("key", [{ step: by, owner: by === "gesture" ? g.owner : by === "hand" ? holder.layer.owner : b.owner, ...(by === "hand" ? { kind: holder.layer.kind, name: holder.layer.name } : {}) }], null, null, claimer && { at: "pre", i: 0 }, null);
    else {
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
  // or only those `where` picks (one extension's, one body's or hand's).
  function releaseKeys(where = () => true) {
    for (const [code, c] of [...down]) {
      if (!where(c)) continue;
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
    modsDown.clear();
  };
  const onVisibility = () => {
    if (doc.visibilityState !== "hidden") return;
    dropGesture();
    releaseKeys();
    modsDown.clear();
  };

  // ─── the pointer (stage/pointer.js) ───────────────────────────────────────

  let ptr = { lock: !!top().lock, wanted: false, released: false, refused: false, touch: !!o.touch };
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

  /** Something of the stage's may want the pointer now (a selection, a wantPointer()): look again. */
  function refresh() {
    const wanted = wantsPointer(hands) || !!o.pointerWanted?.();
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
      body: { id: b.id, owner: b.owner, depth: bodies.stack.length - 1, lock: !!b.lock, keys: [...(b.keys ?? [])], serial: b.serial },
      hands: hands.map((h) => ({ ext: h.owner, kind: h.kind, name: h.name, keys: [...h.keys], pointer: h.pointer, serial: h.serial })),
      held: tools(hands).map((t) => ({ ext: t.owner, command: t.command, name: t.name, handKind: t.handKind, keys: [...t.keys], pointer: t.pointer, serial: t.serial })),
      gesture: s ? { owner: gesture.owner, keys: [...(Array.isArray(s.keys) ? s.keys : [])], serial: gesture.serial } : null,
      pointer: { locked: isLocked(), lock: ptr.lock, wanted: ptr.wanted, released: ptr.released, refused: ptr.refused, touch: ptr.touch },
      escape: escapeLayer(ladderState()),
    };
  }

  // ─── the stacks (body-stack.js, hands.js) ────────────────────────────────

  // The body the pointer's `lock` is of (pointer.js): a new top starts the pointer afresh.
  let lockOf = top();

  /**
   * A change to either stack, in the one order: the stack it gives is kept
   * first, so whatever a told layer does (enters, leaves, picks up, puts
   * down) sees it; then the keys of what left or went under are let go, and
   * each is told (`left`, `suspended`, `resumed`, `put()`); the body stack's
   * top takes its turn (settleTop); then the pointer (a new top body's lock,
   * whether a hand wants it), the state and the cursor are worked out again.
   */
  function restack(c) {
    if (c.bodies) bodies = c.bodies;
    if (c.hands) hands = c.hands;
    for (const x of c.off) releaseKeys((k) => k.layer === x);
    for (const t of c.tell) call(t.owner ?? "scene", t.to, t.what);
    if (c.bodies) {
      const turn = settleTop(bodies);
      if (turn) return restack(turn);
    }
    if (top() !== lockOf) {
      lockOf = top();
      pointerEvent({ type: "body", lock: lockOf.lock });
    }
    refresh();
    if (!gesture?.session) resolveCursor(lastAt && !isLocked() ? make("move", null) : null);
  }

  /**
   * Push a body on the stack (its owner's: an extension id).
   * @param {string} owner  @param {RouterBody} body
   * @returns {() => void} pop it (wherever it is in the stack; anything over it goes with it)
   */
  function pushBody(owner, body) {
    if (disposed) return () => {};
    const entry = { owner, id: body.id, input: body.input ?? {}, lock: !!body.lock, keys: body.keys ?? [], serial: ++made };
    restack(withBody(bodies, entry));
    return () => popBody(entry);
  }
  /** A body leaving takes every body over it too: they stood on it. @returns whether it was on the stack (never the base) */
  function popBody(entry) {
    const c = withoutBody(bodies, entry);
    if (!c) return false;
    restack(c);
    return true;
  }

  /**
   * Put a hand on top of the stack (its owner's: an extension's key, or null
   * for the view's own). It never puts another down.
   * @param {string | null} owner  @param {RouterHand} spec
   * @returns {() => void} put it down (if it's still held, wherever it is in the stack; its put() is told)
   */
  const pushHand = (owner, spec) => place(owner, spec, null);
  /** pushHand, for a tool held for a kind of hand (hold) too. */
  function place(owner, spec, handKind) {
    if (disposed) return () => {};
    const h = handOf(owner, spec, ++made, handKind);
    restack(withHand(hands, h));
    return () => drop(h);
  }
  /** A hand leaves the stack, with the tools held for its kind if it was the last of it (hands.js). @returns whether it was held */
  function drop(h) {
    const c = withoutHand(hands, h);
    if (!c) return false;
    restack(c);
    return true;
  }

  /**
   * Pick up a tool (a hand of kind "tool"): it goes on top, over whatever is
   * held. A tool held for a kind of hand (`handKind`: the command's `hand`)
   * is held only while a hand of that kind is (drop); one for a kind not
   * held, or for one of the kernel's own (KERNEL_KINDS), is refused. (Running
   * a held tool's command again puts it down: the stage's, stage.js runCommand.)
   * @param {string} owner  @param {{ command: string | null (a tool held directly, not through a command), name?: string, handKind?: string | null, input: object, keys?: object[], pointer?: boolean }} t
   * @returns {(() => void) | null} put it down (if it's still held); null for a refusal
   */
  function hold(owner, t) {
    const handKind = typeof t.handKind === "string" ? t.handKind : null;
    if (refuses(hands, handKind)) return null;
    return place(owner, toolSpec(t), handKind);
  }
  /**
   * Put a held tool down, from wherever it is in the stack: the one whose
   * `serial` that is, else the one picked up through `command` of `owner`;
   * with no argument the topmost.
   * @param {{ serial?: number, owner?: string, command?: string } | undefined} which
   * @returns {boolean} whether one was put down
   */
  const putDown = (which) => drop(whichTool(hands, which));

  /** An open menu or dialog: a hand that wants the pointer and consumes everything, which Escape closes. @returns release (when it closes itself) */
  const popover = (owner, close) => pushHand(owner, popoverSpec(close));

  // ─── stopping ─────────────────────────────────────────────────────────────

  /** An extension stopped: its open session, keys, bodies and hands go (a popover unclosed: the extension is gone). */
  function stopOwner(id) {
    if (gesture?.owner === id) killGesture();
    releaseKeys((c) => c.owner === id);
    const mine = ownedBody(bodies, id);
    if (mine) popBody(mine);
    for (const h of hands.filter((h) => h.owner === id)) drop(h);
    refresh();
  }

  // ─── wiring ───────────────────────────────────────────────────────────────

  const listeners = [
    [keyRoot ?? port, "pointerdown", onInput, { capture: true }],
    [port, "pointerdown", onPointerDown, { capture: true }],
    [port, "pointermove", onPointerMove, { capture: true }],
    [port, "pointerup", onPointerUp, { capture: true }],
    [port, "pointercancel", onPointerCancel, { capture: true }],
    [port, "contextmenu", onContextMenu, { capture: true }],
    [port, "wheel", onWheel, { capture: true, passive: false }],
    [canvas, "pointerleave", onCanvasLeave, undefined],
    [port, "pointerleave", onPortLeave, undefined],
    [canvas, "lostpointercapture", onLostCapture, undefined],
    [keyRoot, "keydown", onKeyDown, undefined],
    [keyRoot, "keyup", onKeyUp, undefined],
    [win, "keyup", onAnyKeyUp, { capture: true }],
    [win, "blur", onBlur, undefined],
    [doc, "visibilitychange", onVisibility, undefined],
    [doc, "pointerlockchange", onLockChange, undefined],
    [doc, "pointerlockerror", onLockError, undefined],
  ];
  for (const [t, type, fn, opts] of listeners) t?.addEventListener(type, fn, opts);
  changed();

  return {
    pushBody,
    /** the top body: { id, owner } */
    body: () => ({ id: top().id, owner: top().owner }),
    /** the stack, bottom first: [{ id, owner }] */
    bodies: () => bodies.stack.map((x) => ({ id: x.id, owner: x.owner })),
    /** pop the top body (never the base). @returns whether one went */
    leave: () => popBody(top()),
    /** pop every body over the base. @returns whether one went */
    leaveAll: () => (bodies.stack.length > 1 ? popBody(bodies.stack[1]) : false),
    pushHand,
    hold,
    putDown,
    /** the held tools, bottom first: [{ owner, command, name, serial }] */
    held: () => tools(hands).map((t) => ({ owner: t.owner, command: t.command, name: t.name, serial: t.serial })),
    /** the hands, bottom first: [{ owner, kind, name }] */
    hands: () => hands.map((h) => ({ owner: h.owner, kind: h.kind, name: h.name })),
    /** the last ROUTES dispatched events' routes, oldest first (spell) */
    routes: () => routeLog.map(spell),
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
      bodies = baseOnly(bodies.stack[0]);
      hands = [];
      if (requested || isLocked()) exitLockNow();
    },
  };
}
