import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import frame, { frameTarget, sameCamera, shownObjects } from "./frame.js";

const group = (extra = {}) => ({ ...object({ name: "G", providerId: null }), kind: "group", ...extra });

/** A camera rig standing in for the stage's (no WebGL here): frame() moves it to look at the box. */
function fakeCamera({ touched = false } = {}) {
  const cam = { position: [5, 5, 5], target: [0, 0, 0], fov: 45 };
  const frames = [];
  const rig = {
    object: null,
    get: () => ({ position: [...cam.position], target: [...cam.target], fov: cam.fov }),
    set: () => {},
    frame(box) {
      frames.push(box);
      cam.target = box ? box.min.map((v, i) => (v + box.max[i]) / 2) : [0, 0.5, 0];
      cam.position = cam.target.map((v) => v + 3);
    },
    hold: () => () => {},
    limit: () => () => {},
    touched: () => touched,
    watch: () => () => {},
  };
  return { cam, frames, rig };
}

/**
 * Mount scene.frame with a stubbed camera, scene box and content (the stage's
 * own need WebGL). `world.box` is the scene's box; `world.loaded` the ids whose content is in.
 */
async function mount(doc = {}) {
  const s = await mountStage({ extensions: [{ meta: { id: "scene.frame" }, module: frame }], kits: [{ id: "model", extensions: ["scene.frame"] }], doc });
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
  it("tells whether the camera is where it was left", () => {
    const a = { position: [0, 0, 10], target: [0, 0, 0] };
    expect(sameCamera(a, { position: [0, 0, 10.0000001], target: [0, 0, 0] })).toBe(true);
    expect(sameCamera(a, { position: [0, 0, 10.1], target: [0, 0, 0] })).toBe(false);
    expect(sameCamera(a, { position: [0, 0, 10], target: [0, 1, 0] })).toBe(false);
    expect(sameCamera(a, null)).toBe(false);
  });
  it("frames the selected group a double-clicked object is in, else the object", () => {
    const objects = { a: object(), g: group(), b: object() };
    const scene = { objects, groups: new Map([["a", "g"]]) };
    expect(frameTarget(scene, "a", null)).toBe("a");
    expect(frameTarget(scene, "a", "g")).toBe("g");
    expect(frameTarget(scene, "b", "g")).toBe("b");
    expect(frameTarget(scene, "gone", null)).toBe(null);
  });
  it("counts what is shown: not hidden, not in a hidden group, not a group", () => {
    const objects = { a: object(), b: object({ visible: false }), c: object({ group: "g" }), g: group({ visible: false }) };
    expect(shownObjects({ objects, ids: ["a", "b", "c", "g"], parents: new Map(), groups: new Map([["c", "g"]]) })).toEqual(["a"]);
  });
});

