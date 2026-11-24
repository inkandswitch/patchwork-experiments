// @vitest-environment happy-dom
// The prefs native (NATIVE.md, "Native services"): a viewer's pref, else a doc's suggestion.
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "./link-graph.js";

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

describe("prefs", () => {
  // A pref this viewer hasn't set is the asking extension's doc's suggestion
  // (`doc.view`), a linked game's own; a view plugin's is the focus doc's.
  it("a pref falls back on the asking extension's doc, a view plugin's on the focus doc", async () => {
    const repo = new FakeRepo();
    const b = repo.add(emptyScene({ title: "B", view: { snap: false } }));
    const got = [];
    const ext = { meta: { id: "t.ext", traits: ["*"] }, module: { create: (api) => (got.push([api.doc().title, api.use("prefs").get("snap", null)]), {}) } };
    const objects = { L: object({ name: "B", sourceUrl: b.url, providerId: LINK, renderUrl: null }) };
    s = await mountStage({ repo, natives: true, extensions: [ext], doc: { title: "A", view: { snap: true }, objects, order: ["L"] } });
    await until(() => got.length === 2, 2000);
    const view = s.debug.view;
    const asView = () => view.plugins.use("prefs", { id: "t.view", signal: new AbortController().signal }).get("snap", null);
    expect([got.sort(), asView(), view.focusOn(["L"]) && asView()]).toEqual([[["A", true], ["B", false]], true, false]);
  });
});
