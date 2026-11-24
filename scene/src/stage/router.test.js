// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildEvent, createRouter, isMac, releaseKind, retype, withHolder } from "./router.js";
import { isTyping } from "./key-order.js";

// A port with a canvas in it, a key root around both, and a router whose
// chain is whatever the test puts in `inputs` (in insertion order).
function setup({ held = false, holders = {}, mac = false, base = {}, time, touch } = {}) {
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
    onState: vi.fn(),
    wanted: false,
    // the view's own Escape (ladder.js restLayer): a selection, then how deep the focus is
    selected: false,
    focus: 0,
    deselect: vi.fn(() => {
      t.selected = false;
    }),
    baseInput: base,
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
    onState: t.onState,
    base: { id: "look", input: t.baseInput },
    pointerWanted: () => t.wanted,
    restLayer: () => (t.selected ? "selection" : t.focus > 0 ? "focus" : null),
    escapeRest: () => (t.selected ? t.deselect() : t.focus--),
    requestLock: t.requestLock,
    exitLock: t.exitLock,
    mac,
    ...(time ? { time } : {}),
    ...(touch !== undefined ? { touch } : {}),
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
  it("builds events with port-local x, y and lazy, memoised picks", () => {
    const pick = vi.fn(() => ({ id: "a" }));
    const ray = vi.fn(() => "r");
    const ev = buildEvent("press", { clientX: 60, clientY: 30, button: 0, buttons: 1, pointerId: 3, pointerType: "pen", shiftKey: true }, {
      portRect: { left: 10, top: 10 },
      canvasRect: { left: 10, top: 10, width: 100, height: 40 },
      pick,
      ray,
    });
    expect([ev.x, ev.y]).toEqual([50, 20]);
    expect(ev.shift).toBe(true);
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
    expect([ev.x, ev.y, ev.dx, ev.dy, ev.locked]).toEqual([100, 50, 5, -2, true]);
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
  it("ignores presses on anything but the canvas", () => {
    const t = setup();
    t.inputs.hand = { press: vi.fn(() => ({})) };
    const label = document.createElement("div");
    t.port.append(label);
    ptr("pointerdown", label);
    expect(t.inputs.hand.press).not.toHaveBeenCalled();
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
  it("swallows other pointers' presses while a session is open", () => {
    const t = setup();
    t.inputs.hand = { press: vi.fn(() => ({ move() {}, end() {}, cancel() {} })) };
    down(t, { id: 1, pointerType: "touch" });
    const second = down(t, { id: 2, pointerType: "touch" });
    expect(t.inputs.hand.press).toHaveBeenCalledTimes(1);
    expect(second.defaultPrevented).toBe(true);
    expect(t.orbit).not.toHaveBeenCalled();
  });
  it("gives an open session the keys it declares, before the chain; the rest go on", () => {
    const t = setup();
    const session = { move() {}, end() {}, cancel() {}, keys: [{ code: "KeyQ" }], key: vi.fn((ev) => ev.key === "q"), keyup: vi.fn() };
    t.inputs.hand = { press: () => session };
    t.inputs.keys = { key: vi.fn(() => true), keyup: vi.fn() };
    down(t);
    key(t.root, "keydown", "q");
    key(t.root, "keydown", "x");
    expect(session.key).toHaveBeenCalledTimes(1);
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
  it("a still unclaimed press offers a click (a right one a menu); a moved one (a drag, a right one a pan) offers nothing", () => {
    for (const [button, offered] of [[0, "click"], [2, "menu"]])
      for (const moved of [false, true]) {
        const t = setup();
        t.inputs.sel = { press: () => null, click: vi.fn(() => true), menu: vi.fn(() => true) };
        down(t, { button });
        if (moved) move(t, { x: 30, buttons: button === 2 ? 2 : 1 });
        up(t, { x: moved ? 30 : 13, button });
        const got = ["click", "menu"].filter((k) => t.inputs.sel[k].mock.calls.length);
        expect([button, moved, got]).toEqual([button, moved, moved ? [] : [offered]]);
      }
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
  it("a dblclick on the canvas is no event of the stage's: nothing in the chain or the body is offered one", () => {
    const t = setup({ base: { dblclick: vi.fn(() => true) } });
    t.inputs.a = { dblclick: vi.fn(() => true) };
    const e = new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 });
    t.canvas.dispatchEvent(e);
    expect(t.inputs.a.dblclick).not.toHaveBeenCalled();
    expect(t.baseInput.dblclick).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
});

// H12: an event goes to the hands top first, then the chain, then the top body, cut at the first claim
describe("hands, top first", () => {
  // Three hands picked up in turn (each goes on top, none puts another
  // down; a hand's kind doesn't change how it is offered), each hand, the
  // chain and the body claiming or passing a click: who hears it is the
  // hands top first, then the chain, then the body, cut at the first claim.
  it("over every claim by three hands, the chain and the body, the click goes down the hands top first, then the chain, then the body", () => {
    const t = setup();
    const claims = {};
    const heard = [];
    const input = (who) => ({ click: () => (heard.push(who), claims[who] || null) });
    t.router.pushBody("w", { id: "walk", input: input("body") });
    t.inputs.x = input("x");
    const model = ["tool0", "edit1", "popover2"];
    for (const name of model) t.router.pushHand(name, { kind: name.slice(0, -1), name, input: input(name) });
    expect(t.router.hands().map((h) => h.owner)).toEqual(model);
    const who = [...[...model].reverse(), "x", "body"];
    for (let bits = 0; bits < 1 << who.length; bits++) {
      who.forEach((w, i) => (claims[w] = !!(bits & (1 << i))));
      heard.length = 0;
      down(t);
      up(t);
      const first = who.findIndex((w) => claims[w]);
      expect([bits, heard]).toEqual([bits, first < 0 ? who : who.slice(0, first + 1)]);
    }
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
  it("a body's declared key is its; a keyup goes to whoever claimed its keydown; a body leaving gets its keyups first", () => {
    const t = setup();
    t.inputs.keys = { key: vi.fn(() => true), keyup: vi.fn(() => true) };
    const armed = { key: vi.fn((ev) => ev.key === "w"), keyup: vi.fn() };
    const pop = t.router.pushBody("fps", { id: "walk", input: armed, keys: [{ code: "KeyW" }] });
    const kd = key(t.root, "keydown", "w");
    expect(kd.defaultPrevented).toBe(true);
    key(t.root, "keydown", "s");
    expect(t.inputs.keys.key).toHaveBeenCalledTimes(1);
    pop();
    expect(armed.keyup).toHaveBeenCalledTimes(1);
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
  it("a search field with text: Escape clears it (one input event), the next leaves it; neither reaches the ladder below", () => {
    const t = setup();
    t.inputs.keys = { key: vi.fn(() => true) };
    const field = document.createElement("input");
    field.type = "search";
    t.root.append(field);
    field.focus();
    field.value = "wind";
    const inputs = vi.fn();
    field.addEventListener("input", inputs);
    const blur = vi.spyOn(field, "blur");
    for (const [value, cleared, blurred] of [["", 1, 0], ["", 1, 1]]) {
      key(field, "keydown", "Escape", "Escape");
      expect(field.value).toBe(value);
      expect(inputs).toHaveBeenCalledTimes(cleared);
      expect(blur).toHaveBeenCalledTimes(blurred);
    }
    expect(t.inputs.keys.key).not.toHaveBeenCalled();
  });
  it("an event's modifier flags are the DOM's or a modifier key down at the root, claimed or not (the touch pad's Alt): every modifier × claimed, reserved but passed, not reserved × let go at the root, elsewhere in the window, by a blur", () => {
    // one code per modifier: a left and a right code read the same through keyOfCode
    const MODS = { ShiftLeft: "shift", AltRight: "alt", ControlLeft: "ctrl", MetaRight: "meta" };
    const KEY = { shift: "Shift", alt: "Alt", ctrl: "Control", meta: "Meta" };
    const flags = (ev) => ["shift", "alt", "ctrl", "meta"].filter((f) => ev[f]);
    const outside = document.createElement("div");
    document.body.append(outside);
    for (const [code, flag] of Object.entries(MODS)) {
      for (const how of ["claimed", "passed", "unreserved"]) {
        for (const gone of ["root", "outside", "blur"]) {
          const t = setup();
          const seen = [];
          const body = { key: (ev) => (seen.push(`body ${ev.code} ${flags(ev)}`), how === "claimed"), keyup: () => true, move: (ev) => seen.push(`move ${flags(ev)}`) };
          t.router.pushBody("b", { id: "b", input: body, keys: how === "unreserved" ? [] : [{ code }] });
          t.inputs.chain = { key: (ev) => (seen.push(`${ev.code} ${flags(ev)}`), false) };
          // the pad's events: no DOM flags on any of them; the modifier's own keydown says it, as a keyboard's does
          key(t.root, "keydown", KEY[flag], code);
          move(t);
          key(t.root, "keydown", "q");
          if (gone === "root") key(t.root, "keyup", KEY[flag], code);
          else if (gone === "outside") key(outside, "keyup", KEY[flag], code);
          else window.dispatchEvent(new Event("blur"));
          move(t);
          const own = how === "unreserved" ? `${code} ${flag}` : `body ${code} ${flag}`;
          expect([code, how, gone, seen]).toEqual([code, how, gone, [own, `move ${flag}`, `KeyQ ${flag}`, "move "]]);
          // the DOM's own flag stands with nothing held
          seen.length = 0;
          move(t, { [`${flag}Key`]: true });
          expect([code, how, gone, seen]).toEqual([code, how, gone, [`move ${flag}`]]);
          t.router.dispose();
        }
      }
    }
    outside.remove();
  });
  it("on blur and a hidden page, every held key gets its keyup", () => {
    const t = setup();
    const armed = { key: () => true, keyup: vi.fn() };
    t.router.pushBody("fps", { id: "walk", input: armed, keys: [{ code: "KeyW" }, { code: "KeyA" }, { code: "KeyD" }] });
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

describe("the body stack", () => {
  it("the base is always at the bottom; a body pushed is suspended under the next and resumed when it goes; leave never pops the base", () => {
    const t = setup();
    const walk = { suspended: vi.fn(), resumed: vi.fn(), left: vi.fn() };
    const seat = { left: vi.fn() };
    expect(t.router.bodies()).toEqual([{ id: "look", owner: null }]);
    expect(t.router.leave()).toBe(false);
    t.router.pushBody("walker", { id: "walk", input: walk });
    t.router.pushBody("s", { id: "seat", input: seat });
    expect(walk.suspended).toHaveBeenCalledTimes(1);
    expect(t.router.body()).toEqual({ id: "seat", owner: "s" });
    expect(t.router.leave()).toBe(true);
    expect(seat.left).toHaveBeenCalledTimes(1);
    expect(walk.resumed).toHaveBeenCalledTimes(1);
    expect(t.router.leave()).toBe(true);
    expect(walk.left).toHaveBeenCalledTimes(1);
    expect(t.router.body().id).toBe("look");
    expect(t.router.leave()).toBe(false);
  });
  it("leaveAll: every body over the base leaves (each told); the base stays", () => {
    const t = setup();
    const walk = { left: vi.fn() };
    const seat = { left: vi.fn() };
    t.router.pushBody("walker", { id: "walk", input: walk });
    t.router.pushBody("s", { id: "seat", input: seat });
    expect(t.router.leaveAll()).toBe(true);
    expect([seat.left.mock.calls.length, walk.left.mock.calls.length]).toEqual([1, 1]);
    expect(t.router.bodies()).toEqual([{ id: "look", owner: null }]);
    expect(t.onState.mock.calls.at(-1)[0].body).toMatchObject({ id: "look", depth: 0 });
    expect(t.router.leaveAll()).toBe(false);
  });
  it("a body popped from under another takes those over it with it", () => {
    const t = setup();
    const walk = { left: vi.fn() };
    const seat = { left: vi.fn() };
    const popWalk = t.router.pushBody("walker", { id: "walk", input: walk });
    t.router.pushBody("s", { id: "seat", input: seat });
    popWalk();
    expect(seat.left).toHaveBeenCalledTimes(1);
    expect(walk.left).toHaveBeenCalledTimes(1);
    expect(t.router.bodies().map((b) => b.id)).toEqual(["look"]);
  });
  it("the top body hears every move, and only the top one", () => {
    const t = setup();
    const under = { move: vi.fn() };
    const over = { move: vi.fn() };
    t.router.pushBody("w", { id: "walk", input: under });
    t.router.pushBody("s", { id: "station", input: over });
    move(t, { x: 20, buttons: 0 });
    move(t, { x: 30, buttons: 1 });
    expect(over.move).toHaveBeenCalledTimes(2);
    expect(under.move).not.toHaveBeenCalled();
  });
  it("each body, tool and gesture is its own serial: the same one left and taken again is a new one (the keys it held were let go)", () => {
    const t = setup();
    const serials = () => {
      const st = t.onState.mock.calls.at(-1)[0];
      return [st.body.serial, st.held[0]?.serial ?? null, st.gesture?.serial ?? null];
    };
    const walk = { id: "walk", input: { press: () => ({ keys: [{ code: "KeyQ" }], end() {}, cancel() {} }) }, keys: [{ code: "KeyW" }] };
    const measure = { command: "measure", name: "Measure", input: {}, keys: [{ code: "KeyR" }] };
    const steps = [
      ["walk", () => t.router.pushBody("w", walk), [2, null, null]],
      ["measure", () => t.router.hold("m", measure), [2, 3, null]],
      ["measure again: put down", () => t.router.hold("m", measure), [2, null, null]],
      ["and again: picked up anew", () => t.router.hold("m", measure), [2, 4, null]],
      ["walk left and taken again", () => (t.router.leave(), t.router.pushBody("w", walk)), [5, 4, null]],
      ["a press opens a session", () => down(t), [5, 4, 6]],
      ["its release", () => up(t), [5, 4, null]],
      ["another press", () => down(t), [5, 4, 7]],
    ];
    for (const [what, step, want] of steps) {
      step();
      expect([what, serials()]).toEqual([what, want]);
    }
  });
});

describe("held tools", () => {
  it("a stack: another goes on top and puts none down; one held picked up again is put down (a toggle); put() and putDown take one from wherever it is", () => {
    const t = setup();
    const a = { put: vi.fn() };
    const b = { put: vi.fn() };
    const c = { put: vi.fn() };
    const putA = t.router.hold("x", { command: "a", input: a });
    t.router.hold("y", { command: "b", input: b });
    t.router.hold("z", { command: null, name: "Piece", input: c });
    expect([a.put.mock.calls.length, t.router.held()]).toEqual([0, [{ owner: "x", command: "a", name: "a", serial: 2 }, { owner: "y", command: "b", name: "b", serial: 3 }, { owner: "z", command: null, name: "Piece", serial: 4 }]]);
    // b again: b goes, from the middle; nothing else
    expect(t.router.hold("y", { command: "b", input: b })).toBe(null);
    expect([a.put.mock.calls.length, b.put.mock.calls.length, c.put.mock.calls.length]).toEqual([0, 1, 0]);
    expect(t.router.held().map((h) => h.owner)).toEqual(["x", "z"]);
    // a tool held directly (no command) is never a toggle: another goes on top
    t.router.hold("z", { command: null, name: "Piece", input: c });
    expect(t.router.held().map((h) => h.owner)).toEqual(["x", "z", "z"]);
    // put(): its own, from the bottom
    putA();
    putA();
    expect([a.put.mock.calls.length, t.router.held().map((h) => h.owner)]).toEqual([1, ["z", "z"]]);
    // putDown(): the one named (by its serial: a tool held directly has no command to name it by), else the topmost
    expect(t.router.putDown({ owner: "x", command: "a" })).toBe(false);
    expect(t.router.putDown({ owner: "z", command: null })).toBe(false);
    const [under, over] = t.router.held();
    expect(t.router.putDown({ serial: under.serial })).toBe(true);
    expect(t.router.held()).toEqual([over]);
    expect(t.router.putDown()).toBe(true);
    expect([c.put.mock.calls.length, t.router.held(), t.router.putDown()]).toEqual([2, [], false]);
  });
  // STAGE.md, "Keys": a key with ctrl or meta held is no reserver's, whatever declares it (a pad's Z is not ⌘Z)
  it("a reserved key with ctrl or meta held goes to the chain, not its reserver, for every reserver; without them, to its reserver", () => {
    for (const reserver of ["gesture", "hand", "body"]) {
      for (const mod of [null, "ctrlKey", "metaKey"]) {
        const t = setup();
        const seen = [];
        const input = { key: (ev) => (seen.push(reserver), true), keyup: () => true };
        if (reserver === "body") t.router.pushBody("b", { id: "pad", input, keys: [{ code: "KeyZ" }] });
        if (reserver === "hand") t.router.pushHand("h", { kind: "pad", name: "Pad", input, keys: [{ code: "KeyZ" }] });
        if (reserver === "gesture") t.inputs.hand = { press: () => ({ move() {}, end() {}, cancel() {}, keys: [{ code: "KeyZ" }], key: input.key }) };
        t.inputs.keys = { key: () => (seen.push("chain"), true) };
        if (reserver === "gesture") down(t);
        key(t.root, "keydown", "z", "KeyZ", mod ? { [mod]: true } : {});
        expect([reserver, mod, seen]).toEqual([reserver, mod, [mod ? "chain" : reserver]]);
        t.router.dispose();
      }
    }
  });
  it("a reserved key does nothing else even when its reserver passes", () => {
    const t = setup();
    t.inputs.keys = { key: vi.fn(() => true) };
    t.router.pushBody("w", { id: "walk", input: { key: () => false }, keys: [{ code: "KeyD" }] });
    const e = key(t.root, "keydown", "d");
    expect(t.inputs.keys.key).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });
});

describe("Escape", () => {
  // H4 (STAGE.md, Invariants), on the router: one case per rung of the
  // ladder (ladder.test.js proves the rule over every state). Steps pick up
  // a tool, an Edit-like hand (whose escape is the view's own, as the view's
  // is) or a popover, open a gesture, select or enter a link; then Escape
  // pops exactly the model's top layer, the hint names it, and the body
  // stays.
  const RUNGS = [
    ["gesture", ["select", "gesture"]],
    ["hand", ["select", "tool"]],
    ["popover", ["tool", "popover"]],
    ["selection", ["select", "edit"]], // the Edit hand's own escape first
    ["hand", ["edit"]], // an Edit hand with nothing to rest on goes down
    ["selection", ["enter", "select"]],
    ["focus", ["enter"]],
  ];
  it("one case per rung (gesture, tool, popover, Edit with and without rest, selection, focus): Escape pops exactly the top layer, and the hint names it", () => {
    for (const [rung, steps] of RUNGS) {
      const seq = [...steps, "esc"];
      const t = setup();
      const body = { left: vi.fn() };
      t.router.pushBody("w", { id: "walk", input: body });
      const session = { move() {}, end: vi.fn(), cancel: vi.fn(), key: vi.fn(() => false), keys: [{ code: "Escape" }] };
      t.inputs.carry = { press: () => (gestureOpen ? null : session) };
      let gestureOpen = false;
      session.cancel.mockImplementation(() => (gestureOpen = false));
      // the model
      let hands = []; // kinds, top last
      let m = { gesture: false, selected: false, focus: 0 };
      const rest = () => (t.selected ? "selection" : t.focus > 0 ? "focus" : null);
      const editHand = () => ({ kind: "edit", name: "Edit", escape: () => (rest() ? (t.selected ? t.deselect() : t.focus--, true) : false), escaping: rest });
      let serial = 0;
      for (const step of seq) {
        if (step === "tool") {
          hands.push("tool");
          t.router.pushHand(`h${serial++}`, { kind: "tool", name: "Tool" });
        } else if (step === "edit") {
          hands.push("edit");
          t.router.pushHand(`h${serial++}`, editHand());
        } else if (step === "popover") {
          hands.push("popover");
          let release = null;
          release = t.router.popover(`h${serial++}`, () => release());
        } else if (step === "gesture") {
          down(t);
          gestureOpen = m.gesture = true;
        } else if (step === "select") t.selected = m.selected = true;
        else if (step === "enter") t.focus = ++m.focus;
        else {
          // the model's top layer
          const top = hands.at(-1);
          const want = m.gesture ? "gesture" : top === "edit" ? (m.selected ? "selection" : m.focus ? "focus" : "hand") : top ? (top === "popover" ? "popover" : "hand") : m.selected ? "selection" : m.focus ? "focus" : null;
          expect([seq, want]).toEqual([seq, rung]);
          expect([seq, t.router.state().escape]).toEqual([seq, want]);
          key(t.root, "keydown", "Escape", "Escape");
          if (want === "gesture") m.gesture = false;
          else if (want === "selection") m.selected = false;
          else if (want === "focus") m.focus--;
          else if (want) hands.pop();
          expect([seq, t.router.hands().map((h) => h.kind), t.selected, t.focus, gestureOpen]).toEqual([seq, hands, m.selected, m.focus, m.gesture]);
        }
        expect(t.router.body().id).toBe("walk");
      }
      expect(body.left).not.toHaveBeenCalled();
      // a cancelled gesture never heard the Escape, and its release commits nothing
      up(t);
      expect([seq, session.key.mock.calls.length, session.end.mock.calls.length]).toEqual([seq, 0, 0]);
    }
  });
  it("a hand whose escape does something stays; one whose escape does nothing is put down (told once)", () => {
    const t = setup();
    let left = 1;
    const put = vi.fn();
    t.router.pushHand("x", { kind: "edit", name: "Edit", escape: () => left-- > 0, escaping: () => (left > 0 ? "selection" : null), put });
    expect(t.router.state().escape).toBe("selection");
    key(t.root, "keydown", "Escape", "Escape");
    expect([t.router.hands().length, put.mock.calls.length, t.router.state().escape]).toEqual([1, 0, "hand"]);
    key(t.root, "keydown", "Escape", "Escape");
    expect([t.router.hands().length, put.mock.calls.length, t.router.state().escape]).toEqual([0, 1, null]);
    expect(key(t.root, "keydown", "Escape", "Escape").defaultPrevented).toBe(false); // nothing stood: the key is the page's
  });
});

describe("H4, H5, H12: one stack of hands, exhaustively", () => {
  // Every sequence of up to four steps, each picking up or putting down one
  // of five hands, or pressing Escape, over a body that locks the pointer
  // (walk) or one that doesn't (seat), both declaring W and Q:
  //   M  Measure: a tool that wants the pointer, passes presses, takes clicks; declares Q
  //   G  a gun: a tool that takes a press under the lock only, and every click; declares R and Q
  //   X  the X-ray: a tool that passes everything and wants nothing
  //   E  the Edit hand: wants the pointer, takes clicks
  //   P  a popover: wants the pointer, modal (the router's own input: it takes everything)
  // Picking up a tool held puts it down (the router's toggle); picking up E or
  // P held puts it down too (as the editor's command and a menu's button do).
  // Escape under the lock is the browser's (released, the page hears
  // nothing); else it pops the top hand. After the steps, against a model:
  // the stack and the tools in it, every put-down told once (H4: Escape put
  // down exactly the top), the pointer (H5: wanted ⇔ a hand asks; locked ⇔
  // the body locks ∧ ¬wanted ∧ ¬released), Escape's rung, then a press and
  // its release, a wheel and four keys: each offered the hands top first,
  // then the chain, then the body, and cut exactly at the first that
  // consumes it (H12: a press consumed never reaches orbit; one only
  // relocking reaches nobody), each key heard only by the topmost layer
  // declaring it, else the chain (H12).
  const E = {
    M: { owner: "m", name: "Measure", tool: "measure", pointer: true, keys: ["KeyQ"], takes: { press: false, click: true, wheel: false } },
    G: { owner: "g", name: "Gun", tool: "gun", pointer: false, keys: ["KeyR", "KeyQ"], takes: { press: "locked", click: true, wheel: false } },
    X: { owner: "x", name: "X-ray", tool: "xray", pointer: false, keys: [], takes: { press: false, click: false, wheel: false } },
    E: { owner: "e", name: "Edit", tool: null, pointer: true, keys: [], takes: { click: true } },
    P: { owner: "p", name: "menu", tool: null, pointer: true, keys: [], takes: { press: true, click: true, wheel: true } },
  };
  // (No -E or -P: the driver below runs exactly the same calls for one as
  // for +E or +P when it's held, and none at all when it isn't, so every
  // sequence with one is run as another sequence here, the same or shorter.)
  const STEPS = [...Object.keys(E).flatMap((k) => (E[k].tool ? [`+${k}`, `-${k}`] : [`+${k}`])), "esc"];
  const BODY_KEYS = ["KeyW", "KeyQ"];
  const CODES = ["KeyQ", "KeyR", "KeyW", "KeyZ"];

  function* seqs(n) {
    if (n === 0) return yield [];
    for (const p of seqs(n - 1)) for (const st of STEPS) yield [...p, st];
  }

  /** The model's route for one event type: who hears it (P's input is the router's: unheard), and who took it. */
  function route(m, type, locked) {
    const heard = [];
    for (const k of [...m.stack].reverse()) {
      const takes = E[k].takes[type];
      if (takes === undefined) continue;
      if (k !== "P") heard.push(`${k}:${type}`);
      if (takes === true || (takes === "locked" && locked)) return { heard, took: k };
    }
    heard.push(`chain:${type}`, `body:${type}`);
    return { heard, took: type === "click" ? "body" : null };
  }

  it("every sequence of ≤4 steps × a lock body or not: the stack, the put-downs, the pointer, Escape's rung, the offering order and its cut, and key ownership are the model's", () => {
    let n = 0;
    for (const lockBody of [true, false])
      for (let len = 1; len <= 4; len++)
        for (const seq of seqs(len)) {
          const t = setup({ touch: false });
          // a lock the browser grants at once, and lets go on its own Escape
          let lockEl = null;
          Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => lockEl });
          const change = (el) => ((lockEl = el), document.dispatchEvent(new Event("pointerlockchange")));
          t.requestLock.mockImplementation(() => (change(t.canvas), Promise.resolve()));
          t.exitLock.mockImplementation(() => change(null));
          const heard = [];
          const puts = [];
          const rec = (who, type, answer) => (ev) => (heard.push(`${who}:${type}`), typeof answer === "function" ? answer(ev) : answer);
          const bare = { move() {}, end() {}, cancel() {}, tap: () => true };
          t.inputs.chain = { press: rec("chain", "press", null), click: rec("chain", "click", false), wheel: rec("chain", "wheel", false), key: rec("chain", "key", true), keyup: rec("chain", "keyup", true) };
          const input = {
            M: { press: rec("M", "press", null), click: rec("M", "click", true), wheel: rec("M", "wheel", false), key: rec("M", "key", true), keyup: rec("M", "keyup", true), put: () => puts.push("M") },
            G: { press: rec("G", "press", (ev) => (ev.locked ? bare : null)), click: rec("G", "click", true), wheel: rec("G", "wheel", false), key: rec("G", "key", true), keyup: rec("G", "keyup", true), put: () => puts.push("G") },
            X: { press: rec("X", "press", null), click: rec("X", "click", false), wheel: rec("X", "wheel", false), put: () => puts.push("X") },
            E: { click: rec("E", "click", true) },
          };
          t.router.pushBody("b", { id: lockBody ? "walk" : "seat", lock: lockBody, keys: BODY_KEYS.map((code) => ({ code })), input: { press: rec("body", "press", null), click: rec("body", "click", true), wheel: rec("body", "wheel", false), key: rec("body", "key", true), keyup: rec("body", "keyup", true) } });
          // the model
          const m = { stack: [], puts: [], released: false };
          const wanted = () => m.stack.some((k) => E[k].pointer);
          const locked = () => lockBody && !wanted() && !m.released;
          const releases = {}; // E's and P's release, while held
          const drop = (k) => ((m.stack = m.stack.filter((x) => x !== k)), m.puts.push(k));
          for (const step of seq) {
            const k = step.slice(1);
            const held = m.stack.includes(k);
            if (step === "esc") {
              if (locked()) {
                // the browser's own Escape: the page never hears it
                m.released = true;
                change(null);
              } else {
                if (m.stack.length) drop(m.stack.at(-1));
                key(t.root, "keydown", "Escape", "Escape");
              }
            } else if (E[k].tool) {
              if (step[0] === "+") {
                if (held) drop(k);
                else m.stack.push(k);
                t.router.hold(E[k].owner, { command: E[k].tool, name: E[k].name, input: input[k], keys: E[k].keys.map((code) => ({ code })), pointer: E[k].pointer });
              } else {
                if (held) drop(k);
                expect(t.router.putDown({ owner: E[k].owner, command: E[k].tool })).toBe(held);
              }
            } else if (step[0] === "-" || held) {
              if (held) (drop(k), releases[k]());
            } else {
              m.stack.push(k);
              if (k === "E") releases.E = t.router.pushHand("e", { kind: "edit", name: "Edit", input: input.E, pointer: true, escape: () => false, escaping: () => null, put: () => puts.push("E") });
              else {
                // a menu closing (itself, or Escape's close()) says so
                const rel = t.router.popover("p", () => releases.P());
                releases.P = () => (puts.push("P"), rel());
              }
            }
          }
          const top = m.stack.at(-1);
          const owners = (ks) => ks.map((x) => E[x].owner);
          expect([seq, lockBody, t.router.hands().map((h) => h.owner), t.router.held().map((h) => h.owner), puts]).toEqual([seq, lockBody, owners(m.stack), owners(m.stack.filter((x) => E[x].tool)), m.puts]);
          const st = t.router.state();
          expect([seq, lockBody, st.pointer.wanted, st.pointer.locked, lockEl === t.canvas, st.escape]).toEqual([seq, lockBody, wanted(), locked(), locked(), locked() ? "lock" : top ? (top === "P" ? "popover" : "hand") : null]);
          // a press and its release: after the browser's Escape, the first press on the world only relocks
          heard.length = 0;
          t.orbit.mockClear();
          if (lockBody && m.released && !wanted()) {
            down(t);
            up(t);
            expect([seq, lockBody, heard, t.orbit.mock.calls.length, lockEl === t.canvas]).toEqual([seq, lockBody, [], 0, true]);
            m.released = false;
          }
          const press = route(m, "press", locked());
          const click = press.took === "G" ? null : route(m, "click", locked());
          down(t);
          up(t);
          expect([seq, lockBody, heard, t.orbit.mock.calls.length > 0]).toEqual([seq, lockBody, [...press.heard, ...(click?.heard ?? [])], press.took == null]);
          heard.length = 0;
          t.orbit.mockClear();
          t.canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 10 }));
          const wheel = route(m, "wheel", locked());
          expect([seq, lockBody, heard, t.orbit.mock.calls.length > 0]).toEqual([seq, lockBody, wheel.heard, wheel.took == null]);
          // each key: the topmost hand that declares it, else the body, else the chain; its keyup to the same
          for (const code of CODES) {
            heard.length = 0;
            key(t.root, "keydown", code.slice(3).toLowerCase(), code);
            key(t.root, "keyup", code.slice(3).toLowerCase(), code);
            const owner = [...m.stack].reverse().find((x) => E[x].keys.includes(code)) ?? (BODY_KEYS.includes(code) ? "body" : "chain");
            expect([seq, lockBody, code, heard]).toEqual([seq, lockBody, code, [`${owner}:key`, `${owner}:keyup`]]);
          }
          while (cleanups.length) cleanups.pop()();
          delete document.pointerLockElement;
          n++;
        }
    expect(n).toBe(2 * (9 + 9 ** 2 + 9 ** 3 + 9 ** 4));
  }, 600_000);
});

describe("the pointer", () => {
  // A fake lock: granted at once (or refused), released by the browser on demand.
  // `later`: granted only when the test says (grant()), as Chrome grants after the press's own handlers ran.
  function fakeLock(t, { refuse = false, later = false } = {}) {
    let lockEl = null;
    let pending = null;
    Object.defineProperty(document, "pointerLockElement", { configurable: true, get: () => lockEl });
    const grantNow = () => {
      lockEl = t.canvas;
      document.dispatchEvent(new Event("pointerlockchange"));
    };
    t.requestLock.mockImplementation(() => {
      if (refuse) return Promise.reject(new Error("refused"));
      if (later) return new Promise((resolve) => (pending = () => (grantNow(), resolve())));
      grantNow();
      return Promise.resolve();
    });
    t.exitLock.mockImplementation(() => {
      lockEl = null;
      document.dispatchEvent(new Event("pointerlockchange"));
    });
    cleanups.push(() => delete document.pointerLockElement);
    return {
      get locked() {
        return lockEl === t.canvas;
      },
      // the browser's own Escape: unseen by the page but as a lost lock
      release() {
        lockEl = null;
        document.dispatchEvent(new Event("pointerlockchange"));
      },
      // a deferred request granted now
      grant() {
        const p = pending;
        pending = null;
        p?.();
      },
    };
  }
  const settleLock = async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  };

  it("H5: locked ⇔ body.lock ∧ ¬wanted ∧ ¬released ∧ ¬refused ∧ ¬touch, for all 2⁵ cases × each body × {mouse press, touch press, key}; after a release the next mouse press only relocks; a finger never locks", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bodies = [
      { id: "look", lock: false, base: true },
      { id: "walk", lock: true },
      { id: "seat", lock: false },
    ];
    let cases = 0;
    for (const body of bodies) {
      for (let bits = 0; bits < 32; bits++) {
        // touch is where the view starts (a coarse pointer); refused, that the browser would refuse a request
        const want = { lock: !!(bits & 1), wanted: !!(bits & 2), released: !!(bits & 4), refused: !!(bits & 8), touch: !!(bits & 16) };
        // the body's own lock decides `lock`: a case asking for lock on a body that doesn't lock is that body's
        if (want.lock !== body.lock) continue;
        for (const ev of ["press", "touch", "key"]) {
          const t = setup({ touch: want.touch });
          const lock = fakeLock(t, { refuse: want.refused });
          const press = vi.fn(() => true);
          const keyFn = vi.fn(() => true);
          if (!body.base) t.router.pushBody("b", { id: body.id, input: { click: press, key: keyFn }, lock: body.lock, keys: [{ code: "KeyW" }] });
          else t.inputs.view = { click: press, key: keyFn };
          await settleLock();
          // under touch nothing was ever asked for
          if (want.touch) expect(t.requestLock).not.toHaveBeenCalled();
          if (want.released && lock.locked) lock.release();
          if (want.wanted) {
            t.wanted = true;
            t.router.refresh();
          }
          await settleLock();
          const st = t.router.state().pointer;
          // (a release can only happen to a lock that was held: refused or under touch, there was none)
          const released = want.released && body.lock && !want.refused && !want.touch;
          const expected = body.lock && !want.wanted && !released && !want.refused && !want.touch;
          expect(lock.locked).toBe(expected);
          expect(st.locked).toBe(expected);
          expect(st.released).toBe(released);
          expect(st.touch).toBe(want.touch);
          // and the view is told
          expect(t.onState.mock.calls.at(-1)[0].pointer).toEqual(st);
          if (ev === "press") {
            // a mouse press on the world: after a release, or after a finger, it only takes the lock back
            down(t);
            up(t);
            await settleLock();
            // (refused only once asked: under touch nothing was, so this press asks, and only then is refused)
            const refused = want.refused && !want.touch;
            const relocks = (released || want.touch) && body.lock && !want.wanted && !refused;
            expect(press).toHaveBeenCalledTimes(relocks ? 0 : 1);
            expect(lock.locked).toBe(body.lock && !want.wanted && !want.refused);
            // (still released only while something wants the pointer: that press was the world's, not a relock)
            expect(t.router.state().pointer).toMatchObject({ touch: false, released: released && want.wanted });
          } else if (ev === "touch") {
            // a finger: never locked after, never only a relock, and nothing left to take back
            down(t, { pointerType: "touch" });
            up(t, { pointerType: "touch" });
            await settleLock();
            expect(press).toHaveBeenCalledTimes(1);
            expect(lock.locked).toBe(false);
            expect(t.router.state().pointer).toMatchObject({ locked: false, touch: true, released: false });
          } else {
            key(t.root, "keydown", "w");
            await settleLock();
            expect(keyFn).toHaveBeenCalledTimes(1);
            // a key never relocks, and never says what the input is
            expect(lock.locked).toBe(expected);
            expect(t.router.state().pointer.touch).toBe(want.touch);
          }
          cases++;
          while (cleanups.length) cleanups.pop()();
        }
      }
    }
    // look and seat: 16 cases each (lock false) × 3; walk: 16 × 3
    expect(cases).toBe(144);
    warn.mockRestore();
  });



  it("after a finger, a mouse press on the chip or a button (not the world) never asks for the lock: it waits, released, for a press on the world", async () => {
    const t = setup();
    const lock = fakeLock(t);
    const button = document.createElement("button");
    t.port.append(button);
    const asksBy = [];
    button.addEventListener("pointerdown", () => asksBy.push(t.requestLock.mock.calls.length));
    const click = vi.fn(() => true);
    t.router.pushBody("w", { id: "walk", input: { click }, lock: true });
    await settleLock();
    ptr("pointerdown", t.canvas, { pointerType: "touch" });
    ptr("pointerup", t.canvas, { pointerType: "touch" });
    expect(t.router.state().pointer).toMatchObject({ locked: false, touch: true });
    const clickCalls = click.mock.calls.length;
    const asked = t.requestLock.mock.calls.length;
    ptr("pointerdown", button, { pointerType: "mouse" });
    ptr("pointerup", button, { pointerType: "mouse" });
    await settleLock();
    // not by the button's own press, nor after it: its click lands on it, never on a lock target
    expect(asksBy).toEqual([asked]);
    expect(t.requestLock).toHaveBeenCalledTimes(asked);
    expect(lock.locked).toBe(false);
    expect(t.router.state().pointer).toMatchObject({ locked: false, touch: false, released: true });
    // the press on the world takes it, and is nothing else
    down(t);
    up(t);
    await settleLock();
    expect(t.requestLock).toHaveBeenCalledTimes(asked + 1);
    expect(lock.locked).toBe(true);
    expect(click).toHaveBeenCalledTimes(clickCalls);
    expect(t.router.state().pointer).toMatchObject({ locked: true, released: false });
  });

  it("the press that takes the lock after a finger is never half a press: granted after its handler (as Chrome does), no press, no click", async () => {
    const t = setup();
    const lock = fakeLock(t, { later: true });
    const seen = [];
    const input = { press: vi.fn((ev) => (seen.push(["press", ev.locked]), true)), click: vi.fn((ev) => (seen.push(["click", ev.locked]), true)) };
    t.router.pushBody("w", { id: "walk", input, lock: true });
    await settleLock();
    lock.grant();
    await settleLock();
    expect(lock.locked).toBe(true);
    // a finger lets it go
    ptr("pointerdown", t.canvas, { pointerType: "touch" });
    ptr("pointerup", t.canvas, { pointerType: "touch" });
    await settleLock();
    expect(lock.locked).toBe(false);
    seen.length = 0;
    // a mouse on the world: the lock is asked for, granted only after the press's handler
    down(t);
    expect(t.requestLock).toHaveBeenCalledTimes(2);
    lock.grant();
    up(t);
    await settleLock();
    expect(lock.locked).toBe(true);
    expect(seen).toEqual([]);
    // the next press is whole, and locked throughout
    down(t);
    up(t);
    expect(seen).toEqual([
      ["press", true],
      ["click", true],
    ]);
  });

  it("a press on an edge (outside the port, inside the view: the clock's bar, the toolbar) says what the input is too", async () => {
    const t = setup();
    const lock = fakeLock(t);
    const edge = document.createElement("div");
    const pause = document.createElement("button");
    edge.append(pause);
    t.root.append(edge);
    t.router.pushBody("w", { id: "walk", input: {}, lock: true });
    await settleLock();
    expect(lock.locked).toBe(true);
    // a finger on the bar lets the lock go
    ptr("pointerdown", pause, { pointerType: "touch" });
    ptr("pointerup", pause, { pointerType: "touch" });
    await settleLock();
    expect(t.exitLock).toHaveBeenCalledTimes(1);
    expect(t.router.state().pointer).toMatchObject({ locked: false, touch: true });
    // a mouse on the bar ends touch, and leaves the lock to the world
    ptr("pointerdown", pause, { pointerType: "mouse" });
    ptr("pointerup", pause, { pointerType: "mouse" });
    await settleLock();
    expect(t.requestLock).toHaveBeenCalledTimes(1);
    expect(t.router.state().pointer).toMatchObject({ locked: false, touch: false, released: true });
    // and a press outside the view says nothing
    const outside = document.createElement("button");
    document.body.append(outside);
    cleanups.push(() => outside.remove());
    ptr("pointerdown", outside, { pointerType: "touch" });
    expect(t.router.state().pointer.touch).toBe(false);
  });

  it("locked, a finger on something over the canvas (not the canvas) lets the lock go, and the press still reaches it", async () => {
    const t = setup();
    const lock = fakeLock(t);
    const button = document.createElement("button");
    t.port.append(button);
    const heard = vi.fn((e) => expect(e.defaultPrevented).toBe(false));
    button.addEventListener("pointerdown", heard);
    t.router.pushBody("w", { id: "walk", input: {}, lock: true });
    await settleLock();
    expect(lock.locked).toBe(true);
    ptr("pointerdown", button, { pointerType: "touch" });
    expect(t.exitLock).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    ptr("pointerup", button, { pointerType: "touch" });
    await settleLock();
    expect(lock.locked).toBe(false);
    // the page let go, not the browser (no Escape was pressed): nothing released under touch
    expect(t.router.state().pointer).toMatchObject({ locked: false, released: false, touch: true });
    // a mouse on the button after it: no lock from the button's press; the world's next press takes it
    ptr("pointerdown", button, { pointerType: "mouse" });
    await settleLock();
    expect(lock.locked).toBe(false);
    expect(t.router.state().pointer).toMatchObject({ touch: false, released: true });
    down(t);
    await settleLock();
    expect(lock.locked).toBe(true);
  });

  it("wanted frees the pointer and its going back relocks; a body change starts afresh", async () => {
    const t = setup();
    const lock = fakeLock(t);
    t.router.pushBody("w", { id: "walk", input: {}, lock: true });
    await settleLock();
    expect(lock.locked).toBe(true);
    t.wanted = true;
    t.router.refresh();
    await settleLock();
    expect(lock.locked).toBe(false);
    expect(t.router.state().pointer.released).toBe(false); // the page let go, not the browser
    t.wanted = false;
    t.router.refresh();
    await settleLock();
    expect(lock.locked).toBe(true);
    lock.release();
    expect(t.router.state().pointer.released).toBe(true);
    t.router.pushBody("s", { id: "station", input: {}, lock: true });
    await settleLock();
    expect(lock.locked).toBe(true);
    expect(t.router.state().pointer.released).toBe(false);
  });
});

describe("a release that never came", () => {
  it("a mouse moving with no button down cancels the gesture: put back, never committed", () => {
    const t = setup();
    const session = { move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
    t.inputs.hand = { press: () => session };
    down(t, { x: 10 });
    move(t, { x: 30, buttons: 1 });
    // released outside the window: the next move comes with nothing down
    move(t, { x: 60, buttons: 0 });
    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(session.end).not.toHaveBeenCalled();
    expect(session.move).toHaveBeenCalledTimes(1);
    move(t, { x: 70, buttons: 0 });
    expect(session.move).toHaveBeenCalledTimes(1);
  });
  it("leaving the window (blur) or a lost capture cancels it, never commits", () => {
    const t = setup();
    const session = { move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
    t.inputs.hand = { press: () => session };
    down(t, { x: 10 });
    move(t, { x: 30, buttons: 1 });
    window.dispatchEvent(new Event("blur"));
    expect(session.cancel).toHaveBeenCalledTimes(1);
    up(t, { x: 30 });
    expect(session.end).not.toHaveBeenCalled();
    down(t, { x: 10, id: 2 });
    ptr("lostpointercapture", t.canvas, { id: 2 });
    expect(session.cancel).toHaveBeenCalledTimes(2);
    expect(session.end).not.toHaveBeenCalled();
  });
});

describe("stopping an owner", () => {
  it("cancels its session, pops its body (and any over it), puts down its tool, lets go of its keys and popovers", () => {
    const t = setup();
    const session = { move: vi.fn(), end: vi.fn(), cancel: vi.fn() };
    t.inputs.hand = { press: () => session, keyup: vi.fn() };
    const body = { key: () => true, keyup: vi.fn(), left: vi.fn() };
    const over = { left: vi.fn() };
    const tool = { put: vi.fn() };
    const close = vi.fn();
    down(t);
    t.router.pushBody("hand", { id: "walk", input: body, keys: [{ code: "KeyQ" }] });
    t.router.pushBody("s", { id: "seat", input: over });
    t.router.hold("hand", { command: "gun", input: tool });
    t.router.popover("hand", close);
    t.router.leave(); // the seat goes; the walk is on top again
    expect(over.left).toHaveBeenCalledTimes(1);
    key(t.root, "keydown", "q");
    t.router.stopOwner("hand");
    expect(session.cancel).toHaveBeenCalledTimes(1);
    expect(body.keyup).toHaveBeenCalledTimes(1);
    expect(body.left).toHaveBeenCalledTimes(1);
    expect(tool.put).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
    expect(t.router.body().id).toBe("look");
    expect(t.router.held()).toEqual([]);
    expect(t.router.state().escape).toBe(null);
    up(t, { x: 40 });
    expect(session.end).not.toHaveBeenCalled();
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
  // Off the canvas onto something over it that keeps the look (the use
  // prompt): every way the pointer can go from there, from one hover.
  it("a look is kept while the pointer is on something that keeps it (the use prompt), and goes as it goes anywhere else", async () => {
    const WAYS = [
      ["back to the canvas", (t) => move(t, { x: 40, buttons: 0 }), "hovered again"],
      ["over another overlay", (t) => ptr("pointermove", t.other, { x: 50, buttons: 0 }), "cleared"],
      ["out of the port", (t) => t.port.dispatchEvent(new PointerEvent("pointerleave", { relatedTarget: document.body })), "cleared"],
      ["about on the prompt", (t) => ptr("pointermove", t.button, { x: 22, buttons: 0 }), "kept"],
    ];
    for (const [way, go, want] of WAYS) {
      const t = setup();
      const prompt = document.createElement("div");
      prompt.dataset.keepsLook = "";
      t.button = document.createElement("button");
      prompt.append(t.button);
      t.other = document.createElement("div");
      t.port.append(prompt, t.other);
      move(t, { x: 20, buttons: 0 });
      await frame();
      expect(t.onHover).toHaveBeenCalledTimes(1);
      // onto the prompt: kept (no clear)
      t.canvas.dispatchEvent(new PointerEvent("pointerleave", { relatedTarget: t.button }));
      ptr("pointermove", t.button, { x: 21, buttons: 0 });
      expect([way, t.onHover.mock.calls.length]).toEqual([way, 1]);
      go(t);
      await frame();
      const last = t.onHover.mock.calls.at(-1)[0];
      const got = t.onHover.mock.calls.length === 1 ? "kept" : last === null ? "cleared" : "hovered again";
      expect([way, got]).toEqual([way, want]);
    }
    // onto anything else that's over the canvas: cleared at once, as ever
    const t = setup();
    const other = document.createElement("div");
    t.port.append(other);
    move(t, { x: 20, buttons: 0 });
    await frame();
    t.canvas.dispatchEvent(new PointerEvent("pointerleave", { relatedTarget: other }));
    expect(t.onHover).toHaveBeenLastCalledWith(null);
  });
  // A finger hovers nowhere: it leaves as it lifts. Every way a press can
  // end, by mouse and by finger, then the leave that follows it: a finger's
  // tap keeps the look it pressed (its prompt's buttons can be tapped); a
  // drag or a cancel keeps none; a mouse's leave is a mouse's.
  // Each from a fresh view and after a finger's tap (whose look is kept): the press after it starts afresh.
  it("a finger's tap keeps the look it pressed when it lifts; a drag, a cancel or a mouse's leave doesn't", async () => {
    for (const before of ["fresh", "after a tap"])
    for (const pointerType of ["mouse", "touch"])
      for (const [how, end, want] of [
        ["tapped", (t) => up(t, { pointerType, x: 20 }), { mouse: "cleared", touch: "kept" }],
        ["dragged", (t) => (move(t, { pointerType, x: 60, buttons: 1 }), up(t, { pointerType, x: 60 })), { mouse: "cleared", touch: "cleared" }],
        ["cancelled", (t) => ptr("pointercancel", t.canvas, { pointerType, x: 20 }), { mouse: "cleared", touch: "cleared" }],
      ]) {
        const t = setup();
        if (before === "after a tap") {
          down(t, { pointerType: "touch", x: 40 });
          up(t, { pointerType: "touch", x: 40 });
          t.canvas.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "touch" }));
        }
        down(t, { pointerType, x: 20 });
        end(t);
        t.onHover.mockClear();
        // the leave after a lift (a finger's always; a mouse's as it goes)
        t.canvas.dispatchEvent(new PointerEvent("pointerleave", { pointerType }));
        t.port.dispatchEvent(new PointerEvent("pointerleave", { pointerType }));
        await frame();
        const got = t.onHover.mock.calls.length === 0 ? "kept" : t.onHover.mock.calls.at(-1)[0] === null ? "cleared" : "hovered";
        expect([before, pointerType, how, got]).toEqual([before, pointerType, how, want[pointerType]]);
      }
  });
  it("a tapped look stays while other fingers go elsewhere (the touch pad, the prompt), and goes with the next press on the world", async () => {
    const t = setup();
    const pad = document.createElement("button");
    t.port.append(pad);
    down(t, { pointerType: "touch", x: 20 });
    up(t, { pointerType: "touch", x: 20 });
    t.canvas.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "touch" }));
    t.onHover.mockClear();
    // another finger on the pad: down, moving, up, leaving
    ptr("pointerdown", pad, { pointerType: "touch", id: 2 });
    ptr("pointermove", pad, { pointerType: "touch", id: 2, x: 30 });
    ptr("pointerup", pad, { pointerType: "touch", id: 2 });
    t.port.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "touch" }));
    await frame();
    expect(t.onHover).not.toHaveBeenCalled();
    // the next press on the world is the look now: what it pressed, then (dragged) none once it lifts
    down(t, { pointerType: "touch", x: 70, id: 3 });
    expect(t.onHover).toHaveBeenCalledTimes(1);
    expect(t.onHover.mock.calls[0][0].x).toBe(70);
    move(t, { pointerType: "touch", x: 120, id: 3, buttons: 1 });
    up(t, { pointerType: "touch", x: 120, id: 3 });
    t.canvas.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "touch" }));
    expect(t.onHover).toHaveBeenLastCalledWith(null);
  });
  it("prefers the held tool's cursor", async () => {
    const t = setup();
    t.inputs.a = { cursor: () => "pointer" };
    t.router.hold("measure", { command: "measure", input: { cursor: () => "crosshair" } });
    move(t, { x: 20, buttons: 0 });
    await frame();
    expect(t.onCursor).toHaveBeenLastCalledWith("crosshair");
  });
});
