// @vitest-environment happy-dom
// scene.undo, mounted: ⌘Z / Ctrl+Z and the toolbar's Undo and Redo take back
// the editor's own edits (here Delete, scene.select's; ./editor.js), this viewer's; a
// package's verb (a roll) is never on it, and an edit since changed by one is
// left as the verb left it.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import { FakeRepo } from "../test/fake-repo.js";
import undo, { undoKey } from "./undo.js";
import select from "./select.js";
import { editor } from "./editor.js";

const DICE = {
  meta: { id: "t.roller" },
  module: {
    create: (api) => ({
      commands: [
        {
          id: "roll",
          name: "Roll",
          state: (t, { scene }) => (scene?.objects?.[t] ? {} : null),
          run: (t) =>
            api.change((d) => {
              d.objects[t].transform.position = [4, 0, 4];
            }),
        },
      ],
    }),
  },
};

let s = null;
afterEach(() => {
  s?.unmount();
  s = null;
  vi.restoreAllMocks();
});

const press = (key, extra = {}) => {
  const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key, code: `Key${key.toUpperCase()}`, ...extra });
  s.root.dispatchEvent(e);
  return e;
};

describe("scene.undo", () => {
  it("edits: a package's write to its own doc is a step here, which Undo and Redo take back and again; what its doc leaves out of its patches stays; refused where the scene can't be written", async () => {
    const repo = new FakeRepo();
    const model = repo.add({ content: "a", cad: { locks: {} } });
    // the doc as the package hands it over: its change says what it wrote, without the locks
    const doc = {
      url: model.url,
      doc: () => model.doc(),
      change(fn) {
        let out = [];
        model.change(fn, { patchCallback: (p) => void (out = p) });
        return out.filter((p) => p.path[0] !== "cad");
      },
    };
    s = await mountStage({ editor: true, natives: true,  repo, extensions: [{ meta: { id: "scene.undo" }, module: undo }, { meta: { id: "t.pkg" }, module: { create: () => ({}) } }], doc: { objects: {} } });
    await settle();
    const edits = s.api("t.pkg").use("edits");
    expect(edits.edit(doc, (d) => { d.content = "b"; d.cad.locks.x = ["h"]; }, { label: "Edit model" })).toBe(true);
    expect(model.doc()).toEqual({ content: "b", cad: { locks: { x: ["h"] } } });
    const state = (id) => s.instance("scene.undo").commands.find((c) => c.id === id).state(null);
    expect(state("undo")).toMatchObject({ title: "Undo “Edit model”" });
    s.api("scene.undo").run({ ext: "scene.undo", command: "undo", target: null });
    expect(model.doc()).toEqual({ content: "a", cad: { locks: { x: ["h"] } } });
    s.api("scene.undo").run({ ext: "scene.undo", command: "redo", target: null });
    expect(model.doc().content).toBe("b");
    s.handle.isReadOnly = () => true;
    expect(edits.edit(doc, (d) => (d.content = "c"))).toBe(false);
    expect(model.doc().content).toBe("b");
  });

  it("undoKey: ⌘Z / Ctrl+Z undo, with Shift redo, Ctrl+Y redo; nothing else", () => {
    expect(undoKey({ key: "z", metaKey: true })).toBe("undo");
    expect(undoKey({ key: "Z", ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(undoKey({ key: "y", ctrlKey: true })).toBe("redo");
    expect(undoKey({ key: "y", metaKey: true })).toBeNull();
    expect(undoKey({ key: "z" })).toBeNull();
    expect(undoKey({ key: "z", metaKey: true, altKey: true })).toBeNull();
  });

  it("Delete is an edit: ⌘Z puts it back, ⇧⌘Z takes it out again; a roll is no step, and a rolled die isn't deleted again by redo", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    s = await mountStage({ editor: true, natives: true, 
      extensions: [
        { meta: { id: "scene.select" }, module: select },
        { meta: { id: "scene.undo" }, module: undo },
        DICE,
      ],
      doc: { objects: { die: object({ name: "Die" }) }, order: ["die"] },
    });
    await settle();
    const run = (ext, command, target = null) => s.api("scene.undo").run({ ext, command, target });
    const state = (id) => s.instance("scene.undo").commands.find((c) => c.id === id).state(null);
    expect(state("undo")).toMatchObject({ disabled: true });
    run("scene.select", "remove", "die");
    expect(s.doc().objects.die).toBeUndefined();
    expect(state("undo")).toEqual({ title: "Undo “Delete”" });
    expect(press("z", { metaKey: true }).defaultPrevented).toBe(true);
    expect(s.doc().objects.die.name).toBe("Die");
    expect(s.doc().order).toEqual(["die"]);
    expect(state("redo")).toEqual({ title: "Redo “Delete”" });
    // the die is rolled: no step of its own, and redo can't delete what the roll has moved since
    run("t.roller", "roll", "die");
    expect(editor(s.facet("scene.undo")).labels()).toEqual({ undo: null, redo: "Delete" });
    press("z", { metaKey: true, shiftKey: true });
    expect(s.doc().objects.die.transform.position).toEqual([4, 0, 4]);
    expect(s.notices().at(-1).text).toBe("Nothing to redo: “Delete” has been changed since.");
    expect(editor(s.facet("scene.undo")).labels()).toEqual({ undo: null, redo: null });
  });

  it("a field being typed in keeps ⌘Z (its own text undo)", async () => {
    s = await mountStage({ editor: true, natives: true,  extensions: [{ meta: { id: "scene.undo" }, module: undo }], doc: { objects: { a: object() }, order: ["a"] } });
    await settle();
    editor(s.facet("scene.undo")).edit((d) => (d.objects.a.name = "B"), { label: "Rename" });
    const input = document.createElement("input");
    s.root.append(input);
    const e = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", metaKey: true });
    input.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    expect(s.doc().objects.a.name).toBe("B");
    press("z", { ctrlKey: true });
    expect(s.doc().objects.a.name).toBe("Object");
  });
});

// Undo's plain rule over reveals: a step that changed who may see something
// is taken back like any other, whoever has a stake; a step that removed
// something a keeper holds says what it can't put back.
describe("the keeper rule", () => {
  it("deleting something a keeper holds the contents of: undo puts the doc's part back and says the kept part is as its keeper has it now", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const KEEPER = { meta: { id: "t.keeper", keeper: "plain", traits: ["t.kept"] }, module: { create: () => ({}) } };
    s = await mountStage({ editor: true, natives: true, 
      extensions: [{ meta: { id: "scene.select" }, module: select }, { meta: { id: "scene.undo" }, module: undo }, KEEPER],
      doc: { objects: { c1: object({ name: "Card", traits: { "t.kept": { by: "automerge:box", slot: 3 } } }), d: object({ name: "Die" }) }, order: ["c1", "d"] },
    });
    await settle();
    const run = (command, target) => s.api("scene.undo").run({ ext: "scene.select", command, target });
    run("remove", "c1");
    expect(s.doc().objects.c1).toBeUndefined();
    expect(editor(s.facet("scene.undo")).undo()).toBe(true);
    expect(s.doc().objects.c1.traits["t.kept"]).toEqual({ by: "automerge:box", slot: 3 });
    expect(s.notices().at(-1).text).toBe("Undid “Delete”: what is kept for “Card” comes back as its keeper has it now, not as it was.");
    // something no keeper holds: undone without a word
    const before = s.notices().length;
    run("remove", "d");
    expect(editor(s.facet("scene.undo")).undo()).toBe(true);
    expect(s.notices().length).toBe(before);
  });
});
