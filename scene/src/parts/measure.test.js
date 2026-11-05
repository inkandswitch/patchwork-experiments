import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { PLAY, mountStage, object, until, settle } from "../test/stage-harness.js";
import measure, { anchorFor, anchorWorld, HINT_FIRST, HINT_SECOND } from "./measure.js";
import dimensions, { dimensionRef } from "./dimensions.js";

const MEASURE = { meta: { id: "scene.measure", activities: ["edit"] }, module: measure };
const DIMENSIONS = { meta: { id: "scene.dimensions" }, module: dimensions };

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

async function mount({ objects = { a: object({ name: "A", transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: 1 } }) }, extensions = [], doc = {} } = {}) {
  s = await mountStage({ extensions: [MEASURE, DIMENSIONS, ...extensions], doc: { objects, order: Object.keys(objects), ...doc } });
  return s;
}

const inst = () => s.instance("scene.measure");
const run = (command = "measure", target = null) => s.api("scene.measure").run({ ext: "scene.measure", command, target });
const state = (command = "measure", target = null) => inst().commands.find((c) => c.id === command).state(target, { scene: s.api("scene.measure").scene(), local: s.local.get() });
const hint = () => s.port.querySelector('.stage-overlay[data-owner="scene.measure"] .measure-hint');
const preview = () => s.port.querySelector(".labels .measure-label");
const layer = () => [...(s.debug.viewport.layers.get("scene.measure") ?? [])].flatMap((g) => g.children);
/** What the viewport's pick says is under the pointer (there is no WebGL here); records the options it was asked with. */
const picks = [];
const pickAt = (hit) => {
  picks.length = 0;
  s.debug.viewport.pick = (x, y, opts) => (picks.push({ x, y, ...opts }), hit);
};

describe("anchors (pure)", () => {
  it("anchors a hit on an object to its displayed frame, and a ground hit to the world", () => {
    const objects = { a: {} };
    const at = (id) => (id === "a" ? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 2, 0, 0, 1] : null); // translate x 2
    expect(anchorFor({ id: "a", point: [3, 1, 0] }, objects, at)).toEqual({ objectId: "a", local: [1, 1, 0], world: [3, 1, 0] });
    expect(anchorFor({ id: null, point: [3, 1, 0] }, objects, at)).toEqual({ objectId: null, local: null, world: [3, 1, 0] });
    expect(anchorFor({ id: "gone", point: [3, 1, 0] }, objects, at)).toEqual({ objectId: null, local: null, world: [3, 1, 0] });
    expect(anchorWorld({ objectId: "a", local: [1, 1, 0], world: [9, 9, 9] }, objects, at)).toEqual([3, 1, 0]);
    expect(anchorWorld({ objectId: "gone", local: [1, 1, 0], world: [9, 9, 9] }, objects, at)).toEqual([9, 9, 9]);
  });
});

