import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { PLAY, mountStage, object } from "../test/stage-harness.js";
import toolbar from "./toolbar.js";
import { keyMatches, keyLabel, commandState, shownOn, flatCommands } from "./toolbar-commands.js";

/** A stand-in extension with a button, a toggle (a pref), a picker and an object-only command. */
function fakeTools(log) {
  return {
    create(api) {
      return {
        commands: [
          {
            id: "frame",
            name: "Frame all",
            key: "f",
            run: () => log.push("frame"),
          },
          {
            id: "grid",
            name: "Grid",
            state: (t) => (t == null ? { checked: !!api.pref("grid", true) } : null),
            run: (_t, v) => (log.push(["grid", v]), api.setPref("grid", v)),
          },
          {
            id: "tool",
            name: "Tool",
            key: ["g", "r"],
            state: (t, { local }) =>
              t == null
                ? {
                    value: local.tool ?? "move",
                    choices: [
                      { value: "move", label: "Move" },
                      { value: "rotate", label: "Rotate" },
                      { value: null, label: "No gizmo" },
                    ],
                  }
                : null,
            run: (_t, v) => (log.push(["tool", v]), api.local.swap((m) => ({ ...m, tool: v }))),
          },
          {
            id: "poke",
            name: "Poke",
            state: (t) => (t ? {} : null),
            run: (t) => log.push(["poke", t]),
          },
          {
            id: "menuonly",
            name: "Menu only",
            show: ["menu"],
            run: () => log.push("menuonly"),
          },
          {
            id: "off",
            name: "Not now",
            state: (t) => (t == null ? { disabled: true } : null),
            run: () => log.push("off"),
          },
        ],
      };
    },
  };
}

describe("command helpers", () => {
  it("match keys (letters in either case), label them, and read state and show", () => {
    expect(keyMatches({ key: "m" }, "M")).toBe(true);
    expect(keyMatches({ key: ["Delete", "Backspace"] }, "Backspace")).toBe(true);
    expect(keyMatches({ key: "Escape" }, "escape")).toBe(false);
    expect(keyLabel({ key: "m" })).toBe("M");
    expect(keyLabel({ key: "Escape" })).toBe("Esc");
    expect(commandState({ run() {} }, null, {})).toEqual({});
    expect(commandState({ run() {} }, "a", {})).toBeNull();
    expect(
      commandState(
        {
          state: () => {
            throw new Error("x");
          },
          run() {},
        },
        null,
        {},
      ),
    ).toBeNull();
    expect(shownOn({ show: ["menu"] }, "toolbar")).toBe(false);
    expect(shownOn({}, "toolbar")).toBe(true);
    expect(shownOn({}, "menu", { strict: true })).toBe(false);
    expect(flatCommands([{ id: "x", value: [{ id: "a", run() {} }, { id: "b" }, null] }]).map((c) => c.command.id)).toEqual(["a"]);
  });
});

describe("scene.toolbar", () => {
  let s, log;
  beforeEach(async () => {
    localStorage.clear();
    log = [];
    s = await mountStage({
      extensions: [
        { meta: { id: "scene.toolbar", activities: ["edit"] }, module: toolbar },
        { meta: { id: "t.tools" }, module: fakeTools(log) },
        PLAY,
      ],
      doc: { objects: { a: object() }, order: ["a"] },
    });
  }, 30_000);
  afterEach(() => s.unmount());

  const bar = () => s.root.querySelector('.stage-edge[data-edge="top"] .toolbar');
  const control = (id) => bar().querySelector(`[data-command="${id}"]`);

  it("shows the scene's toolbar commands in order: buttons, toggles, pickers", () => {
    const ids = [...bar().querySelectorAll("[data-command]")].map((e) => e.dataset.command);
    expect(ids).toEqual(["frame", "grid", "tool", "off"]);
    expect(control("frame").tagName).toBe("BUTTON");
    expect(control("frame").title).toBe("Frame all (F)");
    expect(control("grid").getAttribute("aria-pressed")).toBe("true");
    expect(control("tool").tagName).toBe("SELECT");
    expect(control("tool").title).toBe("Tool (G)");
    expect(control("off").disabled).toBe(true);
  });

  it("runs a button, flips a toggle, and passes a picker's value as given", async () => {
    control("frame").click();
    expect(log).toEqual(["frame"]);
    const grid = control("grid");
    grid.click();
    expect(log.at(-1)).toEqual(["grid", false]);
    await s.settle();
    expect(s.local.get().prefs.grid).toBe(false);
    expect(control("grid")).toBe(grid); // updated in place
    expect(grid.getAttribute("aria-pressed")).toBe("false");
    const tool = control("tool");
    tool.selectedIndex = 2;
    tool.dispatchEvent(new Event("change"));
    expect(log.at(-1)).toEqual(["tool", null]);
    await s.settle();
    expect(s.local.get().tool).toBeNull();
    expect(control("tool").selectedIndex).toBe(2);
    control("off").click();
    expect(log).not.toContain("off");
  });

  it("leaves the DOM alone when nothing it shows changed (a hover)", async () => {
    const before = [...bar().querySelectorAll("[data-command]")];
    s.local.swap((m) => ({ ...m, hovered: "a" }));
    await s.settle();
    expect([...bar().querySelectorAll("[data-command]")]).toEqual(before);
  });

  it("drops an extension's controls when it stops", async () => {
    await s.activity("play");
    expect(s.root.querySelector(".toolbar")).toBeNull();
    await s.activity("edit");
    expect(control("frame")).toBeTruthy();
  });
});
