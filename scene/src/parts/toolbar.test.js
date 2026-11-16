import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object } from "../test/stage-harness.js";
import toolbar from "./toolbar.js";
import { keyMatches, keyLabel, commandState, shownOn, flatCommands, barEntries, barShown, onBar } from "./toolbar-commands.js";

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
            id: "shade",
            name: "Shade",
            key: ["g", "r"],
            state: (t, { local }) =>
              t == null
                ? {
                    value: local.shade ?? "flat",
                    choices: [
                      { value: "flat", label: "Flat" },
                      { value: "smooth", label: "Smooth" },
                      { value: null, label: "None" },
                    ],
                  }
                : null,
            run: (_t, v) => (log.push(["shade", v]), api.local.swap((m) => ({ ...m, shade: v }))),
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
        { meta: { id: "scene.toolbar" }, module: toolbar },
        { meta: { id: "t.tools" }, module: fakeTools(log) },
      ],
      doc: { objects: { a: object() }, order: ["a"] },
    });
  }, 30_000);
  afterEach(() => s.unmount());

  const bar = () => s.root.querySelector('.stage-edge[data-edge="top"] .toolbar');
  const control = (id) => bar().querySelector(`[data-command="${id}"]`);

  it("shows the scene's toolbar commands in order: buttons, toggles, pickers", () => {
    const ids = [...bar().querySelectorAll("[data-command]")].map((e) => e.dataset.command);
    expect(ids).toEqual(["frame", "grid", "shade", "off"]);
    expect(control("frame").tagName).toBe("BUTTON");
    expect(control("frame").title).toBe("Frame all (F)");
    expect(control("grid").getAttribute("aria-pressed")).toBe("true");
    expect(control("shade").tagName).toBe("SELECT");
    expect(control("shade").title).toBe("Shade (G)");
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
    const shade = control("shade");
    shade.selectedIndex = 2;
    shade.dispatchEvent(new Event("change"));
    expect(log.at(-1)).toEqual(["shade", null]);
    await s.settle();
    expect(s.local.get().shade).toBeNull();
    expect(control("shade").selectedIndex).toBe(2);
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
    expect(control("frame")).toBeTruthy();
    await s.uninstall("t.tools");
    expect(bar()).toBeTruthy();
    expect(bar().querySelectorAll("[data-command]")).toHaveLength(0);
  });
});

// The bar of tools (TOOLS.md §6, Decisions 10): the editor's commands only
// in Edit, the world's in every body. (B1) outside Edit it holds exactly
// the world commands that apply, never an editor command; (B2) in Edit the
// editor's, then the world's; (B3) it shows ⇔ it holds an editor command or
// a world command is declared for this body, whatever that command's state.
const LOOK = { body: { id: "look" } };
const EDIT = { body: { id: "edit" } };
const WALK = { body: { id: "walk" } };
const ctxIn = (view) => ({ scene: { objects: {} }, local: {}, view });
const segIn = (view, commands, stage) => ({ stage, collected: [{ id: "t.x", value: commands }], ctx: ctxIn(view) });

