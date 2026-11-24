// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import keys from "./keys.js";

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
});
