// Links, closed only (COMPOSITION.md build step 11): a scene doc added to a
// scene is a link, an ordinary object through the scene.link source, with
// no render doc, routed as "scene" and drawn as its hint.

import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, settle } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo, fakeHead } from "../test/fake-repo.js";
import { LINK } from "./links.js";

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

describe("links, closed", () => {
  it("adding a scene doc makes a live link: no render doc, routed as a scene, drawn as its hint; with heads, a pinned one", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const repo = new FakeRepo();
    const game = repo.add(emptyScene({ title: "Lost Cities" }));
    const EXT = { meta: { id: "t.any" }, module: { create: () => ({}) } };
    s = await mountStage({ repo, extensions: [EXT], doc: { objects: {}, order: [] } });
    const api = s.api("t.any");
    const id = await api.addObject(game.url, { hint: { bounds: { min: [-0.4, 0, -0.3], max: [0.4, 0.1, 0.3] } } });
    await settle();
    const o = s.doc().objects[id];
    expect(o).toMatchObject({ name: "Lost Cities", sourceUrl: game.url, providerId: LINK, renderUrl: null });
    expect(o.at).toBeUndefined();
    expect(api.loadState(id)).toMatchObject({ content: "scene" });
    expect(s.local.get().status[id]).toBeUndefined();
    const head = fakeHead();
    const pinned = await api.addObject(`${game.url}#${head}`);
    expect(s.doc().objects[pinned].at).toEqual({ heads: [head] });
    // a scene of itself, live: the expansion closes it (a cycle), so adding it is no error
    const self = await api.addObject(s.handle.url);
    expect(s.doc().objects[self].providerId).toBe(LINK);
  });
});
