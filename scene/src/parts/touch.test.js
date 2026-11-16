import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { plugins } from "../index.js";
import touch, { layerName } from "./touch.js";

const meta = (id) => {
  const { load: _load, type: _type, ...m } = plugins.find((p) => p.id === id);
  return m;
};
const TOUCH = { meta: meta("scene.touch"), module: touch };

/** walk/src/body.js WALK_KEYS, and an unlabelled Q: a walk-like body that also declares a key with no label */
const WALKISH_KEYS = [
  ["KeyW", "Forward"], ["KeyA", "Left"], ["KeyS", "Back"], ["KeyD", "Right"],
  ["ArrowUp", "Forward"], ["ArrowDown", "Back"], ["ArrowLeft", "Left"], ["ArrowRight", "Right"],
  ["ShiftLeft", "Run"], ["ShiftRight", "Run"], ["Space", "Jump"],
].map(([code, label]) => ({ code, label })).concat([{ code: "KeyQ" }]);

let s = null;
let walker = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

// A game that offers a walk-like body (it locks the pointer) and a seat (no keys).
const GAME = () => ({
  meta: { id: "t.game" },
  module: {
    create: () => ({
      bodies: [
        { id: "walkish", label: "Walkish", lock: true, keys: WALKISH_KEYS, enter: () => ({ input: walker, eye: () => ({ position: [0, 1.6, 4], direction: [0, 0, -1] }), leave() {} }) },
        { id: "seat", label: "Sit", keys: [], enter: () => ({ input: {}, eye: () => ({ position: [0, 1, 2], direction: [0, 0, -1] }), leave() {} }) },
      ],
    }),
  },
});

async function mount() {
  walker = { key: vi.fn(() => true), keyup: vi.fn(() => true) };
  s = await mountStage({ extensions: [GAME(), TOUCH], doc: { objects: { a: object() } } });
  await settle();
}
const api = () => s.api("t.game");
const enter = async (id) => {
  expect(api().body.enter(id, null)).toBe(true);
  await settle();
};
/** a press (and release) somewhere in the view, by finger or mouse: what says what the input is */
const input = async (pointerType, target = s.canvas) => {
  target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 9, pointerType, button: 0, buttons: 1 }));
  target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 9, pointerType, button: 0, buttons: 0 }));
  await settle();
};
const layer = () => s.root.querySelector(".touch-layer");
const pad = () => layer().querySelector(".touch-pad");
const buttons = () => layer().querySelector(".touch-buttons");
/** what shows: the pad's places, and each group's name and buttons; null when nothing does */
function shown() {
  if (pad().hidden && buttons().hidden) return null;
  return {
    pad: pad().hidden ? [] : [...pad().children].map((b) => `${b.dataset.slot}=${b.title}`),
    buttons: buttons().hidden ? [] : [...buttons().children].map((g) => [g.querySelector(".touch-layer-name").textContent, ...[...g.querySelectorAll(".touch-key")].map((b) => b.textContent)]),
  };
}
const control = (label) => [...layer().querySelectorAll(".touch-key")].find((b) => (b.title || b.textContent) === label);
const finger = (type, label, pointerId) => {
  const e = new PointerEvent(type, { bubbles: true, cancelable: true, pointerId, pointerType: "touch", button: 0, buttons: type === "pointerdown" ? 1 : 0 });
  control(label).dispatchEvent(e);
  return e;
};
const keys = (fn) => fn.mock.calls.map(([ev]) => `${ev.code}/${ev.key}`);