describe("the bar of tools, exhaustively", () => {
  // show × body × edit flag: which cluster a command (applying to the scene) lands in.
  // Each string is (look, look+edit:true, edit, edit+edit:true, walk, walk+edit:true):
  // "w" the world's, "e" the editor's, "-" not on the bar.
  const SHOWS = [
    ["absent", undefined, "--ee--"],
    ["[]", [], "------"],
    ['["toolbar"]', ["toolbar"], "--ee--"],
    ['["world"]', ["world"], "w-www-"],
    ['["toolbar","world"]', ["toolbar", "world"], "w-www-"],
    ['["menu"]', ["menu"], "------"],
    ['"world"', "world", "w-www-"],
  ];
  const COLUMNS = [
    [LOOK, false],
    [LOOK, true],
    [EDIT, false],
    [EDIT, true],
    [WALK, false],
    [WALK, true],
  ];

  it("show × body × edit flag (42 rows): outside Edit only world commands; in Edit the editor's too; edit: true only in Edit", () => {
    let n = 0;
    for (const [name, show, expected] of SHOWS) {
      COLUMNS.forEach(([view, edit], i) => {
        const command = { id: "c", name: "C", run() {}, ...(show === undefined ? {} : { show }), ...(edit ? { edit: true } : {}) };
        const { editor, world } = barEntries([segIn(view, [command])], view);
        const got = world.length ? "w" : editor.length ? "e" : "-";
        expect(editor.length + world.length, name).toBeLessThanOrEqual(1);
        expect(`${name} ${view.body.id}${edit ? " edit" : ""} ${got}`).toBe(`${name} ${view.body.id}${edit ? " edit" : ""} ${expected[i]}`);
        // onBar is the surface's half, before state and edit: true (commandState's)
        expect(onBar(command, view), name).toBe(expected[i - (i % 2)] !== "-");
        n++;
      });
    }
    expect(n).toBe(42);
  });

  // body × an editor command running × a world command declared × it applies now (only if declared): 12 rows.
  const ROWS = [
    // body, editor runs, declared, applies, shown, editor ids, world ids
    [LOOK, false, false, null, false, [], []],
    [LOOK, false, true, false, true, [], []],
    [LOOK, false, true, true, true, [], ["w"]],
    [LOOK, true, false, null, false, [], []],
    [LOOK, true, true, false, true, [], []],
    [LOOK, true, true, true, true, [], ["w"]],
    [EDIT, false, false, null, false, [], []],
    [EDIT, false, true, false, true, [], []],
    [EDIT, false, true, true, true, [], ["w"]],
    [EDIT, true, false, null, true, ["ed"], []],
    [EDIT, true, true, false, true, ["ed"], []],
    [EDIT, true, true, true, true, ["ed"], ["w"]],
  ];

  it("body × editor command × world declared × applying (12 rows): shown ⇔ an editor entry or a declared world command, whatever its state", () => {
    for (const [view, ed, declared, applies, shown, eds, ws] of ROWS) {
      const commands = [
        ...(ed ? [{ id: "ed", name: "Snap", show: ["toolbar"], edit: true, run() {} }] : []),
        ...(declared ? [{ id: "w", name: "Play", show: ["world", "menu"], state: (t) => (t == null && applies ? {} : null), run() {} }] : []),
      ];
      const entries = barEntries([segIn(view, commands)], view);
      const row = [view.body.id, ed, declared, applies];
      expect([...row, barShown(entries), entries.editor.map((e) => e.command.id), entries.world.map((e) => e.command.id)]).toEqual([...row, shown, eds, ws]);
      expect(entries.declared).toBe(declared);
    }
  });

  it("a world command that is the editor's (edit: true) declares nothing outside Edit", () => {
    const command = { id: "w", show: ["world"], edit: true, run() {} };
    expect(barEntries([segIn(LOOK, [command])], LOOK)).toEqual({ editor: [], world: [], declared: false });
    expect(barEntries([segIn(EDIT, [command])], EDIT).declared).toBe(true);
  });

  it("across the focus path: the focus's first, then outward; each entry tagged with its stage, once per stage/extension/id", () => {
    const w = (id) => ({ id, show: ["world"], run() {} });
    const e = (id) => ({ id, show: ["toolbar"], run() {} });
    const segs = [segIn(EDIT, [w("deal"), e("snap"), w("deal")], 2), segIn(EDIT, [e("frame"), w("ring")], 0)];
    const { editor, world } = barEntries(segs, EDIT);
    expect(editor.map((x) => [x.stage, x.command.id])).toEqual([[2, "snap"], [0, "frame"]]);
    expect(world.map((x) => [x.stage, x.command.id])).toEqual([[2, "deal"], [0, "ring"]]);
    // the same command in another stage is another entry
    expect(barEntries([segIn(LOOK, [w("deal")], 1), segIn(LOOK, [w("deal")], 0)], LOOK).world.map((x) => x.stage)).toEqual([1, 0]);
  });
});

/** A game's commands: a world command whose state toggles (Play, until playing), an editor command, and a body to walk in. */
function fakeGame(log) {
  return {
    create(api) {
      return {
        commands: [
          { id: "play", name: "Play", show: ["world", "menu"], state: (t, { local }) => (t == null && !local.playing ? {} : null), run: () => (log.push("play"), api.local.swap((m) => ({ ...m, playing: true }))) },
          { id: "snap", name: "Snap", show: ["toolbar"], edit: true, run: () => log.push("snap") },
        ],
        bodies: [{ id: "t.walk", label: "Walk", reach: 2, enter: () => ({ input: {}, leave() {} }) }],
      };
    },
  };
}

