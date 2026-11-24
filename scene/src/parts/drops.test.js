// @vitest-environment happy-dom
// scene.drops (EDITOR.md, "Drops"): a drop or a paste into the view is heard
// once, while the Edit hand is held, and offered in running order until one
// handler says true.
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo } from "../test/fake-repo.js";
import transfer from "./transfer.js";
import add from "./add.js";

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
      dropping: { wants: () => takes, over: () => (log.push(`${id} over`), takes), leave: () => log.push(`${id} leave`), drop: () => (log.push(`${id} drop`), takes) },
      pasting: () => (log.push(`${id} paste`), takes),
      copying: () => (log.push(`${id} copy`), takes),
    }),
  },
});
const event = (type, data = {}) => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  const written = {};
  Object.defineProperty(e, "dataTransfer", { value: { types: Object.keys(data), dropEffect: "none", getData: (t) => data[t] ?? "" } });
  Object.defineProperty(e, "clipboardData", { value: { getData: (t) => data[t] ?? "", setData: (t, v) => (written[t] = v) } });
  e.written = written;
  return e;
};

describe("scene.drops", () => {
  it("offers a drag, a drop, a paste and a copy in running order until one says true; outside Edit a wanted drop is refused, saying why, and pastes and copies are the browser's", async () => {
    const log = [];
    s = await mountStage({ editor: true, natives: ["scene.notices"], extensions: [handler("t.no", log, false), handler("t.yes", log, true), handler("t.after", log, true)] });
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
    expect(fire("copy")).toEqual([true, "t.no copy", "t.yes copy"]);
    s.edit(false);
    await settle();
    // refused, never the browser's (it would open a dropped file in Patchwork's place), and said once a drag
    expect([fire("dragover"), fire("drop"), fire("paste"), fire("copy")]).toEqual([[true], [true, "t.no leave", "t.yes leave", "t.after leave"], [false], [false]]);
    expect(s.notices().map((n) => n.text)).toEqual(["To add this to the scene, pick up Edit first."]);
  });

  // a Copy's clipboard holds the row payload and the doc link as text: it is pasted as a copy, whichever of
  // scene.transfer and scene.add runs first (scene.add declines an object copy: ../transfer.js isObjectCopy)
  it.each([
    ["transfer, then add", ["transfer", "add"]],
    ["add, then transfer", ["add", "transfer"]],
  ])("a pasted copy is a copy, %s", async (_name, order) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const PARTS = { transfer: { meta: { id: "scene.transfer" }, module: transfer }, add: { meta: { id: "scene.add" }, module: add } };
    const repo = new FakeRepo();
    const file = repo.add({ "@patchwork": { type: "file" }, name: "a.glb", extension: "glb", mimeType: "model/gltf-binary", content: new Uint8Array(4) });
    s = await mountStage({ editor: true, natives: true, repo, extensions: order.map((k) => PARTS[k]), doc: { objects: { a: object({ name: "A", sourceUrl: file.url }) }, order: ["a"] } });
    s.edit(true);
    s.local.swap((m) => ({ ...m, selected: "a" }));
    await settle();
    const c = event("copy");
    s.root.dispatchEvent(c);
    expect(c.defaultPrevented).toBe(true);
    expect(c.written["text/plain"]).toBe(file.url); // (the link scene.add would take as a document)
    s.root.dispatchEvent(event("paste", c.written));
    for (let i = 0; i < 4; i++) await settle();
    expect(Object.values(s.doc().objects).map((o) => o.name).sort()).toEqual(["A", "A"]);
  });
});
