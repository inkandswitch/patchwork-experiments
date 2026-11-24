// @vitest-environment happy-dom
// The inspector where the host has no <patchwork-view> (a local probe, a
// test): it mounts no document anyway (PLANS.md §5): its documents are rows,
// and its build's controls are its own fields, never the controls tool.
// (No <patchwork-view> is defined in this file; inspector.test.js has its
// stand-in.)
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

describe("scene.inspector: without a host embed", () => {
  it("mounts nothing: rows for its documents, its own fields for the build, no placeholder and no controls tool", async () => {
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
    expect(customElements.get("patchwork-view")).toBeUndefined();
    expect([...body.querySelectorAll(".doc-row")].map((r) => r.dataset.section)).toEqual(["source", "about"]);
    expect(body.querySelectorAll(".doc-placeholder").length).toBe(0);
    expect(body.querySelector(".scene-render-controls")).toBeNull();
    expect(body.querySelector(".build-controls .rebuild")).not.toBeNull();
  });
});