describe("the bar of tools in every body", () => {
  let s, log;
  beforeEach(async () => {
    localStorage.clear();
    log = [];
    s = await mountStage({
      extensions: [
        { meta: { id: "scene.toolbar" }, module: toolbar },
        { meta: { id: "t.game" }, module: fakeGame(log) },
      ],
      doc: { objects: { a: object() }, order: ["a"] },
    });
  }, 30_000);
  afterEach(() => s.unmount());

  const edge = () => s.root.querySelector('.stage-edge-part[data-owner="scene.toolbar"]');
  const ids = (cluster) => [...s.root.querySelectorAll(`.toolbar .${cluster} [data-command]`)].map((e) => e.dataset.command);

  it("Look → Edit → a walk → Look, playing or not: the world's Play in every body, Snap only in Edit, and the bar never hides", async () => {
    const api = s.api("t.game");
    let n = 0;
    for (const [body, path] of [["look", ["look"]], ["edit", ["edit"]], ["t.walk", ["look", "t.walk"]], ["look", ["look"]]]) {
      for (const playing of [false, true]) {
        api.body.enter("look");
        s.local.swap((m) => ({ ...m, playing }));
        await s.settle();
        for (const id of path) expect(api.body.enter(id)).toBe(true);
        await s.settle();
        expect(s.local.get().body.id).toBe(body);
        const want = { tools: body === "edit" ? ["snap"] : [], world: playing ? [] : ["play"], hidden: false };
        expect({ body, playing, tools: ids("tools"), world: ids("world"), hidden: edge().hidden }).toEqual({ body, playing, ...want });
        n++;
      }
    }
    expect(n).toBe(8);
  });

  it("clicking the world's button runs it, outside Edit; it goes when it no longer applies and the bar stays", async () => {
    s.api("t.game").body.enter("look");
    await s.settle();
    s.root.querySelector('.toolbar .world [data-command="play"]').click();
    expect(log).toEqual(["play"]);
    await s.settle();
    expect(ids("world")).toEqual([]);
    expect(edge().hidden).toBe(false);
  });

  it("a plain scene, looking, has no bar: nothing declares a world command", async () => {
    await s.uninstall("t.game");
    s.api("scene.toolbar").body.enter("look");
    await s.settle();
    expect(edge().hidden).toBe(true);
  });
});

// In a narrow view the toolbar wrapped to a second row, so the canvas under
// it lost height whenever the view narrowed or a command came on offer. It is
// one row that scrolls sideways: no rule on the bar or its row wraps, and
// no control shrinks to fit (it would squash a label instead of scrolling).
describe("the toolbar is one row at any width", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const css = readFileSync(fileURLToPath(import.meta.url).replace(/toolbar\.test\.js$/, "toolbar.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim().replace(/\s+/g, " "), body }));
  const rule = (pred) => rules.find((r) => pred(r.sel.replace(/:where\(.*$/, "").trim()));
  it("the bar doesn't wrap and scrolls sideways", () => {
    const bar = rule((s) => s.endsWith(".toolbar"));
    expect(bar.body).toMatch(/flex-wrap:\s*nowrap/);
    expect(bar.body).toMatch(/overflow-x:\s*auto/);
    // no scrollbar to come and go with the commands on offer (it would change the bar's height)
    expect(bar.body).toMatch(/scrollbar-width:\s*none/);
    expect(rule((s) => s.includes("::-webkit-scrollbar"))?.body).toMatch(/display:\s*none/);
  });
  it("its row doesn't wrap, and its controls keep their size", () => {
    expect(rule((s) => s.endsWith(".toolbar .tools")).body).toMatch(/flex-wrap:\s*nowrap/);
    expect(rule((s) => s.endsWith(".toolbar .tools >")).body).toMatch(/flex-shrink:\s*0/);
  });
  it("the world's cluster keeps to the right, doesn't wrap, and is a button tall when empty", () => {
    const world = rule((s) => s.endsWith(".toolbar .world"));
    expect(world.body).toMatch(/margin-left:\s*auto/);
    expect(world.body).toMatch(/flex-wrap:\s*nowrap/);
    expect(world.body).toMatch(/min-height:\s*calc\(1lh \+ 8px\)/);
    expect(rule((s) => s.endsWith(".toolbar .world >")).body).toMatch(/flex-shrink:\s*0/);
  });
  it("no rule here makes anything wrap", () => {
    for (const r of rules) expect(r.body, r.sel).not.toMatch(/flex-wrap:\s*wrap/);
  });
});
