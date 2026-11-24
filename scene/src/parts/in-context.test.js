// @vitest-environment happy-dom
// The editor's writes in context (EDITOR.md, "Drops", "Undo"): a drop goes
// down the handlers until one says true, else to the scene's own sources;
// entered in a link, drops, paste, parts and templates write the focus doc,
// not the host; undo is per focus doc across Enter and Leave.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle, until } from "../test/stage-harness.js";
import { emptyScene } from "../test/empty-scene.js";
import { FakeRepo } from "../test/fake-repo.js";
import { LINK } from "../native/link-graph.js";
import { ROW_MIME, rowPayload } from "../transfer.js";
import add from "./add.js";
import transfer from "./transfer.js";
import parts from "./parts.js";
import select from "./select.js";
import undo from "./undo.js";

const link = (url, extra = {}) => object({ name: "Link", sourceUrl: url, providerId: LINK, renderUrl: null, ...extra });
const stl = (repo) => repo.add({ "@patchwork": { type: "file" }, name: "part.stl", extension: "stl", mimeType: "model/stl", content: new Uint8Array(84) });

function dropEvent(data) {
  const e = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "dataTransfer", { value: { types: Object.keys(data), files: [], dropEffect: "none", getData: (t) => data[t] ?? "" } });
  return e;
}
function pasteEvent(data) {
  const e = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(e, "clipboardData", { value: { getData: (t) => data[t] ?? "", setData() {} } });
  return e;
}
const settled = async (n = 3) => {
  for (let i = 0; i < n; i++) await settle();
};

let s = null;
beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

describe("a drop goes down the handlers until one says true (EDITOR.md, \"Drops\")", () => {
  // Two extensions whose `drops` take files, in registry order: a (answering
  // through a promise) and b. Each says what `answers` holds for it.
  async function mount(answers) {
    const asked = [];
    const handler = (id, wrap) => ({
      meta: { id, drops: ["file"] },
      module: { create: () => ({}), drop: (ctx, info) => (asked.push([id, info.url]), wrap(answers[id])) },
    });
    s = await mountStage({ editor: true, natives: true, extensions: [{ meta: { id: "scene.add" }, module: add }, handler("t.a", (v) => Promise.resolve(v)), handler("t.b", (v) => v)] });
    s.edit(true);
    const file = stl(s.repo);
    s.root.dispatchEvent(pasteEvent({ "text/plain": file.url }));
    await settled();
    return { asked, file, objects: Object.values(s.doc().objects) };
  }

  it("one that says false lets the next take it, which stops it there: nothing else adds it", async () => {
    const { asked, file, objects } = await mount({ "t.a": false, "t.b": true });
    expect(asked).toEqual([["t.a", file.url], ["t.b", file.url]]);
    expect(objects).toEqual([]);
  });

  it("every handler passing, the scene's own source takes it: the object is added", async () => {
    const { asked, file, objects } = await mount({ "t.a": false, "t.b": false });
    expect(asked).toEqual([["t.a", file.url], ["t.b", file.url]]);
    expect(objects.map((o) => [o.sourceUrl, o.providerId])).toEqual([[file.url, "file-stl"]]);
  });

  it("the first to say true stops it there: the next is never asked, and nothing is added", async () => {
    const { asked, file, objects } = await mount({ "t.a": true, "t.b": true });
    expect(asked).toEqual([["t.a", file.url]]);
    expect(objects).toEqual([]);
  });
});

