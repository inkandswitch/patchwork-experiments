// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { plugins } from "../index.js";
import touch, { layerName } from "./touch.js";
import body from "./body.js";

const meta = (id) => {
  const { load: _load, type: _type, ...m } = plugins.find((p) => p.id === id);
  return m;
};
const TOUCH = { meta: meta("scene.touch"), module: touch };
const BODY = { meta: meta("scene.body"), module: body };

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

async function mount(extra = []) {
  walker = { key: vi.fn(() => true), keyup: vi.fn(() => true) };
  s = await mountStage({ editor: true,  extensions: [GAME(), TOUCH, ...extra], doc: { objects: { a: object() } } });
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

  // (every order of fingers, cancels and lost captures, and the default-prevented press: hold-key.test.js)
  it("a control is a held key: down with the finger (the key a keyboard sends), lit while held, up once with it", async () => {
    await mount();
    await enter("walkish");
    await input("touch");
    finger("pointerdown", "Forward", 1);
    expect(keys(walker.key)).toEqual(["KeyW/w"]);
    expect(control("Forward").hasAttribute("data-held")).toBe(true);
    expect(walker.keyup).not.toHaveBeenCalled();
    finger("pointerup", "Forward", 1);
    expect(keys(walker.keyup)).toEqual(["KeyW/w"]);
    expect(control("Forward").hasAttribute("data-held")).toBe(false);
    // a key with no label presses its own code; Run, its first; Jump, Space
    walker.key.mockClear();
    for (const label of ["Q", "Run", "Jump"]) {
      finger("pointerdown", label, 1);
      finger("pointerup", label, 1);
    }
    expect(keys(walker.key)).toEqual(["KeyQ/q", "ShiftLeft/Shift", "Space/ "]);
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

  for (const how of ["blur", "hidden"]) {
    it(`the window losing focus (${how}) lets every finger go, as the router lets go of every key: unlit, and a finger down again presses again`, async () => {
      await mount();
      await enter("walkish");
      await input("touch");
      finger("pointerdown", "Forward", 1);
      if (how === "blur") window.dispatchEvent(new Event("blur"));
      else {
        Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
        document.dispatchEvent(new Event("visibilitychange"));
        delete document.visibilityState;
      }
      expect(keys(walker.keyup)).toEqual(["KeyW/w"]);
      expect(control("Forward").hasAttribute("data-held")).toBe(false);
      // the first finger is still on it; a second presses: a key held again
      finger("pointerdown", "Forward", 2);
      expect(keys(walker.key)).toEqual(["KeyW/w", "KeyW/w"]);
      expect(control("Forward").hasAttribute("data-held")).toBe(true);
      finger("pointerup", "Forward", 1);
      finger("pointerup", "Forward", 2);
      expect(keys(walker.keyup)).toEqual(["KeyW/w", "KeyW/w"]);
    });
  }

  it("a control is its layer's: the body left and entered again at once (the same id) is a new body, its Forward a new control, unlit; the old finger presses nothing", async () => {
    await mount();
    await enter("walkish");
    await input("touch");
    finger("pointerdown", "Forward", 1);
    const old = control("Forward");
    expect(api().body.leave()).toBe(true);
    expect(api().body.enter("walkish", null)).toBe(true);
    await settle();
    expect(s.local.get().body.id).toBe("walkish");
    // the router let the old body's W go; the control went with it
    expect(keys(walker.keyup)).toEqual(["KeyW/w"]);
    expect(old.isConnected).toBe(false);
    expect(control("Forward")).not.toBe(old);
    expect(control("Forward").hasAttribute("data-held")).toBe(false);
    old.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, pointerType: "touch" }));
    expect([walker.key.mock.calls.length, walker.keyup.mock.calls.length]).toEqual([1, 1]);
    // down again: the new body's
    finger("pointerdown", "Forward", 1);
    finger("pointerup", "Forward", 1);
    expect([keys(walker.key), keys(walker.keyup)]).toEqual([["KeyW/w", "KeyW/w"], ["KeyW/w", "KeyW/w"]]);
  });

  it("the pad stopping (uninstalled) lets go of what it held", async () => {
    await mount();
    await enter("walkish");
    await input("touch");
    finger("pointerdown", "Forward", 1);
    finger("pointerdown", "Run", 2);
    await s.uninstall("scene.touch");
    expect(keys(walker.keyup).sort()).toEqual(["KeyW/w", "ShiftLeft/Shift"]);
  });

  it("a long press on the pad is a held key, not the browser's menu", async () => {
    await mount();
    await enter("walkish");
    await input("touch");
    const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    control("Forward").dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it("the Esc hint is the Escape key with no keyboard: it says what it does, and a finger on it pops that rung", async () => {
    await mount([BODY]);
    const hint = () => s.root.querySelector(".body-escape");
    const tool = { key: vi.fn(() => true) };
    api().hold({ name: "Wrench", keys: [] }, tool);
    await settle();
    expect([hint().textContent, hint().hasAttribute("data-key")]).toEqual(["Esc: put down Wrench", false]);
    await input("touch");
    expect([hint().textContent, hint().dataset.key, hint().getAttribute("role")]).toEqual(["Put down Wrench", "Escape", "button"]);
    const e = new PointerEvent("pointerdown", { bubbles: true, cancelable: true, pointerId: 3, pointerType: "touch" });
    hint().dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(s.local.get().held).toEqual([]);
    hint().dispatchEvent(new PointerEvent("pointerup", { bubbles: true, cancelable: true, pointerId: 3, pointerType: "touch" }));
    await settle();
    // the editor under it is the next rung
    expect([hint().textContent, hint().dataset.key]).toEqual(["Put down Edit", "Escape"]);
    s.edit(false);
    await settle();
    expect([hint().hidden, hint().hasAttribute("data-key")]).toEqual([true, false]);
  });

  it("names each layer's buttons: the body's label, each hand's name; a gesture's, none (the stage knows no gesture's name)", () => {
    const view = { body: { id: "walk", label: "Walk", keys: ["KeyW"] }, hands: [{ name: "Gun", keys: ["KeyR"] }, { name: "Pad", keys: ["KeyZ"] }], gesture: { owner: "scene.carry", keys: ["KeyQ"] } };
    const cases = [["body", "KeyW"], ["hand", "KeyR"], ["hand", "KeyZ"], ["gesture", "KeyQ"]];
    expect(cases.map(([from, code]) => layerName({ from, code }, view))).toEqual(["Walk", "Gun", "Pad", null]);
    expect(["body", "hand", "gesture"].map((from) => layerName({ from, code: "KeyX" }, {}))).toEqual(["Body", "Held", null]);
  });
});
