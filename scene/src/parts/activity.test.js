import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import activity, { activityLabel, switcherOrder } from "./activity.js";

const ACTIVITY = { meta: { id: "scene.activity", always: true }, module: activity };
const plain = { create: () => ({}) };
const EDITOR = { meta: { id: "t.editor", activities: ["edit"] }, module: plain };
// a game: its trait offers play, and it runs only then
const GAME = { meta: { id: "t.game", traits: ["t.level"], activities: ["play"] }, module: plain };

describe("scene.activity, the pure side", () => {
  it("labels: the known ones, else the id as words", () => {
    expect(activityLabel("edit")).toBe("Edit");
    expect(activityLabel("play")).toBe("Play");
    expect(activityLabel("free-roam")).toBe("Free roam");
    expect(activityLabel("")).toBe("?");
  });

  it("shows what the scene is for first, editing last", () => {
    expect(switcherOrder(["edit", "play", "review"])).toEqual(["play", "review", "edit"]);
    expect(switcherOrder(["edit"])).toEqual(["edit"]);
  });
});

describe("scene.activity", () => {
  let s;
  afterEach(() => {
    s?.unmount();
    s = null;
  });

  const mount = (doc = {}) => mountStage({ extensions: [ACTIVITY, EDITOR, GAME], doc: { objects: { a: object() }, order: ["a"], ...doc } });
  const bar = () => s.root.querySelector(".activity-switch");
  const option = (id) => bar().querySelector(`button[data-activity="${id}"]`);
  const running = () => s.local.get().running.map((r) => r.id);

  it("shows nothing when editing is all the scene offers", async () => {
    s = await mount();
    expect(s.local.get().activities).toEqual({ current: "edit", available: ["edit"] });
    expect(bar().hidden).toBe(true);
    expect(running()).toEqual(["scene.activity", "t.editor"]);
  });

  it("a scene that's played offers Play | Edit; pressing one switches this viewer only", async () => {
    s = await mount({ traits: { "t.level": {} } });
    expect(bar().hidden).toBe(false);
    expect([...bar().querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Play", "Edit"]);
    expect(option("edit").getAttribute("aria-pressed")).toBe("true");
    expect(option("play").getAttribute("aria-pressed")).toBe("false");
    expect(running()).toEqual(["scene.activity", "t.editor"]);
    option("play").click();
    await settle();
    expect(s.local.get().activity).toBe("play");
    expect(s.doc().view.activity).toBeUndefined();
    expect(running()).toEqual(["t.game", "scene.activity"]);
    expect(option("play").getAttribute("aria-pressed")).toBe("true");
    expect(option("edit").getAttribute("aria-pressed")).toBe("false");
    option("edit").click();
    await settle();
    expect(running()).toEqual(["scene.activity", "t.editor"]);
  });

  it("starts where the doc says, and appears when a played trait arrives", async () => {
    s = await mount({ view: { activity: "play" } });
    // nothing here is played yet: the viewer edits, with no choice to show
    expect(s.local.get().activities.current).toBe("edit");
    expect(bar().hidden).toBe(true);
    s.change((d) => {
      d.traits["t.level"] = {};
    });
    await settle();
    expect(bar().hidden).toBe(false);
    expect(s.local.get().activities.current).toBe("play");
    expect(option("play").getAttribute("aria-pressed")).toBe("true");
  });
});

describe("the scene package's own extensions", () => {
  it("edit runs the editor in its order; play keeps only the key map, notices and the switcher; none offers play", async () => {
    const { plugins } = await import("../index.js");
    const { activeSet, availableActivities } = await import("../stage/activation.js");
    const metas = plugins.filter((p) => p.type === "scene:extension");
    const doc = { objects: {}, traits: {} };
    expect(activeSet({ metas, doc, activity: "edit" }).map((r) => r.id)).toEqual([
      "scene.toolbar",
      "scene.sidebar",
      "scene.notices",
      "scene.keys",
      "scene.menu",
      "scene.frame",
      "scene.autoframe",
      "scene.outline",
      "scene.inspector",
      "scene.measure",
      "scene.dimensions",
      "scene.handles",
      "scene.gizmo",
      "scene.hand",
      "scene.select",
      "scene.grid",
      "scene.axes",
      "scene.bounds",
      "scene.units",
      "scene.legends",
      "scene.add",
      "scene.parts",
      "scene.activity",
    ]);
    expect(activeSet({ metas, doc, activity: "play" }).map((r) => r.id)).toEqual(["scene.notices", "scene.keys", "scene.activity"]);
    expect(availableActivities(metas, doc)).toEqual(["edit"]);
    expect(plugins.some((p) => p.type === "scene:kit")).toBe(false);
  });

  it("the use prompt runs only in play, and only when a game requires it, ahead of the key map", async () => {
    const { plugins } = await import("../index.js");
    const { activeSet, availableActivities } = await import("../stage/activation.js");
    const game = { id: "t.game", traits: ["t.level"], activities: ["play"], requires: ["scene.use", "scene.keys"] };
    const metas = [game, ...plugins.filter((p) => p.type === "scene:extension")];
    const doc = { objects: {}, traits: { "t.level": {} } };
    expect(activeSet({ metas, doc, activity: "play" }).map((r) => r.id)).toEqual(["t.game", "scene.use", "scene.keys", "scene.notices", "scene.activity"]);
    expect(activeSet({ metas, doc, activity: "edit" }).map((r) => r.id)).not.toContain("scene.use");
    // installing it offers play nowhere it isn't already
    expect(availableActivities(metas, doc)).toEqual(["edit", "play"]);
    expect(availableActivities(metas.slice(1), { objects: {}, traits: {} })).toEqual(["edit"]);
  });
});
