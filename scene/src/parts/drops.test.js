// @vitest-environment happy-dom
// scene.drops (EDITOR.md, "Drops"): a drop or a paste into the view is heard
// once, while the Edit hand is held, and offered in running order until one
// handler says true.
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, settle } from "../test/stage-harness.js";

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
});

/** A view plugin whose handlers log what they're offered and answer `takes`. */
const handler = (id, log, takes) => ({
  meta: { id, type: "scene:view" },
  module: {
    create: () => ({
      dropping: { over: () => (log.push(`${id} over`), takes), leave: () => log.push(`${id} leave`), drop: () => (log.push(`${id} drop`), takes) },
      pasting: () => (log.push(`${id} paste`), takes),
    }),
  },
});
const event = (type) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { types: [], dropEffect: "none", getData: () => "" } });
  Object.defineProperty(e, "clipboardData", { value: { getData: () => "" } });
  return e;
};

describe("scene.drops", () => {
  it("offers a drag, a drop and a paste in running order until one says true; nothing while the editor is down", async () => {
    const log = [];
    s = await mountStage({ editor: true, extensions: [handler("t.no", log, false), handler("t.yes", log, true), handler("t.after", log, true)] });
    s.edit(true);
    await settle();
    const fire = (type) => {
      log.length = 0;
      const e = event(type);
      s.canvas.dispatchEvent(e);
      return [e.defaultPrevented, ...log];
    };
    expect(fire("dragover")).toEqual([true, "t.no over", "t.yes over"]);
    // (a drop ends the drag for every handler first)
    expect(fire("drop")).toEqual([true, "t.no leave", "t.yes leave", "t.after leave", "t.no drop", "t.yes drop"]);
    expect(fire("paste")).toEqual([true, "t.no paste", "t.yes paste"]);
    s.edit(false);
    await settle();
    expect([fire("dragover"), fire("drop"), fire("paste")]).toEqual([[false], [false], [false]]);
  });
});
