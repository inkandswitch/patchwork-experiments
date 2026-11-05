// The input router: DOM input on the canvas → event values, offered down the
// chain until something claims them (STAGE.md, "The input chain" and
// "Arming"). It owns the open session (one gesture at a time), the arm stack,
// pointer lock, which keys are down and who claimed them, `menu` synthesis and
// the cursor. It knows nothing about three.js or the doc: picking, rays, the
// chain order and each extension's input all come in as functions.
//
// Pointer and wheel listeners sit on the port in the capture phase, so they
// run before OrbitControls (which listens on the canvas itself): a claimed
// press or wheel is stopped there and orbit never sees it. Anything whose
// target isn't the canvas (labels, overlays, edges) is left to the DOM.

import { offer } from "./chain.js";

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
 *   cameraHeld: () => boolean,
 *   onHover: (ev: object | null) => void,
 *   onCursor: (name: string | null) => void,
 *   onArmed?: (owner: string | null) => void,   // the top of the arm stack changed
 *   requestLock?: () => Promise<void> | void,
 *   exitLock?: () => void,
 *   mac?: boolean,
 * }} o
 * @returns {{
 *   arm(owner: string, handlers: object, opts?: { lock?: boolean, replace?: boolean }): () => void,
 *   relock(owner: string): Promise<void>,
 *   armedOwner(): string | null,
 *   stopOwner(id: string): void,
 *   dispose(): void,
 * }}
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

  const stack = []; // the arm stack: [{ owner, handlers, lock, suspended }], top last
  const top = () => stack.at(-1) ?? null;

  // Offer an event: the armed extension's handlers first, then the chain
  // (without the armed owner again: each is offered once, at its earliest
  // step). The chain is only worked out if the armed handlers pass, so an
  // event the armed tool takes never picks.
  function dispatch(type, ev) {
    const t = top();
    if (t) {
      const r = offer([t.owner], () => t.handlers, type, () => withHolder(ev, null));
      if (r) return r;
    }
    return offerChain(type, ev, t?.owner);
  }
  function offerChain(type, ev, skip) {
    const { order = [], holderOf } = chainFor(ev) ?? {};
    const ids = order.filter((id) => id !== skip);
    return offer(ids, inputOf, type, (id) => withHolder(ev, holderOf?.(id) ?? null));
  }

  // ─── the cursor ───────────────────────────────────────────────────────────

  let cursorNow; // undefined until first resolved, so the first answer always goes out
  function setCursor(name) {
    const v = name || null;
    if (v === cursorNow) return;
    cursorNow = v;
    o.onCursor?.(v);
  }
  // The open session's cursor, else the armed handlers', else the first
  // extension down the chain with an opinion.
  function resolveCursor(ev) {
    const s = gesture && !gesture.dead ? gesture.session : null;
    if (s?.cursor) return setCursor(s.cursor);
    if (!ev) return setCursor(null);
    const t = top();
    if (t) {
      const c = call(t.owner, t.handlers, "cursor", withHolder(ev, null));
      if (c) return setCursor(c);
    }
    const { order = [], holderOf } = chainFor(ev) ?? {};
    for (const id of order) {
      if (id === t?.owner) continue;
      const c = call(id, inputOf(id), "cursor", withHolder(ev, holderOf?.(id) ?? null));
      if (c) return setCursor(c);
    }
    setCursor(null);
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
  // One press at a time. `session` is set when an extension claimed it; an
  // unclaimed press is still watched, so a release under the slop can offer a
  // click (or menu). `dead` means it was cancelled (Escape, a touch hold, the
  // owner stopping): its release does nothing.

  let gesture = null; // { pointerId, button, ctrl, pointerType, x0, y0, lx, ly, moved, session, owner, dead, holdTimer }

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
    g.dead = true;
    clearTimeout(g.holdTimer);
    g.holdTimer = 0;
    if (g.session) call(g.owner, g.session, "cancel");
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
    // focus, so bring keys to this view by hand (tool.js did this too)
    if (keyRoot && doc.activeElement !== keyRoot) keyRoot.focus?.({ preventScroll: true });
    lastAt = { clientX: e.clientX, clientY: e.clientY };
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
    if (e.target !== canvas && !g) return;
    const locked = isLocked();
    if (!locked) lastAt = { clientX: e.clientX, clientY: e.clientY };
    let ev = null;
    const evNow = () => (ev ??= make("move", e));
    // the armed extension hears every move (mouse-look under lock)
    const t = top();
    if (t && typeof t.handlers.move === "function") call(t.owner, t.handlers, "move", withHolder(evNow(), null));
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

  function onPointerLeave() {
    cancelHover();
    o.onHover?.(null);
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

  // ─── keys ─────────────────────────────────────────────────────────────────

  // code → { owner, key, code, up(ev) }: who claimed each key that's down
  const down = new Map();

  const keyEvent = (type, e) => make(type, e, { noHit: true });

  function onKeyDown(e) {
    const target = e.composedPath?.()[0] ?? e.target;
    if (isTyping(target)) {
      if (e.key === "Escape") target.blur?.();
      return;
    }
    const ev = keyEvent("key", e);
    let claimer = null;
    const t = top();
    if (t && offer([t.owner], () => t.handlers, "key", () => withHolder(ev, null))) {
      const h = t.handlers;
      claimer = { owner: t.owner, up: (kev) => call(t.owner, h, "keyup", kev) };
    }
    const g = gesture && !gesture.dead && gesture.session ? gesture : null;
    if (!claimer && g && call(g.owner, g.session, "key", withHolder(ev, null))) {
      const s = g.session;
      claimer = { owner: g.owner, up: (kev) => call(g.owner, s, "keyup", kev) };
    }
    if (!claimer && g && e.key === "Escape") {
      // Escape ends a gesture that didn't want it
      killGesture();
      e.preventDefault();
      return;
    }
    if (!claimer) {
      const r = offerChain("key", ev, t?.owner);
      if (r) claimer = { owner: r.id, up: (kev) => call(r.id, inputOf(r.id), "keyup", kev) };
    }
    if (!claimer) return;
    e.preventDefault();
    const code = e.code || e.key;
    const was = down.get(code);
    if (was && was.owner !== claimer.owner) was.up(retype(ev, "keyup"));
    if (!was || was.owner !== claimer.owner) down.set(code, { ...claimer, key: e.key, code: e.code });
  }

  function onKeyUp(e) {
    const code = e.code || e.key;
    const c = down.get(code);
    if (!c) return;
    down.delete(code);
    c.up(keyEvent("keyup", e));
    e.preventDefault();
  }

  // A keyup for every claimed key still down (blur, hidden page, lost lock),
  // or only those one extension holds.
  function releaseKeys(owner = null) {
    for (const [code, c] of [...down]) {
      if (owner != null && c.owner !== owner) continue;
      down.delete(code);
      c.up(keyEvent("keyup", { key: c.key, code: c.code }));
    }
  }

  const onBlur = () => releaseKeys();
  const onVisibility = () => {
    if (doc.visibilityState === "hidden") releaseKeys();
  };

  // ─── the arm stack ────────────────────────────────────────────────────────

  let lockRequested = false;
  let wasLocked = isLocked();

  function requestLockNow() {
    lockRequested = true;
    try {
      const p = o.requestLock ? o.requestLock() : canvas.requestPointerLock?.();
      return p && typeof p.then === "function" ? p : Promise.resolve();
    } catch (err) {
      return Promise.reject(err);
    }
  }
  function exitLockNow() {
    lockRequested = false;
    try {
      if (o.exitLock) o.exitLock();
      else if (isLocked()) doc.exitPointerLock?.();
    } catch {
      // nothing to exit
    }
  }

  // After the stack changes: the old top (if still there) is suspended, the
  // new one resumed (if it had been suspended), the lock let go of if no arm
  // wants it, and the cursor worked out again.
  function settle(prevTop) {
    const t = top();
    if (t !== prevTop) {
      if (prevTop && stack.includes(prevTop) && !prevTop.suspended) {
        prevTop.suspended = true;
        call(prevTop.owner, prevTop.handlers, "suspended");
      }
      if (t?.suspended) {
        t.suspended = false;
        call(t.owner, t.handlers, "resumed");
      }
      if ((t?.owner ?? null) !== (prevTop?.owner ?? null)) o.onArmed?.(t?.owner ?? null);
    }
    if (lockRequested && !stack.some((a) => a.lock)) exitLockNow();
    if (!gesture?.session) resolveCursor(lastAt && !isLocked() ? make("move", null) : null);
  }

  function remove(entry) {
    const i = stack.indexOf(entry);
    if (i < 0) return false;
    stack.splice(i, 1);
    call(entry.owner, entry.handlers, "disarmed");
    return true;
  }

  function arm(owner, handlers = {}, { lock = false, replace = false } = {}) {
    if (disposed) return () => {};
    const prevTop = top();
    if (replace) for (const a of stack.filter((a) => a.owner === owner)) remove(a);
    const entry = { owner, handlers: handlers ?? {}, lock: !!lock, suspended: false };
    stack.push(entry);
    if (entry.lock) requestLockNow().catch((err) => console.warn(`[scene] ${owner}: pointer lock refused`, err));
    settle(prevTop);
    return () => {
      const before = top();
      if (remove(entry)) settle(before);
    };
  }

  function relock(owner) {
    if (disposed || !stack.some((a) => a.owner === owner && a.lock)) return Promise.resolve();
    return requestLockNow();
  }

  function onLockChange() {
    const now = isLocked();
    const lost = wasLocked && !now;
    wasLocked = now;
    if (!lost) return;
    for (const a of [...stack]) if (a.lock) call(a.owner, a.handlers, "lockLost");
    releaseKeys();
  }
  function onLockError() {
    if (!lockRequested) return;
    for (const a of [...stack]) if (a.lock) call(a.owner, a.handlers, "lockLost");
  }

  // ─── stopping ─────────────────────────────────────────────────────────────

  function stopOwner(id) {
    if (gesture?.owner === id) killGesture();
    releaseKeys(id);
    const prevTop = top();
    let any = false;
    for (const a of stack.filter((a) => a.owner === id)) any = remove(a) || any;
    if (any) settle(prevTop);
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
    [keyRoot, "keydown", onKeyDown, undefined],
    [keyRoot, "keyup", onKeyUp, undefined],
    [win, "blur", onBlur, undefined],
    [doc, "visibilitychange", onVisibility, undefined],
    [doc, "pointerlockchange", onLockChange, undefined],
    [doc, "pointerlockerror", onLockError, undefined],
  ];
  for (const [t, type, fn, opts] of listeners) t?.addEventListener(type, fn, opts);

  return {
    arm,
    relock,
    armedOwner: () => top()?.owner ?? null,
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
      stack.length = 0;
      if (lockRequested || isLocked()) exitLockNow();
    },
  };
}