describe("entered in a link, the editor's writes go to the focus doc, not the host (EDITOR.md, \"Drops\")", () => {
  /**
   * Host A: a table and L, a live link to B (empty). Editing, entered in L.
   * The adders are the real editor parts; a part and a template each add
   * one object named after themselves.
   */
  async function mountEntered() {
    const repo = new FakeRepo();
    const b = repo.add(emptyScene({ title: "B" }));
    const adds = (name) => ({
      create: async (ctx) => {
        const id = ctx.newId("o");
        ctx.change((d) => {
          d.objects[id] = object({ name });
          d.order.push(id);
        });
        return id;
      },
    });
    const objects = { table: object({ name: "Table" }), L: link(b.url, { name: "B" }) };
    s = await mountStage({
      repo,
      editor: true,
      natives: true,
      extensions: [
        { meta: { id: "scene.add" }, module: add },
        { meta: { id: "scene.transfer" }, module: transfer },
        { meta: { id: "scene.parts" }, module: parts },
      ],
      parts: [{ meta: { id: "t.part", name: "Buoy" }, module: adds("Buoy") }],
      templates: [{ meta: { id: "t.tpl", name: "Room" }, module: adds("Room") }],
      doc: { title: "A", objects, order: Object.keys(objects) },
    });
    const view = s.debug.view;
    await until(() => view.stages().some((x) => x.path.join("/") === "L"), 3000);
    s.edit(true);
    expect(view.enter(["L"])).toBe(true);
    await settled();
    expect(view.atom.get().focus).toEqual(["L"]);
    return { b, hostHeads: s.handle.heads(), hostObjects: JSON.stringify(s.doc().objects) };
  }

  const namesIn = (h) => Object.values(h.doc().objects).map((o) => o.name);
  const hostUnchanged = ({ hostHeads, hostObjects }) => {
    expect(s.handle.heads()).toEqual(hostHeads);
    expect(JSON.stringify(s.doc().objects)).toBe(hostObjects);
  };

  it("a drop: the linked doc gains the object, the host is unchanged", async () => {
    const m = await mountEntered();
    const file = stl(s.repo);
    s.canvas.dispatchEvent(dropEvent({ "text/plain": file.url }));
    await settled();
    expect(Object.values(m.b.doc().objects).map((o) => o.sourceUrl)).toEqual([file.url]);
    hostUnchanged(m);
  });

  it("a paste (the host's table, copied): the linked doc gains the copy, the host is unchanged", async () => {
    const m = await mountEntered();
    s.root.dispatchEvent(pasteEvent({ [ROW_MIME]: rowPayload(s.handle.url, ["table"]) }));
    await settled();
    expect(namesIn(m.b)).toEqual(["Table"]);
    hostUnchanged(m);
  });

  it("a part from the bin: the linked doc gains it, the host is unchanged", async () => {
    const m = await mountEntered();
    s.api("scene.parts").run({ ext: "scene.parts", command: "parts", value: true });
    await settled();
    s.root.querySelector('.part[data-part="t.part"]').click();
    await settled();
    expect(namesIn(m.b)).toEqual(["Buoy"]);
    hostUnchanged(m);
  });

  it("a template from the start screen: the linked doc gains what it writes, the host is unchanged", async () => {
    const m = await mountEntered();
    s.root.querySelector('.add-start button[data-template="t.tpl"]').click();
    await settled();
    expect(namesIn(m.b)).toEqual(["Room"]);
    hostUnchanged(m);
  });
});

describe("undo is per focus doc across Enter and Leave (EDITOR.md, \"Undo\")", () => {
  it("entered, undo takes back the link's edit only; after Leave, the host's only; neither ever touches the other doc", async () => {
    const repo = new FakeRepo();
    const b = repo.add(emptyScene({ title: "B", objects: { card: object({ name: "Card" }) }, order: ["card"] }));
    const objects = { table: object({ name: "Table" }), L: link(b.url, { name: "B" }) };
    s = await mountStage({
      repo,
      editor: true,
      natives: true,
      extensions: [
        { meta: { id: "scene.select" }, module: select },
        { meta: { id: "scene.undo" }, module: undo },
      ],
      doc: { title: "A", objects, order: Object.keys(objects) },
    });
    const view = s.debug.view;
    await until(() => view.stages().some((x) => x.path.join("/") === "L"), 3000);
    s.edit(true);
    const run = (ext, command, target = null) => s.api("scene.undo").run({ ext, command, target });
    const has = (h, id) => !!h.doc().objects[id];

    // an edit in the host, then one entered in the link
    run("scene.select", "remove", "table");
    expect(has(s.handle, "table")).toBe(false);
    expect(view.enter(["L"])).toBe(true);
    await settled();
    run("scene.select", "remove", "card");
    expect([has(s.handle, "table"), has(b, "card")]).toEqual([false, false]);

    // entered: the link's edit comes back, the host's stays; then there is nothing more here
    const hostHeads = s.handle.heads();
    run("scene.undo", "undo");
    expect([has(s.handle, "table"), has(b, "card")]).toEqual([false, true]);
    run("scene.undo", "undo");
    expect([has(s.handle, "table"), has(b, "card")]).toEqual([false, true]);
    expect(s.handle.heads()).toEqual(hostHeads);

    // after Leave: the host's edit comes back, the link is left as it is; then nothing more
    view.leave();
    await settled();
    expect(view.atom.get().focus).toEqual([]);
    const linkHeads = b.heads();
    run("scene.undo", "undo");
    expect([has(s.handle, "table"), has(b, "card")]).toEqual([true, true]);
    const after = s.handle.heads();
    run("scene.undo", "undo");
    expect(s.handle.heads()).toEqual(after);
    expect(b.heads()).toEqual(linkHeads);
  });
});
