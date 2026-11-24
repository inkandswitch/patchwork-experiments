// Commands (./commands.js, STAGE.md, "Commands"): what applies, by the hand a
// command names, its state and its reach, read alike by `api.run` and every
// surface; and on the stage, a tool held for a kind of hand goes down with
// the last hand of that kind. Small inline plugins, no editor.
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("@inkandswitch/patchwork-plugins", () => import("../test/plugins-mock.js"));
import { TOO_FAR, commandState, flatCommands, inHand } from "./commands.js";
import { mountStage } from "../test/stage-harness.js";

const view = (...kinds) => ({ hands: kinds.map((kind) => ({ kind })) });

describe("commands: what applies", () => {
  it("flatCommands keeps what is a command (an id and a run), in running then command order, tagged with its stage", () => {
    const run = () => {};
    const got = flatCommands([
      { id: "x", value: [{ id: "a", run }, { id: "b" }, null, { run }] },
      { id: "y", value: new Set([{ id: "c", run }]), stage: 2 },
      { id: "z", value: 7 },
    ]);
    expect(got.map(({ ext, command, stage }) => [ext, command.id, stage])).toEqual([["x", "a", undefined], ["y", "c", 2]]);
  });

  // H14, its first half: the hand a command names × the kinds of hand held, written out; then what state says
  it("H14: a command naming a kind of hand applies only while a hand of that kind is held (never one of the kernel's own kinds); then, as for any command, its state decides", () => {
    // [the hand the command names, the kinds held (null: no view), whether it may apply]
    const HANDS = [
      [undefined, [], true],
      [undefined, ["k"], true],
      [undefined, null, true],
      ["k", [], false],
      ["k", ["k"], true],
      ["k", ["j"], false],
      ["k", ["j", "k"], true],
      ["k", ["k", "k"], true],
      ["k", null, false],
      ["tool", ["tool"], false],
      ["popover", ["popover"], false],
    ];
    // [state, its state for the scene, for an object]
    const STATES = [
      [undefined, {}, null],
      [() => null, null, null],
      [() => false, null, null],
      [() => ({ label: "L" }), { label: "L" }, { label: "L" }],
      [() => true, {}, {}],
      [
        () => {
          throw new Error("x");
        },
        null,
        null,
      ],
    ];
    for (const [hand, kinds, may] of HANDS) {
      const v = kinds && view(...kinds);
      for (const [state, forScene, forObject] of STATES) {
        const command = { id: "c", run() {}, ...(hand ? { hand } : {}), ...(state ? { state } : {}) };
        expect([hand, kinds, inHand(command, v)]).toEqual([hand, kinds, may]);
        expect(commandState(command, null, { view: v })).toEqual(may ? forScene : null);
        expect(commandState(command, "a", { view: v })).toEqual(may ? forObject : null);
      }
    }
  });

  // H9: reach × distance, for a command on a target; the scene has no distance
  it("H9: a reach command is enabled on a target within the body's reach; beyond it, disabled and too far; on the scene, and without reach, always", () => {
    for (const reach of [2, Infinity]) {
      for (const d of [1, 2, 3, Infinity, NaN]) {
        const ctx = { view: view(), reach, distance: () => d };
        const far = !(d <= reach) && reach !== Infinity;
        expect(commandState({ id: "c", reach: true, state: () => ({ label: "Draw" }), run() {} }, "a", ctx)).toEqual(far ? { label: "Draw", disabled: true, title: TOO_FAR } : { label: "Draw" });
        expect(commandState({ id: "c", reach: true, run() {} }, null, ctx)).toEqual({});
        expect(commandState({ id: "c", state: () => ({}), run() {} }, "a", ctx)).toEqual({});
      }
    }
  });
});

