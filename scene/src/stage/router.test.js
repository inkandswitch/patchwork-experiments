import { describe, it, expect, vi, afterEach } from "vitest";
import { buildEvent, createRouter, isMac, isTyping, releaseKind, retype, withHolder } from "./router.js";

// A port with a canvas in it, a key root around both, and a router whose
// chain is whatever the test puts in `inputs` (in insertion order).
function setup({ held = false, holders = {}, mac = false } = {}) {
  const root = document.createElement("div");
  root.tabIndex = 0;
  const port = document.createElement("div");
  const canvas = document.createElement("canvas");
  port.append(canvas);
  root.append(port);
  document.body.append(root);
  const inputs = {};
  const t = {
    root,
    port,
    canvas,
    inputs,
    held,
    pick: vi.fn((x, y) => ({ id: "obj", point: [x, y, 0], normal: [0, 1, 0], distance: 1 })),
    pickWidget: vi.fn(() => null),
    ray: vi.fn((x, y) => ({ origin: [x, y, 10], dir: [0, 0, -1] })),
    centerRay: vi.fn(() => ({ origin: [0, 0, 0], dir: [0, 0, -1] })),
    chainFor: vi.fn(() => ({ order: Object.keys(inputs), holderOf: (id) => holders[id] ?? null })),
    onHover: vi.fn(),
    onCursor: vi.fn(),
    onArmed: vi.fn(),
    requestLock: vi.fn(() => Promise.resolve()),
    exitLock: vi.fn(),
    orbit: vi.fn(), // a bubble listener on the canvas, where OrbitControls listens
  };
  canvas.addEventListener("pointerdown", t.orbit);
  canvas.addEventListener("wheel", t.orbit);
  t.router = createRouter({
    port,
    canvas,
    keyRoot: root,
    pick: t.pick,
    pickWidget: t.pickWidget,
    ray: t.ray,
    centerRay: t.centerRay,
    chainFor: t.chainFor,
    inputOf: (id) => inputs[id],
    cameraHeld: () => t.held,
    onHover: t.onHover,
    onCursor: t.onCursor,
    onArmed: t.onArmed,
    requestLock: t.requestLock,
    exitLock: t.exitLock,
    mac,
  });
  cleanups.push(() => {
    t.router.dispose();
    root.remove();
  });
  return t;
}
const cleanups = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()();
  vi.useRealTimers();
});

const ptr = (type, target, { x = 10, y = 10, button = 0, buttons, id = 1, pointerType = "mouse", ...rest } = {}) => {
  const e = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
    button,
    buttons: buttons ?? (type === "pointerup" ? 0 : button === 2 ? 2 : 1),
    pointerId: id,
    pointerType,
    ...rest,
  });
  target.dispatchEvent(e);
  return e;
};
const down = (t, o) => ptr("pointerdown", t.canvas, o);
const move = (t, o) => ptr("pointermove", t.canvas, o);
const up = (t, o) => ptr("pointerup", t.canvas, o);
const key = (target, type, k, code = `Key${k.toUpperCase()}`, rest = {}) => {
  const e = new KeyboardEvent(type, { key: k, code, bubbles: true, cancelable: true, ...rest });
  target.dispatchEvent(e);
  return e;
};
const frame = () => new Promise((r) => requestAnimationFrame(() => r()));

