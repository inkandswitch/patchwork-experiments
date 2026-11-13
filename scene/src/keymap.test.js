import { describe, it, expect } from "vitest";
import { attentionPath, codeOfKey, hintFor, labelOf, mapInvocation, reservedBy, resolveKey } from "./keymap.js";
import { TOO_FAR, applicable, commandState, flatCommands, keysOf } from "./parts/toolbar-commands.js";
import { promptEntries } from "./parts/use.js";
import { menuEntries } from "./parts/menu.js";
import { CARRY_KEYS } from "./parts/carry.js";

// A table with a card on it, a wheel's spoke attached to its helm, and a
// crate: every kind of command the surfaces show, from several extensions.
const parents = new Map([
  ["card", "table"],
  ["spoke", "helm"],
]);
const scene = { objects: { table: {}, card: {}, helm: {}, spoke: {}, crate: {} }, parents };
const on = (...ids) => (t) => (ids.includes(t) ? {} : null);
const COLLECTED = [
  { id: "tabletop", value: [
    { id: "draw", name: "Draw", key: "d", reach: true, state: on("card"), run() {} },
    { id: "shuffle", name: "Shuffle", key: "s", state: on("card"), run() {} },
    { id: "reveal", name: "Reveal", state: on("card"), run() {} },
    { id: "wash", name: "Wash", key: "w", state: (t) => (t === "table" ? { disabled: true } : null), run() {} },
  ] },
  { id: "scene.carry", value: [{ id: "flip", name: "Flip", key: "f", state: on("card", "crate"), run() {} }] },
  { id: "sailing", value: [
    { id: "helm", name: "Take the helm", key: "f", reach: true, state: on("helm"), run() {} },
    { id: "aboard", name: "Come aboard", key: "Enter", show: [], state: (t) => (t == null ? {} : null), run() {} },
  ] },
  { id: "dice", value: [{ id: "roll", name: "Roll", key: "r", state: on("crate"), run() {} }] },
  { id: "scene.measure", value: [{ id: "measure", name: "Measure", key: "m", tool: { pointer: true }, state: (t) => (t == null ? { checked: false } : null), run() {} }] },
  { id: "scene.select", value: [{ id: "remove", name: "Remove", key: ["Delete", "Backspace"], show: ["menu"], state: (t) => (t != null && scene.objects[t] ? {} : null), run() {} }] },
];

const WALK = ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft"].map((code) => ({ code }));
const BODIES = [
  { id: "orbit", keys: [], reach: Infinity },
  { id: "walk", keys: WALK, reach: 2 },
  { id: "seat", keys: [], reach: 2 },
  { id: "station", keys: [{ code: "KeyA" }, { code: "KeyD" }], reach: 2.5 },
];
const TOOLS = [null, { name: "gun", keys: [{ code: "KeyR" }] }, { name: "measure", keys: [] }];
const GESTURES = [null, { keys: CARRY_KEYS }];
const ATTENTIONS = [
  { name: "selection card", attention: { selected: "card", hit: null } },
  { name: "selection crate", attention: { selected: "crate", hit: null } },
  { name: "look spoke", attention: { selected: null, hit: { id: "spoke", distance: 1 } } },
  { name: "look card", attention: { selected: null, hit: { id: "card", distance: 1 } } },
  { name: "null", attention: { selected: null, hit: null } },
];
const REACH = [1, 10];
const ALL_KEYS = [...new Set(flatCommands(COLLECTED).flatMap(({ command }) => keysOf(command)).concat(["q", "e", "a", " ", "x"]))];

function* cases() {
  for (const body of BODIES)
    for (const tool of TOOLS)
      for (const gesture of GESTURES)
        for (const { name, attention } of ATTENTIONS)
          for (const d of REACH) {
            const ctx = { scene, local: {}, from: [0, 0, 0], reach: body.reach, hit: attention.hit, distance: () => d };
            yield { body, tool, gesture, name, d, state: { gesture, tool, body, collected: COLLECTED, ctx, attention } };
          }
}

/** Every entry a surface shows, with its target: the prompt's, the menu's (object and scene) and the bar's. */
function shown(state) {
  const out = [];
  const p = promptEntries(state.collected, state.attention, state.ctx, Infinity);
  if (p) for (const e of p.entries) out.push({ ...e, target: p.target, surface: "prompt" });
  // the menu is on what was pressed: the selection's, or the hit itself
  const target = attentionPath(state.attention, scene.parents)[0] ?? null;
  const m = menuEntries(state.collected, target, state.ctx);
  for (const e of m.forObject) out.push({ ...e, target, surface: "menu" });
  for (const e of m.forScene) out.push({ ...e, target: null, surface: "menu" });
  for (const e of applicable(flatCommands(state.collected), null, state.ctx, "toolbar")) out.push({ ...e, target: null, surface: "bar" });
  return out;
}

