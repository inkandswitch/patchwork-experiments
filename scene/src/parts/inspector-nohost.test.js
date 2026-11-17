// The inspector's sections where the host has no <patchwork-view> (a local
// probe, a test): each open section names its document instead, and nothing
// of this package is mounted in its place. (No <patchwork-view> is defined in
// this file; inspector.test.js has its stand-in.)
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo } from "../test/fake-repo.js";
import inspector from "./inspector.js";
import { openTabs } from "../test/tabs.js";

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
});

describe("scene.inspector: sections without a host embed", () => {
  it("an open section is a placeholder naming its doc; folded, it has none; a new selection takes them all", async () => {
    const repo = new FakeRepo();
    const src = repo.add({ "@patchwork": { type: "thing" }, title: "the source" });
    const render = repo.add({ "@patchwork": { type: "scene-render" }, title: "x", parent: src.url, providerId: "file-glb", params: {}, glbUrl: null, builtFrom: null, builtAt: null, status: "idle", error: null, pinned: false });
    const info = repo.add({ title: "about" });
    s = await mountStage({
      repo,
      extensions: [{ meta: { id: "scene.inspector" }, module: inspector }, openTabs(["scene.inspector:inspector"], { once: true })],
      doc: { objects: { a: object({ name: "A", infoUrl: info.url, sourceUrl: src.url, renderUrl: render.url, visible: false }), b: object({ name: "B" }) }, order: ["a", "b"] },
    });
    s.local.swap((m) => ({ ...m, selected: "a" }));
    await settle();
    const body = s.instance("scene.inspector").tab.body;
    const shown = () => [...body.querySelectorAll(".doc-section")].map((sec) => [sec.dataset.section, sec.querySelector(".section-placeholder")?.textContent ?? null]);
    expect(customElements.get("patchwork-view")).toBeUndefined();
    const build = shown().find(([id]) => id === "build");
    expect(build).toEqual(["build", `Build: ${render.url}`]);
    expect(shown().find(([id]) => id === "about")).toEqual(["about", `About: ${info.url}`]);
    // the build controls aren't mounted in its place
    expect(body.querySelector(".scene-render-controls")).toBeNull();
    s.local.swap((m) => ({ ...m, selected: "b" }));
    await settle();
    expect(body.querySelectorAll(".section-placeholder").length).toBe(0);
  });
});
