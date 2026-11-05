import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import keys, { invocationFor } from "./keys.js";

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

describe("invocationFor (pure)", () => {
  const cmds = (log) => [
    { id: "x", value: commandsExt("x", log).create().commands },
    { id: "y", value: commandsExt("y", log).create().commands },
  ];
  const scene = { objects: { a: { traits: { "test.flag": {} } }, b: {} } };
  it("tries the selection, the scene, then the hovered object; first in running order wins", () => {
    expect(
      invocationFor(cmds([]), "k", {
        scene,
        local: { hovered: "a", selected: "b" },
      }),
    ).toEqual({ ext: "x", command: "scene-k", target: null }); // the selection doesn't take it: the scene's does, before the hovered object's
    expect(
      invocationFor(cmds([]), "K", {
        scene,
        local: { hovered: "b", selected: "a" },
      }),
    ).toEqual({ ext: "x", command: "poke", target: "a" });
    expect(
      invocationFor(cmds([]), "k", {
        scene,
        local: { hovered: "b", selected: null },
      }),
    ).toEqual({ ext: "x", command: "scene-k", target: null });
    expect(
      invocationFor(cmds([]), "Backspace", {
        scene,
        local: { hovered: null, selected: "b" },
      }),
    ).toEqual({ ext: "x", command: "remove", target: "b" });
    expect(invocationFor(cmds([]), "Delete", { scene, local: {} })).toBeNull();
    expect(invocationFor(cmds([]), "n", { scene, local: {} })).toBeNull();
    // a selection that isn't an object (a ref) is offered first all the same:
    // its owner's command answers for it, never the hovered object's
    expect(invocationFor(cmds([]), "Delete", { scene, local: { hovered: "b", selected: "dimension:d1" } })).toEqual({ ext: "x", command: "remove", target: "dimension:d1" });
    const objectsOnly = [{ id: "z", value: [{ id: "remove", name: "Remove", key: "Delete", state: (t, { scene: sc }) => (sc.objects[t] ? {} : null), run() {} }] }];
    expect(invocationFor(objectsOnly, "Delete", { scene, local: { hovered: "b", selected: "dimension:d1" } })).toEqual({ ext: "z", command: "remove", target: "b" });
    // a hovered id that isn't in the scene is passed over
    expect(invocationFor(cmds([]), "k", { scene, local: { hovered: "gone" } })).toEqual({ ext: "x", command: "scene-k", target: null });
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
      kits: [{ id: "model", extensions: ["scene.keys", "t.one", "t.two"] }],
      doc: {
        objects: { a: object({ traits: { "test.flag": {} } }), b: object() },
        order: ["a", "b"],
      },
    });
  }, 30_000);
  afterEach(() => s.unmount());

  it("runs the command a key names, for the selection, else the scene, else what's under the pointer", async () => {
    s.local.swap((m) => ({ ...m, hovered: "a" }));
    expect(s.key("k").defaultPrevented).toBe(true); // the scene's k, before the hovered object's
    s.local.swap((m) => ({ ...m, hovered: null, selected: "a" }));
    s.key("K");
    s.local.swap((m) => ({ ...m, selected: "b" }));
    s.key("k");
    s.key("Delete", { code: "Delete" });
    expect(log).toEqual([
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
