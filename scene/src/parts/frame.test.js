import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import { fakeCamera } from "../test/fake-camera.js";
import frame, { frameTarget } from "./frame.js";

const group = (extra = {}) => ({ ...object({ name: "G", providerId: null }), kind: "group", ...extra });

/**
 * Mount scene.frame with a stubbed camera, scene box and content (the stage's
 * own need WebGL). `world.box` is the scene's box; `world.loaded` the ids whose content is in.
 */
async function mount(doc = {}) {
  const s = await mountStage({ extensions: [{ meta: { id: "scene.frame" }, module: frame }], doc });
  const api = s.api("scene.frame");
  const world = { box: null, loaded: new Set(), boxes: {} };
  const camera = fakeCamera();
  api.camera = camera.rig;
  api.sceneBox = () => world.box;
  api.box = (id) => world.boxes[id] ?? null;
  api.content = (id) => ({ loaded: world.loaded.has(id), box: null, extras: null, stats: null });
  return { s, api, world, camera };
}
const run = (s, command, target = null) => s.api("scene.frame").run({ ext: "scene.frame", command, target });
const B1 = { min: [0, 0, 0], max: [1, 1, 1] };
const B2 = { min: [0, 0, 0], max: [2, 1, 1] };
const B3 = { min: [-1, 0, 0], max: [2, 1, 1] };

describe("scene.frame (pure)", () => {
  it("frames the selected group a double-clicked object is in, else the object", () => {
    const objects = { a: object(), g: group(), b: object() };
    const scene = { objects, groups: new Map([["a", "g"]]) };
    expect(frameTarget(scene, "a", null)).toBe("a");
    expect(frameTarget(scene, "a", "g")).toBe("g");
    expect(frameTarget(scene, "b", "g")).toBe("b");
    expect(frameTarget(scene, "gone", null)).toBe(null);
    expect(frameTarget(scene, "a", "dimension:d1")).toBe("a"); // a ref selection is no group
  });
});

describe("scene.frame: commands and double-click", () => {
  it("Frame (.) frames the selection, else the scene's box; F is left to carry's Flip", async () => {
    const { s, world, camera } = await mount();
    const c = s.instance("scene.frame").commands.find((k) => k.id === "frame");
    expect(c.key).toBe(".");
    expect(c.name).toBe("Frame all");
    expect(c.state("a", {})).toBe(null);
    expect(c.state(null, { local: {} })).toEqual({ title: "Frame everything (.)" });
    world.box = B2;
    expect(run(s, "frame")).toBe(true);
    expect(camera.frames.at(-1)).toEqual(B2);
    world.boxes = { a: B1 };
    s.local.swap((m) => ({ ...m, selected: "a" }));
    expect(c.state(null, { local: s.local.get() })).toMatchObject({ label: "Frame selection" });
    expect(run(s, "frame")).toBe(true);
    expect(camera.frames.at(-1)).toEqual(B1);
    s.unmount();
  });

  it("a double-click on an object frames it, or the selected group it's in; on nothing it passes", async () => {
    const { s, world, camera } = await mount({ objects: { a: object({ group: "g" }), g: group() }, order: ["a", "g"] });
    world.boxes = { a: B1, g: B2 };
    const input = s.instance("scene.frame").input;
    expect(input.dblclick({ hit: { id: "a" } })).toBe(true);
    expect(camera.frames.at(-1)).toEqual(B1);
    s.local.swap((m) => ({ ...m, selected: "g" }));
    expect(input.dblclick({ hit: { id: "a" } })).toBe(true);
    expect(camera.frames.at(-1)).toEqual(B2);
    const n = camera.frames.length;
    expect(input.dblclick({ hit: null })).toBe(false);
    world.boxes = {};
    expect(input.dblclick({ hit: { id: "a" } })).toBe(false);
    expect(camera.frames.length).toBe(n);
    s.unmount();
  });

  it("Set home view writes this camera to doc.view.start.home, as an edit; it's a menu command, disabled without a camera", async () => {
    const s = await mountStage({ extensions: [{ meta: { id: "scene.frame" }, module: frame }] });
    const c = s.instance("scene.frame").commands.find((k) => k.id === "set-home");
    expect(c.show).toEqual(["menu"]);
    // no WebGL, so no camera yet
    expect(c.state(null, {}).disabled).toBe(true);
    expect(run(s, "set-home")).toBe(false);
    const camera = fakeCamera();
    s.api("scene.frame").camera = camera.rig;
    expect(c.state(null, {}).disabled).toBe(false);
    expect(run(s, "set-home")).toBe(true);
    expect(s.doc().view.start.home).toEqual({ position: [5, 5, 5], target: [0, 0, 0], fov: 45 });
    expect(s.local.get().edits.undo).toBe("Set home view");
    expect(s.api("scene.frame").undo()).toBe(true);
    // (a scene made new starts people in Edit: that was there before)
    expect(s.doc().view.start).toEqual({ body: "edit" });
    s.unmount();
  });
});

describe("scene.frame with the key map", () => {
  it(". frames everything with nothing selected; F is no longer Frame's", async () => {
    const { default: keys } = await import("./keys.js");
    const s = await mountStage({ extensions: [{ meta: { id: "scene.keys" }, module: keys }, { meta: { id: "scene.frame" }, module: frame }] });
    const camera = fakeCamera();
    s.api("scene.frame").camera = camera.rig;
    s.api("scene.frame").sceneBox = () => B3;
    s.key("f");
    expect(camera.frames).toEqual([]);
    s.key(".", { code: "Period" });
    expect(camera.frames).toEqual([B3]);
    s.unmount();
  });
});