describe("scene.measure", () => {
  it("Measure is a toggle for the scene that arms and disarms, with a crosshair and a hint", async () => {
    await mount();
    expect(state()).toMatchObject({ checked: false });
    expect(state("measure", "a")).toBeNull(); // the scene's, not an object's
    expect(hint().hidden).toBe(true);
    expect(run()).toBe(true);
    await settle();
    expect(state()).toMatchObject({ checked: true });
    expect(s.local.get().armed).toBe("scene.measure");
    expect(s.canvas.style.cursor).toBe("crosshair");
    expect(hint().hidden).toBe(false);
    expect(hint().textContent).toBe(HINT_FIRST);
    run();
    await settle();
    expect(state()).toMatchObject({ checked: false });
    expect(s.local.get().armed).toBeNull();
    expect(s.canvas.style.cursor).toBe("");
    expect(hint().hidden).toBe(true);
  });

  it("two clicks write a dimension (anchored to what was hit) and select it; it stays armed", async () => {
    await mount();
    run();
    pickAt({ id: "a", point: [1.5, 0, 0], normal: [0, 1, 0], distance: 1, snapped: true });
    s.click(20, 30);
    expect(picks.find((p) => p.ground)).toMatchObject({ x: 20, y: 30, ground: true, snapPx: 10 });
    expect(inst().state.a).toEqual({ objectId: "a", local: [0.5, 0, 0], world: [1.5, 0, 0] });
    expect(hint().textContent).toBe(HINT_SECOND);
    expect(Object.keys(s.doc().dimensions)).toEqual([]);
    pickAt({ id: null, point: [1.5, 0, 2], normal: [0, 1, 0], distance: 1, snapped: false, ground: true });
    s.click(40, 50);
    const dims = s.doc().dimensions;
    const [id] = Object.keys(dims);
    expect(dims[id]).toEqual({ a: { objectId: "a", local: [0.5, 0, 0], world: [1.5, 0, 0] }, b: { objectId: null, local: null, world: [1.5, 0, 2] }, label: null });
    expect(s.local.get().selected).toBe(dimensionRef(id));
    expect(state()).toMatchObject({ checked: true });
    expect(hint().textContent).toBe(HINT_FIRST);
  });

  it("a click on nothing places nothing, but is still the measure's", async () => {
    const clicks = [];
    const other = { meta: { id: "t.other" }, module: { create: () => ({ input: { click: () => (clicks.push(1), true) } }) } };
    await mount({ extensions: [other] });
    s.click();
    expect(clicks).toEqual([1]); // not armed: it isn't the measure's
    run();
    pickAt(null);
    s.click();
    expect(clicks).toEqual([1]);
    expect(inst().state.a).toBeNull();
  });

  it("Escape clears the first point, then stops measuring", async () => {
    await mount();
    run();
    pickAt({ id: null, point: [0, 0, 0], snapped: false, ground: true });
    s.click();
    expect(inst().state.a).not.toBeNull();
    s.key("Escape", { code: "Escape" });
    expect(inst().state.a).toBeNull();
    expect(state()).toMatchObject({ checked: true });
    s.key("Escape", { code: "Escape" });
    expect(state()).toMatchObject({ checked: false });
    await settle();
    expect(s.local.get().armed).toBeNull();
  });

  it("other keys pass through while armed", async () => {
    const keys = [];
    const keymap = { meta: { id: "t.keys" }, module: { create: () => ({ input: { key: (ev) => (keys.push(ev.key), true) } }) } };
    await mount({ extensions: [keymap] });
    run();
    s.key("m");
    s.key("Escape", { code: "Escape" });
    expect(keys).toEqual(["m"]);
  });

  it("hovering previews the length from the first point, in the viewer's units, and glows when snapped", async () => {
    await mount();
    s.api("scene.measure").setPref("units", "mm");
    run();
    pickAt({ id: null, point: [0, 0, 0], snapped: false, ground: true });
    s.click();
    pickAt({ id: "a", point: [0.3, 0.4, 0], snapped: true });
    s.pointer("pointermove", 15, 15, { buttons: 0 });
    await until(() => preview());
    expect(picks.findLast((p) => p.ground)).toMatchObject({ x: 15, y: 15, ground: true, snapPx: 10 });
    expect(preview().textContent).toBe("500 mm");
    expect(preview().hasAttribute("data-preview")).toBe(true);
    const kinds = layer().map((o) => o.type);
    expect(kinds).toEqual(["LineSegments", "Points", "Points"]); // line, markers, snap glow
    // unsnapped: no glow
    pickAt({ id: null, point: [0, 0, 1], snapped: false, ground: true });
    s.pointer("pointermove", 16, 16, { buttons: 0 });
    await until(() => preview()?.textContent === "1000 mm");
    expect(layer().map((o) => o.type)).toEqual(["LineSegments", "Points"]);
    // leaving the view drops the hover point
    s.port.dispatchEvent(new PointerEvent("pointerleave"));
    expect(preview()).toBeNull();
    // disarming clears everything
    run();
    expect(layer()).toEqual([]);
  });

  it("the first point follows its object", async () => {
    await mount();
    run();
    pickAt({ id: "a", point: [1, 0, 0], snapped: true });
    s.click();
    pickAt({ id: null, point: [1, 0, 1], snapped: false, ground: true });
    s.pointer("pointermove", 15, 15, { buttons: 0 });
    await until(() => preview()?.textContent === "1 m");
    s.change((d) => {
      d.objects.a.transform.position = [1, 0, -1];
    });
    await until(() => preview()?.textContent === "2 m");
  });

  it("stopping the extension disarms it", async () => {
    await mount({ extensions: [PLAY] });
    run();
    await settle();
    expect(s.local.get().armed).toBe("scene.measure");
    await s.activity("play");
    expect(s.local.get().armed).toBeNull();
    expect(s.canvas.style.cursor).toBe("");
  });
});