describe("commands: on the stage", () => {
  let s = null;
  afterEach(() => {
    s?.unmount();
    s = null;
  });

  /** An extension with a plain command, a tool for hand `k` and a tool for none; `log` hears runs and put-downs. */
  const commands = (log) => ({
    meta: { id: "t.cmds" },
    module: {
      create: () => ({
        commands: [
          { id: "c", hand: "k", run: () => log.push("c") },
          { id: "t", name: "T", hand: "k", tool: {}, run: () => ({ put: () => log.push("put t") }) },
          { id: "u", name: "U", tool: {}, run: () => ({ put: () => log.push("put u") }) },
        ],
      }),
    },
  });
  const HANDS = { meta: { id: "t.hands", type: "scene:view" }, module: { create: () => ({}) } };

  // H14, its second half
  it("H14: api.run runs a command naming a kind of hand only while one is held; a tool picked up through it is held for that kind and goes down with the last such hand, and no other tool does", async () => {
    const log = [];
    s = await mountStage({ extensions: [commands(log), HANDS], editor: false, natives: false });
    const api = s.api("t.cmds");
    const hands = s.api("t.hands");
    const run = (command, value) => api.run({ ext: "t.cmds", command, target: null, value });
    const held = () => s.local.get().held.map((t) => [t.name, t.handKind]);

    // no hand of kind k: neither runs
    expect([run("c"), run("t"), log, held()]).toEqual([false, false, [], []]);
    // one held: both run, the tool held for k; a tool for no hand beside it
    const put1 = hands.hand({ kind: "k", name: "K1" });
    expect([run("c"), run("t"), run("u")]).toEqual([true, true, true]);
    expect([log, held()]).toEqual([["c"], [["T", "k"], ["U", null]]]);
    // a second hand of kind k, then the first put down: T stays, there is still a k
    const put2 = hands.hand({ kind: "k", name: "K2" });
    put1();
    expect(held()).toEqual([["T", "k"], ["U", null]]);
    // the last k put down: T goes (told once), U stays; c no longer runs
    put2();
    expect([held(), log]).toEqual([[["U", null]], ["c", "put t"]]);
    expect(run("c")).toBe(false);
    // a hand of another kind changes nothing for k's commands; and a plain hand is held for no kind, whatever its spec says
    const put3 = hands.hand({ kind: "j", name: "J", hand: "k", handKind: "k" });
    expect(run("t")).toBe(false);
    // picked up again, running it again puts it down (a toggle), as any tool
    const put4 = hands.hand({ kind: "k", name: "K" });
    expect([run("t"), held()]).toEqual([true, [["U", null], ["T", "k"]]]);
    expect([run("t"), held()]).toEqual([true, [["U", null]]]);
    put4();
    expect(s.local.get().hands.map((h) => h.name)).toEqual(["U", "J"]);
    put3();
    expect(log).toEqual(["c", "put t", "put t"]);
  });

  // H14, its second half, by the other ways a hand goes: Escape, and its plugin stopping
  it("H14: a hand of the kind going by Escape, or by its view plugin stopping, takes the tools held for it, once the last of its kind goes", async () => {
    const log = [];
    s = await mountStage({ extensions: [commands(log), HANDS], editor: false, natives: false });
    const api = s.api("t.cmds");
    const hands = s.api("t.hands");
    const run = (command) => api.run({ ext: "t.cmds", command, target: null });
    const held = () => s.local.get().held.map((t) => t.name);
    const escape = () => s.key("Escape", { code: "Escape" });
    const K = (name) => hands.hand({ kind: "k", name, escape: () => false });
    // [K, T]: Escape takes the top, T, then K; nothing is left
    K("K");
    expect(run("t")).toBe(true);
    escape();
    expect([held(), log]).toEqual([[], ["put t"]]);
    escape();
    expect(s.local.get().hands).toEqual([]);
    // [K1, T, K2]: Escape takes K2, and T stays (K1 is of its kind)
    K("K1");
    run("t");
    K("K2");
    escape();
    expect([s.local.get().hands.map((h) => h.name), held()]).toEqual([["K1", "T"], ["T"]]);
    // K1's view plugin stops: K1 goes, and T with it
    await s.uninstall("t.hands");
    expect([s.local.get().hands, held(), log]).toEqual([[], [], ["put t", "put t"]]);
  });
});