describe("scene.touch", () => {
  it("is hidden for a mouse; shows after a finger anywhere in the view, and hides after a mouse", async () => {
    await mount();
    await enter("walkish");
    expect(s.local.get().pointer.touch).toBe(false);
    expect(shown()).toBe(null);
    await input("touch");
    expect(shown()).not.toBe(null);
    await input("mouse");
    expect(shown()).toBe(null);
    // a finger on something over the canvas (the body chip) counts too
    await input("touch", s.root.querySelector(".stage-overlay"));
    expect(shown()).not.toBe(null);
  });

  it("shows nothing in Look, Edit or a seat: they declare no keys", async () => {
    await mount();
    await input("touch");
    for (const body of ["look", "edit", "seat"]) {
      if (s.local.get().body.id !== body) await enter(body);
      expect([body, s.local.get().body.id, shown()]).toEqual([body, body, null]);
    }
  });

  it("a walk-like body: the arrows' four places on the pad, its other keys as buttons under its name, in declared order", async () => {
    await mount();
    await enter("walkish");
    await input("touch");
    expect(shown()).toEqual({
      pad: ["up=Forward", "left=Left", "down=Back", "right=Right"],
      buttons: [["Walkish", "Run", "Jump", "Q"]],
    });
  });

  it("a control is a held key: down with the finger (the key a keyboard sends), up once with it, or with its cancel", async () => {
    await mount();
    await enter("walkish");
    await input("touch");
    for (const end of ["pointerup", "pointercancel"]) {
      walker.key.mockClear();
      walker.keyup.mockClear();
      const e = finger("pointerdown", "Forward", 1);
      // focus stays where it is: the key map cancels held verbs when focus leaves the view
      expect(e.defaultPrevented).toBe(true);
      expect(keys(walker.key)).toEqual(["KeyW/w"]);
      expect(control("Forward").hasAttribute("data-held")).toBe(true);
      expect(walker.keyup).not.toHaveBeenCalled();
      finger(end, "Forward", 1);
      finger("lostpointercapture", "Forward", 1); // the browser's, after either
      expect([end, keys(walker.keyup)]).toEqual([end, ["KeyW/w"]]);
      expect(control("Forward").hasAttribute("data-held")).toBe(false);
    }
    // a key with no label presses its own code; Run, its first; Jump, Space
    walker.key.mockClear();
    for (const label of ["Q", "Run", "Jump"]) {
      finger("pointerdown", label, 1);
      finger("pointerup", label, 1);
    }
    expect(keys(walker.key)).toEqual(["KeyQ/q", "ShiftLeft/Shift", "Space/ "]);
  });

  it("fingers are each their own: Forward and Run together, let go in either order, each its own keyup", async () => {
    await mount();
    await enter("walkish");
    await input("touch");
    for (const order of [[1, 2], [2, 1]]) {
      walker.key.mockClear();
      walker.keyup.mockClear();
      finger("pointerdown", "Forward", 1);
      finger("pointerdown", "Run", 2);
      expect(keys(walker.key)).toEqual(["KeyW/w", "ShiftLeft/Shift"]);
      const label = { 1: "Forward", 2: "Run" };
      finger("pointerup", label[order[0]], order[0]);
      expect(keys(walker.keyup)).toEqual([order[0] === 1 ? "KeyW/w" : "ShiftLeft/Shift"]);
      finger("pointerup", label[order[1]], order[1]);
      expect(keys(walker.keyup).sort()).toEqual(["KeyW/w", "ShiftLeft/Shift"]);
    }
  });

  it("two fingers on one control: down with the first, up with the last", async () => {
    await mount();
    await enter("walkish");
    await input("touch");
    finger("pointerdown", "Forward", 1);
    finger("pointerdown", "Forward", 2);
    expect(keys(walker.key)).toEqual(["KeyW/w"]);
    finger("pointerup", "Forward", 1);
    expect(walker.keyup).not.toHaveBeenCalled();
    finger("pointerup", "Forward", 2);
    expect(keys(walker.keyup)).toEqual(["KeyW/w"]);
  });

  it("leaving the body mid-press: the body hears exactly one keyup, and the finger's coming up is nothing", async () => {
    await mount();
    await enter("walkish");
    await input("touch");
    finger("pointerdown", "Forward", 1);
    expect(api().body.leave()).toBe(true);
    await settle();
    expect(keys(walker.keyup)).toEqual(["KeyW/w"]);
    expect(shown()).toBe(null);
    // the control went with the body: its finger was let go then, and the router held nothing more for it
    s.root.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyW", key: "w", bubbles: true }));
    expect(walker.keyup).toHaveBeenCalledTimes(1);
  });

  it("a pad that hides (a mouse) lets go of every key it held", async () => {
    await mount();
    await enter("walkish");
    await input("touch");
    finger("pointerdown", "Forward", 1);
    finger("pointerdown", "Run", 2);
    await input("mouse");
    expect(shown()).toBe(null);
    expect(keys(walker.keyup).sort()).toEqual(["KeyW/w", "ShiftLeft/Shift"]);
  });

  it("the held tool's keys come first: its control presses it, not the body; the body's control for that key goes, letting go", async () => {
    await mount();
    await enter("walkish");
    await input("touch");
    finger("pointerdown", "Q", 1);
    finger("pointerdown", "Forward", 2);
    const forward = control("Forward");
    const tool = { key: vi.fn(() => true), keyup: vi.fn(() => true) };
    const putDown = api().hold({ name: "Wrench", keys: [{ code: "KeyQ", label: "Turn" }] }, tool);
    await settle();
    expect(shown()).toEqual({
      pad: ["up=Forward", "left=Left", "down=Back", "right=Right"],
      buttons: [["Wrench", "Turn"], ["Walkish", "Run", "Jump"]],
    });
    // the body's Q went while held: let go, once; Forward is the same control, still held
    expect(keys(walker.keyup)).toEqual(["KeyQ/q"]);
    expect(control("Forward")).toBe(forward);
    expect(forward.hasAttribute("data-held")).toBe(true);
    finger("pointerdown", "Turn", 3);
    finger("pointerup", "Turn", 3);
    expect([keys(tool.key), keys(tool.keyup)]).toEqual([["KeyQ/q"], ["KeyQ/q"]]);
    expect(keys(walker.key)).toEqual(["KeyQ/q", "KeyW/w"]);
    finger("pointerup", "Forward", 2);
    expect(keys(walker.keyup)).toEqual(["KeyQ/q", "KeyW/w"]);
    putDown();
    await settle();
    expect(shown().buttons).toEqual([["Walkish", "Run", "Jump", "Q"]]);
  });

  it("names each layer's buttons: the body's label, the held tool's name, a carry", () => {
    const view = { body: { id: "walk", label: "Walk" }, held: { name: "Gun" } };
    expect(["body", "tool", "gesture"].map((f) => layerName(f, view))).toEqual(["Walk", "Gun", "Carrying"]);
    expect(["body", "tool"].map((f) => layerName(f, {}))).toEqual(["Body", "Held"]);
  });
});