describe("the key resolver (H3), exhaustively", () => {
  it("a shown key works: every hint dispatches exactly its entry, and every dispatch's entry hints the key; each key reaches ≤1 invocation", () => {
    let n = 0;
    let hints = 0;
    for (const c of cases()) {
      n++;
      // hint ⇒ dispatch
      for (const e of shown(c.state)) {
        const h = hintFor({ ext: e.ext, command: e.command, target: e.target }, c.state);
        if (!h) continue;
        hints++;
        const k = keysOf(e.command).find((x) => labelOf(x) === h);
        const r = resolveKey({ key: k, code: codeOfKey(k) }, c.state);
        expect(r?.layer).toBe("map");
        expect(r.invocation).toEqual({ ext: e.ext, command: e.command.id, target: e.target });
        // a disabled entry never shows a key: it doesn't run
        expect(!!e.state.disabled).toBe(false);
      }
      // dispatch ⇒ hint
      for (const k of ALL_KEYS) {
        const r = resolveKey({ key: k, code: codeOfKey(k) }, c.state);
        if (r?.layer !== "map") continue;
        const entry = flatCommands(COLLECTED).find((x) => x.ext === r.invocation.ext && x.command.id === r.invocation.command);
        const h = hintFor({ ext: entry.ext, command: entry.command, target: r.invocation.target }, c.state);
        expect(h).not.toBe("");
        // and the key that hint names goes to the same invocation
        const hk = keysOf(entry.command).find((x) => labelOf(x) === h);
        expect(resolveKey({ key: hk, code: codeOfKey(hk) }, c.state).invocation).toEqual(r.invocation);
      }
    }
    expect(n).toBe(BODIES.length * TOOLS.length * GESTURES.length * ATTENTIONS.length * REACH.length);
    expect(hints).toBeGreaterThan(0);
  });

  it("what reserves keys comes first: the gesture's, the tool's, then the body's", () => {
    const gesture = { keys: CARRY_KEYS };
    const tool = { keys: [{ code: "KeyR" }, { code: "KeyF" }] };
    const body = { keys: WALK };
    expect(reservedBy("KeyF", { gesture, tool, body })).toBe("gesture");
    expect(reservedBy("KeyR", { gesture, tool, body })).toBe("tool");
    expect(reservedBy("KeyD", { gesture, tool, body })).toBe("body");
    expect(reservedBy("KeyM", { gesture, tool, body })).toBe(null);
    expect(reservedBy("KeyF", { tool, body })).toBe("tool");
  });

  it("walking, Draw shows without D and is in the menu; seated, D draws", () => {
    const at = (body) => ({ gesture: null, tool: null, body, collected: COLLECTED, ctx: { scene, local: {}, from: [0, 0, 0], reach: 2, distance: () => 1 }, attention: { selected: null, hit: { id: "card", distance: 1 } } });
    const draw = { ext: "tabletop", command: COLLECTED[0].value[0], target: "card" };
    expect(hintFor(draw, at(BODIES[1]))).toBe("");
    expect(menuEntries(COLLECTED, "card", at(BODIES[1]).ctx).forObject.some((e) => e.command.id === "draw")).toBe(true);
    expect(hintFor(draw, at(BODIES[2]))).toBe("D");
  });

  it("a look at a spoke reaches the helm's verbs where the spoke has none; a selection is its own path", () => {
    const ctx = { scene, local: {}, reach: Infinity, distance: () => 0 };
    expect(attentionPath({ selected: null, hit: { id: "spoke" } }, parents)).toEqual(["spoke", "helm"]);
    expect(attentionPath({ selected: "table", hit: { id: "spoke" } }, parents)).toEqual(["table"]);
    expect(mapInvocation(COLLECTED, "f", ctx, { selected: null, hit: { id: "spoke" } })).toEqual({ ext: "sailing", command: "helm", target: "helm" });
    // Delete removes what is looked at, never what it is attached to
    expect(mapInvocation(COLLECTED, "Delete", ctx, { selected: null, hit: { id: "spoke" } })).toEqual({ ext: "scene.select", command: "remove", target: "spoke" });
    expect(promptEntries(COLLECTED, { selected: null, hit: { id: "spoke" } }, ctx).target).toBe("helm");
    // the path first, then the scene: Enter comes aboard from anywhere
    expect(mapInvocation(COLLECTED, "Enter", ctx, { selected: "card", hit: null })).toEqual({ ext: "sailing", command: "aboard", target: null });
  });

  it("Escape is no command's", () => {
    expect(resolveKey({ key: "Escape", code: "Escape" }, { collected: COLLECTED, ctx: { scene, local: {} }, attention: {} })).toBe(null);
  });
});

describe("reach (H9), exhaustively", () => {
  it("a reach command applies ⇔ its distance ≤ the body's reach; else it shows disabled, too far, on every surface, and no key runs it", () => {
    let n = 0;
    for (const body of BODIES) {
      for (const hit of [{ id: "card", distance: 1.5 }, null]) {
        for (const d of [1.5, 3, Infinity]) {
          n++;
          const ctx = { scene, local: {}, from: [0, 0, 0], reach: body.reach, hit, distance: () => d };
          const attention = { selected: hit ? null : "card", hit };
          const inReach = d <= body.reach;
          const draw = COLLECTED[0].value[0];
          const st = commandState(draw, "card", ctx);
          expect(!!st.disabled).toBe(!inReach);
          expect(st.title === TOO_FAR).toBe(!inReach);
          // prompt and menu show it either way, disabled out of reach
          const p = promptEntries(COLLECTED, attention, ctx, Infinity);
          expect(!!p.entries.find((e) => e.command.id === "draw").state.disabled).toBe(!inReach);
          expect(!!menuEntries(COLLECTED, "card", ctx).forObject.find((e) => e.command.id === "draw").state.disabled).toBe(!inReach);
          // the key map runs it only in reach (D is the walk body's, so ask the map itself)
          expect(mapInvocation(COLLECTED, "d", ctx, attention)).toEqual(inReach ? { ext: "tabletop", command: "draw", target: "card" } : null);
        }
      }
    }
    expect(n).toBe(BODIES.length * 2 * 3);
  });
});
