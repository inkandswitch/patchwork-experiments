import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import keys from "./keys.js";
import { mapInvocation } from "../keymap.js";

/** Commands keyed on k for flagged objects, and on k / Escape / Delete for the scene. */
function commandsExt(id, log) {
  return {
    create() {
      return {
        commands: [
          {
            id: "poke",
            name: "Poke",
            key: "k",
            state: (t, { scene }) => (t != null && scene.objects[t]?.traits?.["test.flag"] ? {} : null),
            run: (t) => log.push([id, "poke", t]),
          },
          {
            id: "scene-k",
            name: "Scene K",
            key: "K",
            run: (t) => log.push([id, "scene-k", t]),
          },
          {
            id: "remove",
            name: "Remove",
            key: ["Delete", "Backspace"],
            state: (t) => (t != null ? {} : null),
            run: (t) => log.push([id, "remove", t]),
          },
          {
            id: "never",
            name: "Never",
            key: "n",
            state: () => ({ disabled: true }),
            run: () => log.push([id, "never"]),
          },
        ],
      };
    },
  };
}

describe("the key map's invocation (pure: ../keymap.js mapInvocation)", () => {
  const cmds = (log) => [
    { id: "x", value: commandsExt("x", log).create().commands },
    { id: "y", value: commandsExt("y", log).create().commands },
  ];
  const scene = { objects: { a: { traits: { "test.flag": {} } }, b: {} }, parents: new Map() };
  const ctx = { scene, local: {} };
  it("tries attention's path (the selection, else the look), then the scene; first in running order wins", () => {
    // the selection doesn't take it: the scene's does (the look plays no part while something is selected)
    expect(mapInvocation(cmds([]), "k", ctx, { selected: "b", hit: null })).toEqual({ ext: "x", command: "scene-k", target: null });
    expect(mapInvocation(cmds([]), "K", ctx, { selected: "a", hit: null })).toEqual({ ext: "x", command: "poke", target: "a" });
    // nothing selected: what is looked at, then the scene
    expect(mapInvocation(cmds([]), "k", ctx, { selected: null, hit: { id: "a" } })).toEqual({ ext: "x", command: "poke", target: "a" });
    expect(mapInvocation(cmds([]), "k", ctx, { selected: null, hit: { id: "b" } })).toEqual({ ext: "x", command: "scene-k", target: null });
    expect(mapInvocation(cmds([]), "Backspace", ctx, { selected: "b", hit: null })).toEqual({ ext: "x", command: "remove", target: "b" });
    expect(mapInvocation(cmds([]), "Delete", ctx, {})).toBeNull();
    expect(mapInvocation(cmds([]), "n", ctx, {})).toBeNull();
    // a selection that isn't an object (a ref) is offered all the same: its owner's command answers for it
    expect(mapInvocation(cmds([]), "Delete", ctx, { selected: "dimension:d1", hit: null })).toEqual({ ext: "x", command: "remove", target: "dimension:d1" });
    const objectsOnly = [{ id: "z", value: [{ id: "remove", name: "Remove", key: "Delete", state: (t, { scene: sc }) => (sc.objects[t] ? {} : null), run() {} }] }];
    expect(mapInvocation(objectsOnly, "Delete", ctx, { selected: "dimension:d1", hit: null })).toBeNull();
    // a looked-at id that isn't in the scene is passed over
    expect(mapInvocation(cmds([]), "k", ctx, { selected: null, hit: { id: "gone" } })).toEqual({ ext: "x", command: "scene-k", target: null });
  });
});

describe("scene.keys", () => {
  let s, log;
  beforeEach(async () => {
    log = [];
    s = await mountStage({
      extensions: [
        { meta: { id: "scene.keys" }, module: keys },
        { meta: { id: "t.one" }, module: commandsExt("one", log) },
        { meta: { id: "t.two" }, module: commandsExt("two", log) },
      ],
      doc: {
        objects: { a: object({ traits: { "test.flag": {} } }), b: object() },
        order: ["a", "b"],
      },
    });
  }, 30_000);
  afterEach(() => s.unmount());

  it("runs the command a key names, on attention's path (the selection, else what's under the pointer), then the scene", async () => {
    s.local.swap((m) => ({ ...m, hovered: "a" }));
    expect(s.key("k").defaultPrevented).toBe(true); // the hovered object's k
    s.local.swap((m) => ({ ...m, hovered: "b" }));
    s.key("k"); // b has no k: the scene's
    s.local.swap((m) => ({ ...m, hovered: null, selected: "a" }));
    s.key("K");
    s.local.swap((m) => ({ ...m, selected: "b", hovered: "a" }));
    s.key("k"); // the selection is attention: the hovered a plays no part
    s.key("Delete", { code: "Delete" });
    expect(log).toEqual([
      ["one", "poke", "a"],
      ["one", "scene-k", null],
      ["one", "poke", "a"],
      ["one", "scene-k", null],
      ["one", "remove", "b"],
    ]);
  });

  it("leaves ctrl/meta keys, repeats, and keys nothing answers to alone", () => {
    expect(s.key("k", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(s.key("k", { metaKey: true }).defaultPrevented).toBe(false);
    expect(s.key("z").defaultPrevented).toBe(false);
    expect(s.key("n").defaultPrevented).toBe(false); // disabled everywhere
    expect(s.key("k", { repeat: true }).defaultPrevented).toBe(true); // claimed, not run again
    expect(log).toEqual([]);
  });

  it("leaves a field's keys to the field", () => {
    const input = document.createElement("input");
    s.root.append(input);
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "k",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(log).toEqual([]);
  });
});
