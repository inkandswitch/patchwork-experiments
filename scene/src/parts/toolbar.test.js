// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { mountStage, object, posesBy } from "../test/stage-harness.js";
import toolbar, { GROUPS, groupOf } from "./toolbar.js";
import { keyMatches, keyLabel, shownOn, barEntries, onBar } from "./toolbar-commands.js";
import { commandState, flatCommands } from "../stage/commands.js";

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
            state: (t) => (t == null ? { checked: !!api.use("prefs").get("grid", true) } : null),
            run: (_t, v) => (log.push(["grid", v]), api.use("prefs").set("grid", v)),
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
    // (Select is the editor's, its tools group first: the scene starts in Edit)
    expect(ids).toEqual(["select-tool", "frame", "grid", "shade", "off"]);
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
    expect(s.local.get()["scene.prefs"].grid).toBe(false);
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

  it("a mouse press on a button keeps the focus where it was; on a picker it opens it, as ever", () => {
    for (const [id, prevented] of [["frame", true], ["grid", true], ["shade", false]]) {
      const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      control(id).dispatchEvent(press);
      expect([id, press.defaultPrevented]).toEqual([id, prevented]);
    }
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
    expect([...bar().querySelectorAll("[data-command]")].map((e) => e.dataset.command)).toEqual(["select-tool"]);
  });
});

// The bar of tools (EDITOR.md, "The interface", Decisions 10): the editor's commands only
// while editing, the world's always. (B1) not editing it holds exactly the
// world commands that apply, never an editor command; (B2) editing, the
// editor's, then the world's; (B3) it shows ⇔ some command on the path is
// the bar's now, whatever that command's state. (`name` names the row.)
const LOOK = { name: "look", body: { id: "look" }, hands: [] };
const EDIT = { name: "edit", body: { id: "look" }, hands: [{ kind: "edit", name: "Edit" }] };
const WALK = { name: "walk", body: { id: "walk" }, hands: [] };
const ctxIn = (view) => ({ scene: { objects: {} }, local: {}, view });
const segIn = (view, commands, stage) => ({ stage, collected: [{ id: "t.x", value: commands }], ctx: ctxIn(view) });

