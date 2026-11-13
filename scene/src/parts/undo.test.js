// scene.undo, mounted: ⌘Z / Ctrl+Z and the toolbar's Undo and Redo take back
// the stage's own edits (here Delete, scene.select's), this viewer's; a
// package's verb (a roll) is never on it, and an edit since changed by one is
// left as the verb left it.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, settle } from "../test/stage-harness.js";
import undo, { undoKey } from "./undo.js";
import select from "./select.js";

const DICE = {
  meta: { id: "t.dice" },
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
    s = await mountStage({
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
    run("t.dice", "roll", "die");
    expect(s.local.get().edits).toEqual({ undo: null, redo: "Delete" });
    press("z", { metaKey: true, shiftKey: true });
    expect(s.doc().objects.die.transform.position).toEqual([4, 0, 4]);
    expect(s.local.get().notices.at(-1).text).toBe("Nothing to redo: “Delete” has been changed since.");
    expect(s.local.get().edits).toEqual({ undo: null, redo: null });
  });

  it("a field being typed in keeps ⌘Z (its own text undo)", async () => {
    s = await mountStage({ extensions: [{ meta: { id: "scene.undo" }, module: undo }], doc: { objects: { a: object() }, order: ["a"] } });
    await settle();
    s.api("scene.undo").edit((d) => (d.objects.a.name = "B"), { label: "Rename" });
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
