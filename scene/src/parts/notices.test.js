import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import notices, { loadSummary } from "./notices.js";

describe("loadSummary (pure)", () => {
  const objs = {
    a: object({ sourceUrl: "automerge:x" }),
    b: object({ sourceUrl: "automerge:y" }),
    c: object({ sourceUrl: "automerge:z" }),
    g: { kind: "group" },
    h: object({ sourceUrl: "automerge:w", visible: false }),
  };
  it("counts what's loading out of what's shown, then building and errors", () => {
    expect(loadSummary(objs, {})).toEqual([]);
    expect(loadSummary(objs, { a: { state: "loading" } })).toEqual([{ text: "Loading 2 of 3…", state: "loading" }]);
    expect(
      loadSummary(objs, {
        a: { state: "building" },
        b: { state: "error" },
        c: { state: "error" },
      }),
    ).toEqual([
      { text: "Building 1…", state: "building" },
      { text: "2 errors", state: "error" },
    ]);
    // status for something no longer in the scene is ignored
    expect(loadSummary(objs, { gone: { state: "error" } })).toEqual([]);
  });
});

describe("scene.notices", () => {
  let s, says;
  beforeEach(async () => {
    says = { items: [{ text: "Waiting for Bob", state: "loading" }] };
    const talker = {
      create: () => ({
        hud: (scene, local) => (local.selected ? [...says.items, { text: `picked ${local.selected}`, state: "info" }] : says.items),
      }),
    };
    s = await mountStage({
      extensions: [
        { meta: { id: "scene.notices" }, module: notices },
        { meta: { id: "t.talker" }, module: talker },
      ],
      kits: [{ id: "model", extensions: ["scene.notices", "t.talker"] }],
      doc: {
        objects: {
          a: object({ sourceUrl: "automerge:x" }),
          b: object({ sourceUrl: "automerge:y" }),
        },
        order: ["a", "b"],
      },
    });
  }, 30_000);
  afterEach(() => s.unmount());

  const pills = () => [...s.root.querySelectorAll(".notices-layer .hud .pill")].map((p) => [p.textContent, p.dataset.state]);

  it("shows the load summary, then each extension's HUD", async () => {
    s.local.swap((m) => ({
      ...m,
      status: { a: { state: "loading", text: "loading" } },
    }));
    await s.settle();
    expect(pills()).toEqual([
      ["Loading 1 of 2…", "loading"],
      ["Waiting for Bob", "loading"],
    ]);
    s.local.swap((m) => ({ ...m, status: {}, selected: "b" }));
    await s.settle();
    expect(pills()).toEqual([
      ["Waiting for Bob", "loading"],
      ["picked b", "info"],
    ]);
  });

  it("shows a notice as a toast, and fades it out when it goes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      s.api("t.talker").notify("Couldn't open that document", "error");
      await Promise.resolve();
      await Promise.resolve();
      const toast = s.root.querySelector(".notices-layer .toast");
      expect(toast.textContent).toBe("Couldn't open that document");
      expect(toast.dataset.kind).toBe("error");
      // the stage expires it
      vi.advanceTimersByTime(6_100);
      await Promise.resolve();
      await Promise.resolve();
      expect(toast.hasAttribute("data-leaving")).toBe(true);
      vi.advanceTimersByTime(300);
      expect(toast.isConnected).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
