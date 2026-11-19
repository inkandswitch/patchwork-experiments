import { describe, it, expect } from "vitest";
import { attentionPath, codeOfKey, codesOf, declaredKeys, hintFor, keyHolder, keyLayers, keyOfCode, labelOf, lookChain, mapInvocation, nameOfCode, reservedBy, resolveKey } from "./keymap.js";
import { keyContext, resolverState } from "./parts/resolver.js";
import { TOO_FAR, barEntries, commandState, flatCommands, keysOf } from "./parts/toolbar-commands.js";
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
    { id: "aboard", name: "Come aboard", key: "Enter", show: ["world"], state: (t) => (t == null ? {} : null), run() {} },
    // (keyed, on no surface: a key works with nothing showing it)
    { id: "anchor", name: "Drop anchor", key: "n", show: [], state: (t) => (t == null ? {} : null), run() {} },
  ] },
  { id: "dice", value: [{ id: "roll", name: "Roll", key: "r", state: on("crate"), run() {} }] },
  { id: "scene.measure", value: [{ id: "measure", name: "Measure", key: "m", tool: { pointer: true }, state: (t) => (t == null ? { checked: false } : null), run() {} }] },
  { id: "scene.select", value: [{ id: "remove", name: "Remove", key: ["Delete", "Backspace"], show: ["menu"], state: (t) => (t != null && scene.objects[t] ? {} : null), run() {} }] },
];

const WALK = ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "ShiftLeft"].map((code) => ({ code }));
const BODIES = [
  { id: "look", keys: [], reach: Infinity },
  { id: "walk", keys: WALK, reach: 2 },
  { id: "seat", keys: [], reach: 2 },
  { id: "station", keys: [{ code: "KeyA" }, { code: "KeyD" }], reach: 2.5 },
];
const GUN = { name: "gun", kind: "tool", keys: [{ code: "KeyR" }] };
const MEASURE = { name: "measure", kind: "tool", keys: [] };
const EDIT = { name: "Edit", kind: "edit", keys: [] };
// the hands held, top last: none, one tool, the editor under a tool, two tools either way up
const TOOLS = [[], [GUN], [MEASURE], [EDIT, MEASURE], [GUN, MEASURE], [MEASURE, GUN]];
const GESTURES = [null, { keys: CARRY_KEYS }];
// Attention and the look under it: with a selection, attention's hit is
// null but the look still decides the distance (and the point), so the
// cases include a look on the selected card farther than its box.
const ATTENTIONS = [
  { name: "selection card", attention: { selected: "card", hit: null }, look: null },
  { name: "selection card, look on it beyond its box", attention: { selected: "card", hit: null }, look: { id: "card", distance: 2.1 } },
  { name: "selection crate, look spoke", attention: { selected: "crate", hit: null }, look: { id: "spoke", distance: 1 } },
  { name: "look spoke", attention: { selected: null, hit: { id: "spoke", distance: 1 } } },
  { name: "look card", attention: { selected: null, hit: { id: "card", distance: 1 } } },
  { name: "look card, far", attention: { selected: null, hit: { id: "card", distance: 3 } } },
  { name: "null", attention: { selected: null, hit: null }, look: null },
];
const BOX = [1, 10]; // how far every target's box is
const ALL_KEYS = [...new Set(flatCommands(COLLECTED).flatMap(({ command }) => keysOf(command)).concat(["q", "e", "a", " ", "x"]))];

/**
 * A view plugin's api as resolver.js reads it, with one stage on the input
 * path (its reader). The reader's context measures distance as the stage's
 * does (stage.js distanceFrom): to the hit when it is on the target or
 * something attached to it, else to the target's box.
 */
function apiFor({ body, tool, gesture, attention, look, box }) {
  const reader = {
    stage: 0,
    path: [],
    collect: () => COLLECTED,
    attention: () => attention,
    look: () => (attention.selected == null ? attention.hit : look),
    context: (hit = null) => ({
      scene,
      local: {},
      view: { body },
      from: [0, 0, 0],
      reach: body.reach,
      hit,
      distance: (t) => (hit?.id != null && lookChain(hit.id, parents).includes(t) && Number.isFinite(hit.distance) ? hit.distance : box),
    }),
  };
  return {
    view: { get: () => ({ gesture, hands: tool, body }) },
    collect: () => COLLECTED,
    path: () => [reader],
    reader,
  };
}
/** The resolver's state, with its one segment's context and attention (one stage). */
const resolved = (api) => {
  const st = resolverState(api);
  return { ...st, ctx: st.segments[0].ctx, attention: st.segments[0].attention };
};

// Every surface's hints and the key map's dispatch use one state, built from
// attention by resolverState (keyContext): so the cases build it that way.
function* cases() {
  for (const body of BODIES)
    for (const tool of TOOLS)
      for (const gesture of GESTURES)
        for (const { name, attention, look = null } of ATTENTIONS)
          for (const d of BOX) {
            const api = apiFor({ body, tool, gesture, attention, look, box: d });
            yield { body, tool, gesture, name, d, api, state: resolved(api) };
          }
}