describe("scene.frame: commands and double-click", () => {
  it("Frame all (F) frames the scene's box", async () => {
    const { s, world, camera } = await mount();
    const c = s.instance("scene.frame").commands.find((k) => k.id === "frame-all");
    expect(c.key).toBe("f");
    expect(c.name).toBe("Frame all");
    expect(c.state("a", {})).toBe(null);
    world.box = B2;
    expect(run(s, "frame-all")).toBe(true);
    expect(camera.frames.at(-1)).toEqual(B2);
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

  it("Set home view writes this camera to doc.view.home; it's a menu command, disabled without a camera", async () => {
    const s = await mountStage({ extensions: [{ meta: { id: "scene.frame" }, module: frame }], kits: [{ id: "model", extensions: ["scene.frame"] }] });
    const c = s.instance("scene.frame").commands.find((k) => k.id === "set-home");
    expect(c.show).toEqual(["menu"]);
    // no WebGL, so no camera yet
    expect(c.state(null, {}).disabled).toBe(true);
    expect(run(s, "set-home")).toBe(false);
    const camera = fakeCamera();
    s.api("scene.frame").camera = camera.rig;
    expect(c.state(null, {}).disabled).toBe(false);
    expect(run(s, "set-home")).toBe(true);
    expect(s.doc().view.home).toEqual({ position: [5, 5, 5], target: [0, 0, 0], fov: 45 });
    s.unmount();
  });
});

describe("scene.frame: auto-framing", () => {
  it("frames once from hint bounds, then leaves the camera alone as content loads", async () => {
    const { s, world, camera } = await mount();
    world.box = B1;
    s.change((d) => {
      d.objects.a = object({ hint: { bounds: { min: [0, 0, 0], max: [1, 1, 1] } } });
    });
    await s.settle();
    expect(camera.frames).toEqual([B1]);
    world.box = B2;
    world.loaded.add("a");
    s.change((d) => (d.title = "loaded"));
    await s.settle();
    expect(camera.frames).toEqual([B1]);
    s.unmount();
  });

  it("without hints, follows the content as it arrives until all of it has loaded", async () => {
    const { s, world, camera } = await mount();
    s.change((d) => {
      d.objects.a = object();
      d.objects.b = object();
    });
    await s.settle();
    expect(camera.frames).toEqual([]); // nothing to see yet
    world.box = B1;
    world.loaded.add("a");
    s.change((d) => (d.title = "a loaded"));
    await s.settle();
    expect(camera.frames).toEqual([B1]);
    // a hover is no reason to frame again
    s.local.swap((m) => ({ ...m, hovered: "a" }));
    await s.settle();
    expect(camera.frames).toEqual([B1]);
    // nor is a pose held mid-drag, though it moves the box
    world.box = B3;
    s.api("scene.frame").pose.hold("a", { position: [1, 0, 0], rotation: [0, 0, 0], scale: 1 });
    await s.settle();
    s.api("scene.frame").pose.release("a");
    await s.settle();
    expect(camera.frames).toEqual([B1]);
    world.box = B2;
    world.loaded.add("b");
    s.change((d) => (d.title = "b loaded"));
    await s.settle();
    expect(camera.frames).toEqual([B1, B2]);
    // everything is in: a rebuild later doesn't reframe
    world.box = B3;
    s.change((d) => (d.title = "rebuilt"));
    await s.settle();
    expect(camera.frames).toEqual([B1, B2]);
    s.unmount();
  });

  it("stops once the person moves the camera", async () => {
    const { s, world, camera } = await mount();
    s.change((d) => {
      d.objects.a = object();
      d.objects.b = object();
    });
    world.box = B1;
    world.loaded.add("a");
    await s.settle();
    expect(camera.frames).toEqual([B1]);
    camera.cam.position = [9, 9, 9]; // an orbit
    world.box = B2;
    s.change((d) => (d.title = "more"));
    await s.settle();
    expect(camera.frames).toEqual([B1]);
    s.unmount();
  });

  it("starts again when objects arrive in an empty scene", async () => {
    const { s, world, camera } = await mount({ objects: { a: object() }, order: ["a"] });
    world.box = B1;
    world.loaded.add("a");
    s.change((d) => (d.title = "a loaded"));
    await s.settle();
    expect(camera.frames).toEqual([B1]);
    camera.cam.position = [9, 9, 9];
    s.change((d) => {
      delete d.objects.a;
      d.order = [];
    });
    world.box = null;
    await s.settle();
    s.change((d) => {
      d.objects.b = object();
    });
    await s.settle();
    world.box = B2;
    world.loaded.add("b");
    s.change((d) => (d.title = "b loaded"));
    await s.settle();
    expect(camera.frames).toEqual([B1, B2]);
    s.unmount();
  });

  it("never frames a camera this viewer had already placed", () => {
    const camera = fakeCamera({ touched: true });
    const api = { camera: camera.rig, sceneBox: () => B1, content: () => ({ loaded: true }), local: { get: () => ({}) } };
    const x = frame.create(api);
    const scene = { objects: { a: object() }, ids: ["a"], parents: new Map(), groups: new Map() };
    x.update(scene, {}, { scene: null, local: null });
    expect(camera.frames).toEqual([]);
  });
});

describe("scene.frame with the key map", () => {
  it("F frames everything", async () => {
    const { default: keys } = await import("./keys.js");
    const s = await mountStage({ extensions: [{ meta: { id: "scene.frame" }, module: frame }, { meta: { id: "scene.keys" }, module: keys }], kits: [{ id: "model", extensions: ["scene.keys", "scene.frame"] }] });
    const camera = fakeCamera();
    s.api("scene.frame").camera = camera.rig;
    s.api("scene.frame").sceneBox = () => B3;
    s.key("f");
    expect(camera.frames).toEqual([B3]);
    s.unmount();
  });
});