describe("pure helpers", () => {
  it("knows what a still release means", () => {
    expect(releaseKind({ button: 0 }, false)).toBe("click");
    expect(releaseKind({ button: 2 }, false)).toBe("menu");
    expect(releaseKind({ button: 0, ctrl: true }, true)).toBe("menu");
    expect(releaseKind({ button: 0, ctrl: true }, false)).toBe("click");
    expect(releaseKind({ button: 1 }, false)).toBe(null);
  });
  it("spots a Mac", () => {
    expect(isMac({ platform: "MacIntel" })).toBe(true);
    expect(isMac({ platform: "", userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" })).toBe(true);
    expect(isMac({ platform: "Win32", userAgent: "Windows" })).toBe(false);
  });
  it("spots a field being typed in", () => {
    expect(isTyping(document.createElement("input"))).toBe(true);
    expect(isTyping(document.createElement("textarea"))).toBe(true);
    const div = document.createElement("div");
    expect(isTyping(div)).toBe(false);
    div.setAttribute("contenteditable", "true");
    expect(isTyping(div)).toBe(true);
  });
  it("builds events with port-local x, y, ndc from the canvas and lazy, memoised picks", () => {
    const pick = vi.fn(() => ({ id: "a" }));
    const ray = vi.fn(() => "r");
    const ev = buildEvent("press", { clientX: 60, clientY: 30, button: 0, buttons: 1, pointerId: 3, pointerType: "pen", shiftKey: true }, {
      portRect: { left: 10, top: 10 },
      canvasRect: { left: 10, top: 10, width: 100, height: 40 },
      pick,
      ray,
    });
    expect([ev.x, ev.y]).toEqual([50, 20]);
    expect(ev.ndc).toEqual([0, -0]);
    expect(ev.shift).toBe(true);
    expect(ev.pointerType).toBe("pen");
    expect(pick).not.toHaveBeenCalled();
    const a = withHolder(ev, "h1");
    const b = retype(ev, "click");
    expect(a.hit).toEqual({ id: "a" });
    expect(b.hit).toBe(a.hit);
    expect(pick).toHaveBeenCalledTimes(1);
    expect(pick).toHaveBeenCalledWith(50, 20, { snapPx: 0 });
    expect([a.holder, b.type, ev.type]).toEqual(["h1", "click", "press"]);
    expect(ev.ray).toBe("r");
  });
  it("puts a locked pointer at the canvas centre, along the forward ray", () => {
    const pick = vi.fn(() => null);
    const ev = buildEvent("move", { clientX: 3, clientY: 3, movementX: 5, movementY: -2 }, {
      portRect: { left: 0, top: 0 },
      canvasRect: { left: 0, top: 0, width: 200, height: 100 },
      locked: true,
      pick,
      ray: () => "wrong",
      centerRay: () => "forward",
    });
    expect([ev.x, ev.y, ev.ndc, ev.dx, ev.dy, ev.locked]).toEqual([100, 50, [0, 0], 5, -2, true]);
    expect(ev.ray).toBe("forward");
    ev.hit;
    expect(pick).toHaveBeenCalledWith(100, 50, { snapPx: 0 });
  });
});

describe("presses: claim vs orbit", () => {
  it("a claimed press never reaches orbit, and captures the pointer", () => {
    const t = setup();
    const session = { move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
    t.inputs.hand = { press: vi.fn(() => session) };
    const e = down(t);
    expect(t.inputs.hand.press).toHaveBeenCalledTimes(1);
    expect(t.orbit).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });
  it("an unclaimed press goes on to orbit", () => {
    const t = setup();
    t.inputs.hand = { press: vi.fn(() => null) };
    const e = down(t);
    expect(t.orbit).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(false);
  });
  it("ignores presses on anything but the canvas", () => {
    const t = setup();
    t.inputs.hand = { press: vi.fn(() => ({})) };
    const label = document.createElement("div");
    t.port.append(label);
    ptr("pointerdown", label);
    expect(t.inputs.hand.press).not.toHaveBeenCalled();
  });
  it("the first claim wins, in chain order", () => {
    const t = setup();
    t.inputs.a = { press: vi.fn(() => null) };
    t.inputs.b = { press: vi.fn(() => ({})) };
    t.inputs.c = { press: vi.fn(() => ({})) };
    down(t);
    expect(t.inputs.a.press).toHaveBeenCalled();
    expect(t.inputs.b.press).toHaveBeenCalled();
    expect(t.inputs.c.press).not.toHaveBeenCalled();
  });
});

describe("sessions", () => {
  it("moves start past 4 px, then come every move, and end on release", () => {
    const t = setup();
    const session = { move: vi.fn(), end: vi.fn(), tap: vi.fn(), cancel: vi.fn() };
    t.inputs.hand = { press: () => session, click: vi.fn() };
    down(t, { x: 10, y: 10 });
    move(t, { x: 12, y: 12 }); // 2.8 px: still slop
    expect(session.move).not.toHaveBeenCalled();
    move(t, { x: 15, y: 10 });
    move(t, { x: 11, y: 10 }); // back inside, still moving
    expect(session.move).toHaveBeenCalledTimes(2);
    up(t, { x: 11, y: 10 });
    expect(session.end).toHaveBeenCalledTimes(1);
    expect(session.tap).not.toHaveBeenCalled();
    expect(session.cancel).not.toHaveBeenCalled();
    expect(t.inputs.hand.click).not.toHaveBeenCalled();
  });
  it("a still release goes to tap; true means no click", () => {
    const t = setup();
    const session = { move: vi.fn(), end: vi.fn(), tap: vi.fn(() => true), cancel: vi.fn() };
    t.inputs.hand = { press: () => session };
    t.inputs.sel = { click: vi.fn(() => true) };
    down(t);
    up(t, { x: 12 });
    expect(session.tap).toHaveBeenCalledTimes(1);
    expect(session.cancel).not.toHaveBeenCalled();
    expect(t.inputs.sel.click).not.toHaveBeenCalled();
  });
  it("a still release with no tap cancels the session and offers a click", () => {
    const t = setup();
    const order = [];
    const session = { move() {}, end: vi.fn(), cancel: vi.fn(() => order.push("cancel")) };
    t.inputs.hand = { press: () => session };
    t.inputs.sel = { click: vi.fn((ev) => order.push(`click:${ev.type}`) && true) };
    down(t);
    const e = up(t);
    expect(order).toEqual(["cancel", "click:click"]);
    expect(session.end).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });
  it("pointercancel cancels and never commits", () => {
    const t = setup();
    const session = { move: vi.fn(), end: vi.fn(), tap: vi.fn(), cancel: vi.fn() };
    t.inputs.hand = { press: () => session, click: vi.fn() };
    down(t);
    move(t, { x: 40 });
    ptr("pointercancel", t.canvas, { x: 40 });
    up(t, { x: 40 }); // a stray release afterwards does nothing
    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(session.end).not.toHaveBeenCalled();
    expect(session.tap).not.toHaveBeenCalled();
    expect(t.inputs.hand.click).not.toHaveBeenCalled();
  });
  it("Escape cancels an open session that didn't take the key", () => {
    const t = setup();
    const session = { move: vi.fn(), end: vi.fn(), cancel: vi.fn(), key: vi.fn(() => false) };
    t.inputs.hand = { press: () => session };
    down(t);
    move(t, { x: 40 });
    const e = key(t.root, "keydown", "Escape", "Escape");
    expect(session.key).toHaveBeenCalledTimes(1);
    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    up(t, { x: 40 });
    expect(session.end).not.toHaveBeenCalled();
  });
  it("swallows other pointers' presses while a session is open", () => {
    const t = setup();
    t.inputs.hand = { press: vi.fn(() => ({ move() {}, end() {}, cancel() {} })) };
    down(t, { id: 1, pointerType: "touch" });
    const second = down(t, { id: 2, pointerType: "touch" });
    expect(t.inputs.hand.press).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(true);
    expect(t.orbit).not.toHaveBeenCalled();
  });
  it("gives an open session its keys, before the chain", () => {
    const t = setup();
    const session = { move() {}, end() {}, cancel() {}, key: vi.fn((ev) => ev.key === "q"), keyup: vi.fn() };
    t.inputs.hand = { press: () => session };
    t.inputs.keys = { key: vi.fn(() => true), keyup: vi.fn() };
    down(t);
    key(t.root, "keydown", "q");
    key(t.root, "keydown", "x");
    expect(session.key).toHaveBeenCalledTimes(2);
    expect(t.inputs.keys.key).toHaveBeenCalledTimes(1);
    key(t.root, "keyup", "q");
    expect(session.keyup).toHaveBeenCalledTimes(1);
    expect(t.inputs.keys.keyup).not.toHaveBeenCalled();
  });
  it("uses the session's cursor while it lasts", () => {
    const t = setup();
    t.inputs.hand = { press: () => ({ move() {}, end() {}, cancel() {}, cursor: "grabbing" }), cursor: () => "grab" };
    down(t);
    expect(t.onCursor).toHaveBeenLastCalledWith("grabbing");
    up(t, { x: 40 });
    expect(t.onCursor).toHaveBeenLastCalledWith("grab");
  });
});

describe("clicks on unclaimed presses", () => {
  it("a still unclaimed press offers a click; a moved one offers nothing", () => {
    const t = setup();
    t.inputs.sel = { press: () => null, click: vi.fn(() => true) };
    down(t);
    up(t, { x: 13 });
    expect(t.inputs.sel.click).toHaveBeenCalledTimes(1);
    down(t);
    move(t, { x: 30, buttons: 1 });
    up(t, { x: 30 });
    expect(t.inputs.sel.click).toHaveBeenCalledTimes(1);
  });
  it("a second finger on an unclaimed press makes it a pinch, not a click", () => {
    const t = setup();
    t.inputs.sel = { click: vi.fn(() => true), press: vi.fn(() => null) };
    down(t, { id: 1, pointerType: "touch" });
    down(t, { id: 2, pointerType: "touch" });
    up(t, { id: 2, pointerType: "touch" });
    up(t, { id: 1, pointerType: "touch" });
    expect(t.inputs.sel.press).toHaveBeenCalledTimes(1);
    expect(t.inputs.sel.click).not.toHaveBeenCalled();
    expect(t.orbit).toHaveBeenCalledTimes(2);
  });
  it("offers dblclick down the chain", () => {
    const t = setup();
    t.inputs.a = { dblclick: vi.fn(() => true) };
    const e = new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
    t.canvas.dispatchEvent(e);
    expect(t.inputs.a.dblclick).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });
});

describe("menu", () => {
  it("a still right release is a menu; the native one is always stopped", () => {
    const t = setup();
    t.inputs.m = { press: vi.fn(() => null), menu: vi.fn(() => true), click: vi.fn() };
    down(t, { button: 2 });
    expect(t.inputs.m.press).toHaveBeenCalledTimes(1);
    expect(t.orbit).toHaveBeenCalledTimes(1); // unclaimed: orbit pans
    up(t, { button: 2 });
    expect(t.inputs.m.menu).toHaveBeenCalledTimes(1);
    expect(t.inputs.m.menu.mock.calls[0][0].type).toBe("menu");
    expect(t.inputs.m.click).not.toHaveBeenCalled();
    const cm = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    t.canvas.dispatchEvent(cm);
    expect(cm.defaultPrevented).toBe(true);
  });
  it("a moved right drag is a pan, not a menu", () => {
    const t = setup();
    t.inputs.m = { menu: vi.fn(() => true) };
    down(t, { button: 2 });
    move(t, { x: 40, buttons: 2 });
    up(t, { x: 40, button: 2 });
    expect(t.inputs.m.menu).not.toHaveBeenCalled();
  });
  it("ctrl+click is a menu on a Mac", () => {
    const t = setup({ mac: true });
    t.inputs.m = { menu: vi.fn(() => true), click: vi.fn(() => true) };
    down(t, { ctrlKey: true });
    up(t, { ctrlKey: true });
    expect(t.inputs.m.menu).toHaveBeenCalledTimes(1);
    expect(t.inputs.m.click).not.toHaveBeenCalled();
  });
  it("a 500 ms touch hold cancels the session and opens a menu", () => {
    vi.useFakeTimers();
    const t = setup();
    const session = { move: vi.fn(), end: vi.fn(), tap: vi.fn(), cancel: vi.fn() };
    t.inputs.hand = { press: () => session };
    t.inputs.m = { menu: vi.fn(() => true), click: vi.fn() };
    down(t, { pointerType: "touch" });
    vi.advanceTimersByTime(499);
    expect(t.inputs.m.menu).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(t.inputs.m.menu).toHaveBeenCalledTimes(1);
    up(t, { pointerType: "touch" });
    expect(session.tap).not.toHaveBeenCalled();
    expect(t.inputs.m.click).not.toHaveBeenCalled();
  });
});

describe("wheel", () => {
  const wheel = (t) => {
    const e = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100, clientX: 5, clientY: 5 });
    t.canvas.dispatchEvent(e);
    return e;
  };
  it("unclaimed, it zooms", () => {
    const t = setup();
    const e = wheel(t);
    expect(t.orbit).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(false);
  });
  it("claimed, orbit doesn't see it", () => {
    const t = setup();
    t.inputs.z = { wheel: vi.fn((ev) => ev.deltaY === 100) };
    const e = wheel(t);
    expect(e.defaultPrevented).toBe(true);
    expect(t.orbit).not.toHaveBeenCalled();
  });
  it("with the camera held, nothing zooms", () => {
    const t = setup({ held: true });
    const e = wheel(t);
    expect(e.defaultPrevented).toBe(true);
    expect(t.orbit).not.toHaveBeenCalled();
  });
});

describe("keys", () => {
  it("a keyup goes to whoever claimed its keydown, even after they disarm", () => {
    const t = setup();
    t.inputs.keys = { key: vi.fn(() => true), keyup: vi.fn(() => true) };
    const armed = { key: vi.fn((ev) => ev.key === "w"), keyup: vi.fn() };
    const disarm = t.router.arm("fps", armed);
    const kd = key(t.root, "keydown", "w");
    expect(kd.defaultPrevented).toBe(true);
    key(t.root, "keydown", "s");
    expect(t.inputs.keys.key).toHaveBeenCalledTimes(1);
    disarm();
    key(t.root, "keyup", "w");
    key(t.root, "keyup", "s");
    expect(armed.keyup).toHaveBeenCalledTimes(1);
    expect(armed.keyup.mock.calls[0][0].key).toBe("w");
    expect(t.inputs.keys.keyup).toHaveBeenCalledTimes(1);
    expect(t.inputs.keys.keyup.mock.calls[0][0].key).toBe("s");
  });
  it("an unclaimed key isn't prevented, and its keyup goes nowhere", () => {
    const t = setup();
    t.inputs.keys = { key: () => false, keyup: vi.fn() };
    const e = key(t.root, "keydown", "z");
    key(t.root, "keyup", "z");
    expect(e.defaultPrevented).toBe(false);
    expect(t.inputs.keys.keyup).not.toHaveBeenCalled();
  });
  it("key events carry no hit", () => {
    const t = setup();
    let seen;
    t.inputs.keys = { key: (ev) => ((seen = ev), true) };
    key(t.root, "keydown", "a");
    expect(seen.hit).toBe(null);
    expect(seen.type).toBe("key");
    expect(t.pick).not.toHaveBeenCalled();
  });
  it("a field being typed in keeps its keys; Escape blurs it", () => {
    const t = setup();
    t.inputs.keys = { key: vi.fn(() => true) };
    const field = document.createElement("input");
    t.root.append(field);
    field.focus();
    key(field, "keydown", "a");
    expect(t.inputs.keys.key).not.toHaveBeenCalled();
    const blur = vi.spyOn(field, "blur");
    key(field, "keydown", "Escape", "Escape");
    expect(blur).toHaveBeenCalled();
    expect(t.inputs.keys.key).not.toHaveBeenCalled();
  });
  it("on blur and a hidden page, every held key gets its keyup", () => {
    const t = setup();
    const armed = { key: () => true, keyup: vi.fn() };
    t.router.arm("fps", armed);
    key(t.root, "keydown", "w");
    key(t.root, "keydown", "a");
    window.dispatchEvent(new Event("blur"));
    expect(armed.keyup.mock.calls.map((c) => c[0].key)).toEqual(["w", "a"]);
    expect(armed.keyup.mock.calls[0][0].type).toBe("keyup");
    key(t.root, "keyup", "w"); // already released
    expect(armed.keyup).toHaveBeenCalledTimes(2);

    key(t.root, "keydown", "d");
    const vis = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState") ?? Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
    } finally {
      delete document.visibilityState;
      if (vis && !Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState")) Object.defineProperty(document, "visibilityState", vis);
    }
    expect(armed.keyup).toHaveBeenCalledTimes(3);
  });
});

describe("the arm stack", () => {
  it("suspends, resumes and disarms", () => {
    const t = setup();
    const a = { suspended: vi.fn(), resumed: vi.fn(), disarmed: vi.fn() };
    const b = { suspended: vi.fn(), resumed: vi.fn(), disarmed: vi.fn() };
    const offA = t.router.arm("measure", a);
    expect(t.router.armedOwner()).toBe("measure");
    const offB = t.router.arm("menu", b);
    expect(a.suspended).toHaveBeenCalledTimes(1);
    expect(t.router.armedOwner()).toBe("menu");
    offB();
    offB(); // twice is once
    expect(b.disarmed).toHaveBeenCalledTimes(1);
    expect(a.resumed).toHaveBeenCalledTimes(1);
    expect(b.suspended).not.toHaveBeenCalled();
    expect(t.router.armedOwner()).toBe("measure");
    offA();
    expect(a.disarmed).toHaveBeenCalledTimes(1);
    expect(t.router.armedOwner()).toBe(null);
    expect(t.onArmed.mock.calls.map((c) => c[0])).toEqual(["measure", "menu", "measure", null]);
  });
  it("replace pops the owner's own earlier arm first", () => {
    const t = setup();
    const first = { disarmed: vi.fn(), suspended: vi.fn() };
    const second = { disarmed: vi.fn() };
    t.router.arm("measure", first);
    t.router.arm("measure", second, { replace: true });
    expect(first.disarmed).toHaveBeenCalledTimes(1);
    expect(first.suspended).not.toHaveBeenCalled();
    t.router.stopOwner("measure");
    expect(second.disarmed).toHaveBeenCalledTimes(1);
    expect(t.router.armedOwner()).toBe(null);
  });
  it("the armed handlers come first, and the armed owner isn't offered again", () => {
    const t = setup();
    t.inputs.measure = { press: vi.fn(() => null), click: vi.fn(() => true) };
    t.inputs.sel = { click: vi.fn(() => true) };
    const armed = { click: vi.fn(() => false), press: vi.fn(() => null) };
    t.router.arm("measure", armed);
    down(t);
    up(t);
    expect(armed.press).toHaveBeenCalled();
    expect(armed.click).toHaveBeenCalled();
    expect(t.inputs.measure.press).not.toHaveBeenCalled();
    expect(t.inputs.measure.click).not.toHaveBeenCalled();
    expect(t.inputs.sel.click).toHaveBeenCalledTimes(1);
  });
  it("the armed extension hears every move", () => {
    const t = setup();
    const armed = { move: vi.fn() };
    t.router.arm("fps", armed);
    move(t, { x: 20, buttons: 0, movementX: 3 });
    move(t, { x: 25, buttons: 0 });
    expect(armed.move).toHaveBeenCalledTimes(2);
    expect(armed.move.mock.calls[0][0].type).toBe("move");
  });
  it("locks, reports a lost lock without disarming, relocks, and unlocks on pop", async () => {
    const t = setup();
    let lockEl = null;
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => lockEl });
    try {
      const armed = { lockLost: vi.fn(), keyup: vi.fn(), key: () => true, move: vi.fn() };
      const off = t.router.arm("fps", armed, { lock: true });
      expect(t.requestLock).toHaveBeenCalledTimes(1);
      lockEl = t.canvas;
      document.dispatchEvent(new Event("pointerlockchange"));
      move(t, { x: 99, movementX: 7, movementY: 1, buttons: 0 });
      const ev = armed.move.mock.calls[0][0];
      expect([ev.locked, ev.dx, ev.dy, ev.ndc]).toEqual([true, 7, 1, [0, 0]]);
      expect(ev.ray).toEqual({ origin: [0, 0, 0], dir: [0, 0, -1] });
      key(t.root, "keydown", "w");
      lockEl = null;
      document.dispatchEvent(new Event("pointerlockchange"));
      expect(armed.lockLost).toHaveBeenCalledTimes(1);
      expect(armed.keyup).toHaveBeenCalledTimes(1);
      expect(t.router.armedOwner()).toBe("fps");
      await t.router.relock("fps");
      expect(t.requestLock).toHaveBeenCalledTimes(2);
      await t.router.relock("nobody");
      expect(t.requestLock).toHaveBeenCalledTimes(2);
      off();
      expect(t.exitLock).toHaveBeenCalledTimes(1);
    } finally {
      delete document.pointerLockElement;
    }
  });
});