/** Every entry a surface shows, with its target: the prompt's, the menu's (object and scene) and the bar's (its editor's and world's clusters, as the bar works them out in this body). */
function shown(state) {
  const out = [];
  const p = promptEntries(state.collected, state.attention, state.ctx, Infinity);
  if (p) for (const e of p.entries) out.push({ ...e, target: p.target, surface: "prompt" });
  // the menu is on what was pressed: the selection's, or the hit itself
  const target = attentionPath(state.attention, scene.parents)[0] ?? null;
  const m = menuEntries(state.collected, target, state.ctx);
  for (const e of m.forObject) out.push({ ...e, target, surface: "menu" });
  for (const e of m.forScene) out.push({ ...e, target: null, surface: "menu" });
  const bar = barEntries([{ collected: state.collected, ctx: state.ctx }], state.ctx.view);
  for (const e of [...bar.editor, ...bar.world]) out.push({ ...e, target: null, surface: "bar" });
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
        // (in the one stage on the path: 0)
        expect(r.invocation).toEqual({ ext: e.ext, command: e.command.id, target: e.target, stage: 0 });
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
    expect(n).toBe(BODIES.length * TOOLS.length * GESTURES.length * ATTENTIONS.length * BOX.length);
    expect(hints).toBeGreaterThan(0);
  });

  it("the context is attention's: its hit, else the look, for hints and keys alike", () => {
    for (const c of cases()) {
      const { attention } = c.state;
      const look = c.api.reader.look();
      // the one place it's built
      expect(c.state.ctx.hit).toBe(attention.hit ?? look);
      expect(keyContext(c.api.reader, attention).hit).toBe(c.state.ctx.hit);
    }
    // seated (reach 2), a selected card whose box is 1 m off while the look is on it 2.1 m off: too far, for the hint and the key
    const draw = { ext: "tabletop", command: COLLECTED[0].value[0], target: "card" };
    const seated = (look) => resolved(apiFor({ body: BODIES[2], tool: null, gesture: null, attention: { selected: "card", hit: null }, look, box: 1 }));
    const far = seated({ id: "card", distance: 2.1 });
    expect(far.ctx.distance("card")).toBe(2.1);
    expect(hintFor(draw, far)).toBe("");
    expect(resolveKey({ key: "d", code: "KeyD" }, far)).toBe(null);
    expect(promptEntries(far.collected, far.attention, far.ctx).entries.find((e) => e.command.id === "draw").state.title).toBe(TOO_FAR);
    // the look elsewhere: the box decides, and D draws
    const near = seated({ id: "crate", distance: 5 });
    expect(hintFor(draw, near)).toBe("D");
    expect(resolveKey({ key: "d", code: "KeyD" }, near)).toEqual({ layer: "map", invocation: { ext: "tabletop", command: "draw", target: "card", stage: 0 } });
  });

  it("what reserves keys comes first: the gesture's, the topmost hand's that declares it, then the body's", () => {
    const gesture = { keys: CARRY_KEYS };
    const tool = { keys: [{ code: "KeyR" }, { code: "KeyF" }] };
    const over = { keys: [{ code: "KeyF" }, { code: "KeyG" }] };
    const body = { keys: WALK };
    expect(reservedBy("KeyF", { gesture, hands: [tool], body })).toBe("gesture");
    expect(reservedBy("KeyR", { gesture, hands: [tool], body })).toBe("hand");
    expect(reservedBy("KeyD", { gesture, hands: [tool], body })).toBe("body");
    expect(reservedBy("KeyM", { gesture, hands: [tool], body })).toBe(null);
    expect(reservedBy("KeyF", { hands: [tool], body })).toBe("hand");
    // two hands: each key is the topmost's that declares it, wherever the other is
    expect(keyHolder("KeyF", { hands: [tool, over], body }).layer).toBe(over);
    expect(keyHolder("KeyF", { hands: [over, tool], body }).layer).toBe(tool);
    expect(keyHolder("KeyR", { hands: [tool, over], body }).layer).toBe(tool);
    expect(keyHolder("KeyG", { hands: [over, tool], body }).layer).toBe(over);
    expect(keyLayers({ gesture, hands: [tool, over], body }).map((l) => l.layer)).toEqual([gesture, over, tool, body]);
  });

  it("walking, Draw shows without D and is in the menu; seated, D draws", () => {
    const at = (body) => ({ gesture: null, hands: [], body, collected: COLLECTED, ctx: { scene, local: {}, from: [0, 0, 0], reach: 2, distance: () => 1 }, attention: { selected: null, hit: { id: "card", distance: 1 } } });
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
    // a selection that isn't an object (a ref) is offered all the same: its owner's command answers for it, or nobody's
    const removeAny = [{ id: "z", value: [{ id: "remove", name: "Remove", key: "Delete", state: (t) => (t ? {} : null), run() {} }] }];
    expect(mapInvocation(removeAny, "Delete", ctx, { selected: "dimension:d1", hit: null })).toEqual({ ext: "z", command: "remove", target: "dimension:d1" });
    const objectsOnly = [{ id: "z", value: [{ id: "remove", name: "Remove", key: "Delete", state: (t, { scene: sc }) => (sc.objects[t] ? {} : null), run() {} }] }];
    expect(mapInvocation(objectsOnly, "Delete", ctx, { selected: "dimension:d1", hit: null })).toBeNull();
    // a looked-at id that isn't in the scene is passed over, for the scene
    const anyTarget = [{ id: "z", value: [{ id: "poke", name: "Poke", key: "k", state: () => ({}), run() {} }] }];
    expect(mapInvocation(anyTarget, "k", ctx, { selected: null, hit: { id: "gone" } })).toEqual({ ext: "z", command: "poke", target: null });
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

describe("a keys declaration, read once (declaredKeys, codesOf)", () => {
  it.each([
    ["bare codes and { code } entries", ["KeyQ", { code: "KeyE" }], [{ code: "KeyQ", label: null }, { code: "KeyE", label: null }]],
    ["a label", [{ code: "KeyW", label: "Forward" }], [{ code: "KeyW", label: "Forward" }]],
    ["an empty label is none", [{ code: "KeyQ", label: "" }], [{ code: "KeyQ", label: null }]],
    ["a code twice: its first place and label", [{ code: "KeyQ", label: "Ease" }, "KeyE", { code: "KeyQ", label: "Haul" }], [{ code: "KeyQ", label: "Ease" }, { code: "KeyE", label: null }]],
    ["no code, an empty code, a non-string", [null, {}, { code: "" }, { code: 3 }, "", "KeyF"], [{ code: "KeyF", label: null }]],
    ["not a list", undefined, []],
  ])("%s", (_, declared, entries) => {
    expect(declaredKeys(declared)).toEqual(entries);
    expect([...codesOf(declared)]).toEqual(entries.map((e) => e.code));
  });
});

/**
 * What Chrome sends as KeyboardEvent.key for each code a declaration in the
 * repo uses, on a US layout with no modifier held. Written from the UI
 * Events `code` and `key` tables, not from keymap.js's own.
 */
const CHROME = {
  KeyA: "a", KeyB: "b", KeyD: "d", KeyE: "e", KeyF: "f", KeyQ: "q", KeyR: "r", KeyS: "s", KeyW: "w", KeyX: "x", KeyZ: "z",
  Digit1: "1", Digit2: "2", Digit3: "3", Digit4: "4", Digit5: "5", Digit6: "6", Digit7: "7",
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  ShiftLeft: "Shift", ShiftRight: "Shift", AltLeft: "Alt", AltRight: "Alt", ControlLeft: "Control", ControlRight: "Control",
  Space: " ", Comma: ",", Period: ".", Enter: "Enter", Backspace: "Backspace",
};

describe("keyOfCode: the key a US keyboard sends", () => {
  it.each(Object.entries(CHROME))("%s sends %j (every code a declaration in the repo uses)", (code, key) => {
    expect(keyOfCode(code)).toBe(key);
  });

  // codeOfKey's inverse for every key it names (the same tables, read both ways)
  const NAMED = [
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => `Key${c}`),
    ..."0123456789".split("").map((d) => `Digit${d}`),
    "Space", "Period", "Comma", "Slash", "Semicolon", "Quote", "BracketLeft", "BracketRight", "Minus", "Equal", "Backquote", "Backslash",
    "Enter", "Escape", "Delete", "Backspace", "Tab", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Insert",
    ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ];
  it.each(NAMED)("codeOfKey(keyOfCode(%s)) is itself", (code) => {
    expect(codeOfKey(keyOfCode(code))).toBe(code);
  });

  it.each([
    ["MetaLeft", "Meta"],
    ["MetaRight", "Meta"],
    ["IntlBackslash", "Unidentified"],
    ["", "Unidentified"],
    [null, "Unidentified"],
  ])("%s sends %j", (code, key) => {
    expect(keyOfCode(code)).toBe(key);
  });
});

describe("nameOfCode: an unlabelled code as a person reads it", () => {
  it.each([
    ["KeyQ", "Q"],
    ["Digit3", "3"],
    ["ArrowUp", "↑"],
    ["ArrowDown", "↓"],
    ["ArrowLeft", "←"],
    ["ArrowRight", "→"],
    ["Space", "Space"],
    ["ShiftLeft", "Shift"],
    ["ShiftRight", "Shift"],
    ["AltLeft", "Alt"],
    ["ControlRight", "Control"],
    ["MetaLeft", "Meta"],
    ["Enter", "Enter"],
    ["Tab", "Tab"],
    ["Backspace", "⌫"],
    ["Escape", "Esc"],
    ["Comma", ","],
    ["IntlBackslash", "IntlBackslash"],
  ])("%s reads %j", (code, name) => {
    expect(nameOfCode(code)).toBe(name);
  });
});