describe("the bar of tools, exhaustively", () => {
  // show × body × the Edit hand named: which cluster a command (applying to the scene) lands in.
  // Each string is (look, look+hand, edit, edit+hand, walk, walk+hand):
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

  it("show × body × the Edit hand named (42 rows): outside Edit only world commands; in Edit the editor's too; hand: \"edit\" only in Edit", () => {
    let n = 0;
    for (const [name, show, expected] of SHOWS) {
      COLUMNS.forEach(([view, edit], i) => {
        const command = { id: "c", name: "C", run() {}, ...(show === undefined ? {} : { show }), ...(edit ? { hand: "edit" } : {}) };
        const { editor, world } = barEntries([segIn(view, [command])], view);
        const got = world.length ? "w" : editor.length ? "e" : "-";
        expect(editor.length + world.length, name).toBeLessThanOrEqual(1);
        expect(`${name} ${view.name}${edit ? " edit" : ""} ${got}`).toBe(`${name} ${view.name}${edit ? " edit" : ""} ${expected[i]}`);
        // onBar is the surface's half, before the hand and the state (commandState's)
        expect(onBar(command, view), name).toBe(expected[i - (i % 2)] !== "-");
        n++;
      });
    }
    expect(n).toBe(42);
  });

  // body × the editor's command (none, there but not applying, applying) × a
  // world command (likewise): 18 rows. One rule for both clusters: the bar
  // shows while a command that is the bar's in this body is there, applying
  // or not; only what applies has a control.
  const ROWS = [
    // body, editor's, world's, shown, editor ids, world ids
    [LOOK, "none", "none", false, [], []],
    [LOOK, "none", "there", true, [], []],
    [LOOK, "none", "applies", true, [], ["w"]],
    [LOOK, "there", "none", false, [], []],
    [LOOK, "there", "there", true, [], []],
    [LOOK, "there", "applies", true, [], ["w"]],
    [LOOK, "applies", "none", false, [], []],
    [LOOK, "applies", "there", true, [], []],
    [LOOK, "applies", "applies", true, [], ["w"]],
    [EDIT, "none", "none", false, [], []],
    [EDIT, "none", "there", true, [], []],
    [EDIT, "none", "applies", true, [], ["w"]],
    [EDIT, "there", "none", true, [], []],
    [EDIT, "there", "there", true, [], []],
    [EDIT, "there", "applies", true, [], ["w"]],
    [EDIT, "applies", "none", true, ["ed"], []],
    [EDIT, "applies", "there", true, ["ed"], []],
    [EDIT, "applies", "applies", true, ["ed"], ["w"]],
  ];

  it("body × editor's command × world command, each none/there/applying (18 rows): shown ⇔ one is there, whatever its state", () => {
    const state = (kind) => (t) => (t == null && kind === "applies" ? {} : null);
    for (const [view, ed, w, shown, eds, ws] of ROWS) {
      const commands = [
        ...(ed !== "none" ? [{ id: "ed", name: "Snap", show: ["toolbar"], hand: "edit", state: state(ed), run() {} }] : []),
        ...(w !== "none" ? [{ id: "w", name: "Play", show: ["world", "menu"], state: state(w), run() {} }] : []),
      ];
      const entries = barEntries([segIn(view, commands)], view);
      const row = [view.name, ed, w];
      expect([...row, entries.shown, entries.editor.map((e) => e.command.id), entries.world.map((e) => e.command.id)]).toEqual([...row, shown, eds, ws]);
    }
    expect(ROWS).toHaveLength(18);
  });

  it("a world command that is the editor's (hand: \"edit\") keeps no bar outside Edit", () => {
    const command = { id: "w", show: ["world"], hand: "edit", run() {} };
    expect(barEntries([segIn(LOOK, [command])], LOOK)).toEqual({ editor: [], world: [], shown: false });
    expect(barEntries([segIn(EDIT, [command])], EDIT).shown).toBe(true);
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
          { id: "snap", name: "Snap", show: ["toolbar"], hand: "edit", run: () => log.push("snap") },
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

  it("Look and a walk, editing or not, playing or not: the world's Play always, Select and Snap only while editing, and the bar never hides", async () => {
    const api = s.api("t.game");
    let n = 0;
    for (const [body, path] of [["look", ["look"]], ["t.walk", ["look", "t.walk"]]]) {
      for (const edit of [false, true]) {
        for (const playing of [false, true]) {
          api.body.enter("look");
          s.local.swap((m) => ({ ...m, playing }));
          await s.settle();
          for (const id of path) expect(api.body.enter(id)).toBe(true);
          s.edit(edit);
          await s.settle();
          expect(s.local.get().body.id).toBe(body);
          // (Select is the editor's resting tool; this game's Snap is a command of its own, with no group)
          const want = { tools: edit ? ["select-tool", "snap"] : [], world: playing ? [] : ["play"], hidden: false };
          expect({ body, edit, playing, tools: ids("tools"), world: ids("world"), hidden: edge().hidden }).toEqual({ body, edit, playing, ...want });
          n++;
        }
      }
    }
    expect(n).toBe(8);
  });

  it("clicking the world's button runs it, not editing; it goes when it no longer applies and the bar stays", async () => {
    s.edit(false);
    await s.settle();
    s.root.querySelector('.toolbar .world [data-command="play"]').click();
    expect(log).toEqual(["play"]);
    await s.settle();
    expect(ids("world")).toEqual([]);
    expect(edge().hidden).toBe(false);
  });

  it("a plain scene, looking, has no bar: nothing declares a world command", async () => {
    await s.uninstall("t.game");
    s.edit(false);
    await s.settle();
    expect(edge().hidden).toBe(true);
  });
});

// The editor's groups (PLANS.md §5): each command in its `group`'s run, the runs in GROUPS
// order; an `icon` drawn as it, named by its label; settings behind the gear, in a popover.
describe("scene.toolbar: groups, icons, settings", () => {
  let s = null;
  const cmd = (id, group, extra = {}) => ({ id, name: id[0].toUpperCase() + id.slice(1), group, hand: "edit", show: ["toolbar"], state: (t) => (t == null ? {} : null), run: () => {}, ...extra });
  const GROUPED = {
    meta: { id: "t.grouped" },
    module: {
      create: () => ({
        commands: [cmd("bounds", "view", { icon: "bounds", state: (t) => (t == null ? { checked: true } : null) }), cmd("units", "settings", { state: (t) => (t == null ? { value: "m", choices: [{ value: "m", label: "m" }, { value: "mm", label: "mm" }] } : null) }), cmd("redo", "history", { icon: "redo" }), cmd("wave", undefined), cmd("undo", "history", { icon: "undo" }), cmd("panel", "panels")],
      }),
    },
  };
  afterEach(() => s?.unmount());
  const runs = () => [...s.root.querySelectorAll(".toolbar .bar-group:not([hidden])")].map((g) => [g.dataset.group, ...[...g.querySelectorAll("[data-command]")].map((e) => e.dataset.command)]);

  it("each command in its group, the groups in order (panels on the drawer's rail); icons named by their label; settings in the gear's popover", async () => {
    s = await mountStage({ extensions: [{ meta: { id: "scene.toolbar" }, module: toolbar }, GROUPED], doc: { objects: {}, order: [] } });
    await s.settle();
    // (within a group: running order, then the order commands are declared in)
    expect(runs()).toEqual([["history", "redo", "undo"], ["tools", "select-tool"], ["other", "wave"], ["view", "bounds"], ["settings", "units"]]);
    // the panels are the drawer's rail's, not the bar's
    expect([...s.root.querySelectorAll(".stage-panel-rail [data-command]")].map((b) => b.dataset.command)).toEqual(["panel"]);
    expect(GROUPS).toEqual(["history", "tools", "other", "panels", "view", "settings"]);
    const undo = s.root.querySelector('.toolbar [data-command="undo"]');
    expect([undo.querySelector("svg") != null, undo.getAttribute("aria-label"), undo.textContent]).toEqual([true, "Undo", ""]);
    expect(s.root.querySelector('.toolbar [data-command="bounds"]').getAttribute("aria-pressed")).toBe("true");
    expect(s.root.querySelector('.toolbar [data-command="wave"]').textContent).toBe("Wave");
    // the gear opens the popover, and a press outside it shuts it
    const gear = s.root.querySelector(".toolbar .settings-toggle");
    const pop = s.root.querySelector(".toolbar .settings-popover");
    expect([pop.hidden, pop.querySelector(".setting .setting-name").textContent]).toEqual([true, "Units"]);
    gear.click();
    expect([pop.hidden, gear.getAttribute("aria-expanded")]).toEqual([false, "true"]);
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(pop.hidden).toBe(true);
    expect(groupOf({ group: "nonsense" })).toBe("other");
  });

  it("Select is checked exactly while no editor's tool is held, and picking it puts Move down", async () => {
    const halo = (await import("./halo.js")).default;
    s = await mountStage({ extensions: [{ meta: { id: "scene.toolbar" }, module: toolbar }, { meta: { id: "scene.halo" }, module: halo }, posesBy({ hold: () => true, release: () => {}, heldBy: () => null })], doc: { objects: {}, order: [] } });
    await s.settle();
    const pressed = (id) => s.root.querySelector(`.toolbar [data-command="${id}"]`).getAttribute("aria-pressed");
    expect([pressed("select-tool"), pressed("move")]).toEqual(["true", "false"]);
    s.root.querySelector('.toolbar [data-command="move"]').click();
    await s.settle();
    expect([pressed("select-tool"), pressed("move"), s.local.get().held.map((t) => t.command)]).toEqual(["false", "true", ["move"]]);
    s.root.querySelector('.toolbar [data-command="select-tool"]').click();
    await s.settle();
    expect([pressed("select-tool"), pressed("move"), s.local.get().held]).toEqual(["true", "false", []]);
  });
});