describe("stopping an owner", () => {
  it("cancels its session, pops its arms and lets go of its keys", () => {
    const t = setup();
    const session = { move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
    t.inputs.hand = { press: () => session, keyup: vi.fn() };
    const armed = { key: () => true, keyup: vi.fn(), disarmed: vi.fn() };
    down(t); // (pressed first: while armed, its own input isn't offered)
    t.router.arm("hand", armed);
    key(t.root, "keydown", "q");
    t.router.stopOwner("hand");
    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(armed.keyup).toHaveBeenCalledTimes(1);
    expect(armed.disarmed).toHaveBeenCalledTimes(1);
    expect(t.router.armedOwner()).toBe(null);
    up(t, { x: 40 });
    expect(session.end).not.toHaveBeenCalled();
  });
});

describe("laziness and holders", () => {
  it("doesn't pick unless someone reads the hit", () => {
    const t = setup();
    t.inputs.a = { press: () => null, click: () => true };
    down(t);
    up(t);
    expect(t.pick).not.toHaveBeenCalled();
    t.inputs.a.click = (ev) => !!ev.hit && !!ev.hit && true;
    down(t);
    up(t);
    expect(t.pick).toHaveBeenCalledTimes(1);
  });
  it("an armed claim never works out the chain", () => {
    const t = setup();
    t.router.arm("tool", { press: () => ({ move() {}, end() {}, cancel() {} }) });
    t.chainFor.mockClear();
    down(t);
    expect(t.chainFor).not.toHaveBeenCalled();
  });
  it("gives each extension its own holder, sharing one pick", () => {
    const t = setup({ holders: { deck: "pile1", die: "d6" } });
    const seen = {};
    t.inputs.deck = { press: (ev) => ((seen.deck = [ev.holder, ev.hit]), null) };
    t.inputs.die = { press: (ev) => ((seen.die = [ev.holder, ev.hit]), null) };
    t.inputs.view = { press: (ev) => ((seen.view = [ev.holder]), null) };
    down(t);
    expect(seen.deck[0]).toBe("pile1");
    expect(seen.die[0]).toBe("d6");
    expect(seen.view[0]).toBe(null);
    expect(seen.deck[1]).toBe(seen.die[1]);
    expect(t.pick).toHaveBeenCalledTimes(1);
  });
});

describe("hover and cursor", () => {
  it("hovers once a frame, not while pressed, and clears on leave", async () => {
    const t = setup();
    t.inputs.a = { cursor: (ev) => (ev.hit ? "pointer" : null) };
    move(t, { x: 20, buttons: 0 });
    move(t, { x: 21, buttons: 0 });
    await frame();
    expect(t.onHover).toHaveBeenCalledTimes(1);
    expect(t.onHover.mock.calls[0][0].x).toBe(21);
    expect(t.onCursor).toHaveBeenLastCalledWith("pointer");
    move(t, { x: 30, buttons: 1 });
    await frame();
    expect(t.onHover).toHaveBeenCalledTimes(1);
    t.canvas.dispatchEvent(new PointerEvent("pointerleave"));
    expect(t.onHover).toHaveBeenLastCalledWith(null);
  });
  it("prefers the armed handlers' cursor", async () => {
    const t = setup();
    t.inputs.a = { cursor: () => "pointer" };
    t.router.arm("measure", { cursor: () => "crosshair" });
    move(t, { x: 20, buttons: 0 });
    await frame();
    expect(t.onCursor).toHaveBeenLastCalledWith("crosshair");
  });
});
