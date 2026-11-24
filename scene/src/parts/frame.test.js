// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import { fakeCamera } from "../test/fake-camera.js";
import frame from "./frame.js";
import { editor } from "./editor.js";

const group = (extra = {}) => ({ ...object({ name: "G", providerId: null }), kind: "group", ...extra });

/**
 * Mount scene.frame with a stubbed camera, scene box and content (the stage's
 * own need WebGL). `world.box` is the scene's box; `world.loaded` the ids whose content is in.
 */
async function mount(doc = {}) {
  const s = await mountStage({ extensions: [{ meta: { id: "scene.frame" }, module: frame }], doc });
  const api = s.facet("scene.frame");
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

describe("scene.frame: commands", () => {
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
    expect(c.state(null, { view: s.local.get() })).toMatchObject({ label: "Frame selection" });
    expect(run(s, "frame")).toBe(true);
    expect(camera.frames.at(-1)).toEqual(B1);
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
    s.facet("scene.frame").camera = camera.rig;
    expect(c.state(null, {}).disabled).toBe(false);
    expect(run(s, "set-home")).toBe(true);
    expect(s.doc().view.start.home).toEqual({ position: [5, 5, 5], target: [0, 0, 0], fov: 45 });
    expect(editor(s.facet("scene.frame")).labels().undo).toBe("Set home view");
    expect(editor(s.facet("scene.frame")).undo()).toBe(true);
    // (a scene made new starts people holding the editor: that was there before)
    expect(s.doc().view.start).toEqual({ edit: true });
    s.unmount();
  });
});
