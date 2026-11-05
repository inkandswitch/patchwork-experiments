import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import { fakeCamera } from "../test/fake-camera.js";
import autoframe, { sameCamera, shownObjects } from "./autoframe.js";

const group = (extra = {}) => ({ ...object({ name: "G", providerId: null }), kind: "group", ...extra });

/**
 * Mount scene.autoframe with a stubbed camera, scene box and content (the stage's
 * own need WebGL). `world.box` is the scene's box; `world.loaded` the ids whose content is in.
 */
async function mount(doc = {}) {
  const s = await mountStage({ extensions: [{ meta: { id: "scene.autoframe" }, module: autoframe }], doc });
  const api = s.api("scene.autoframe");
  const world = { box: null, loaded: new Set(), boxes: {} };
  const camera = fakeCamera();
  api.camera = camera.rig;
  api.sceneBox = () => world.box;
  api.box = (id) => world.boxes[id] ?? null;
  api.content = (id) => ({ loaded: world.loaded.has(id), box: null, extras: null, stats: null });
  return { s, api, world, camera };
}
const B1 = { min: [0, 0, 0], max: [1, 1, 1] };
const B2 = { min: [0, 0, 0], max: [2, 1, 1] };
const B3 = { min: [-1, 0, 0], max: [2, 1, 1] };

describe("scene.autoframe (pure)", () => {
  it("tells whether the camera is where it was left", () => {
    const a = { position: [0, 0, 10], target: [0, 0, 0] };
    expect(sameCamera(a, { position: [0, 0, 10.0000001], target: [0, 0, 0] })).toBe(true);
    expect(sameCamera(a, { position: [0, 0, 10.1], target: [0, 0, 0] })).toBe(false);
    expect(sameCamera(a, { position: [0, 0, 10], target: [0, 1, 0] })).toBe(false);
    expect(sameCamera(a, null)).toBe(false);
  });
  it("counts what is shown: not hidden, not in a hidden group, not a group", () => {
    const objects = { a: object(), b: object({ visible: false }), c: object({ group: "g" }), g: group({ visible: false }) };
    expect(shownObjects({ objects, ids: ["a", "b", "c", "g"], parents: new Map(), groups: new Map([["c", "g"]]) })).toEqual(["a"]);
  });
});

describe("scene.autoframe", () => {
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
    s.api("scene.autoframe").pose.hold("a", { position: [1, 0, 0], rotation: [0, 0, 0], scale: 1 });
    await s.settle();
    s.api("scene.autoframe").pose.release("a");
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
    const x = autoframe.create(api);
    const scene = { objects: { a: object() }, ids: ["a"], parents: new Map(), groups: new Map() };
    x.update(scene, {}, { scene: null, local: null });
    expect(camera.frames).toEqual([]);
  });
});

describe("scene.autoframe has nothing to invoke", () => {
  it("no commands and no input: a game can require it and keep F for itself", async () => {
    const { s } = await mount();
    const x = s.instance("scene.autoframe");
    expect(x.commands).toBeUndefined();
    expect(x.input).toBeUndefined();
    s.unmount();
  });
});
