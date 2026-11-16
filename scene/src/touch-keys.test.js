import { describe, it, expect } from "vitest";
import { keyOf, nameOf, touchControls } from "./touch-keys.js";
import { codeOfKey, reservedBy } from "./keymap.js";
import { CARRY_KEYS } from "./parts/carry.js";
import { EDIT, LOOK } from "./stage/bodies.js";

// Every keys declaration in the repo, copied as literals (scene can't import
// another package). Re-copy when one changes.
const L = (pairs) => pairs.map(([code, label]) => ({ code, label }));
const codes = (list) => list.map((code) => ({ code }));

/** walk/src/body.js WALK_KEYS */
const WALK_KEYS = L([["KeyW", "Forward"], ["KeyA", "Left"], ["KeyS", "Back"], ["KeyD", "Right"], ["ArrowUp", "Forward"], ["ArrowDown", "Back"], ["ArrowLeft", "Left"], ["ArrowRight", "Right"], ["ShiftLeft", "Run"], ["ShiftRight", "Run"], ["Space", "Jump"]]);
/** sailing/src/crew.js walkKeys: MOVE_KEYS, unlabelled */
const ABOARD_KEYS = codes(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"]);
/** sailing/src/stations.js, as crew.js's station body declares them (bare codes) */
const POST_KEYS = codes(["KeyQ", "KeyE", "KeyR", "KeyF"]); // the mainsheet, or the mast with the sheet led there
const MAST_KEYS = codes(["KeyR", "KeyF"]); // the mast, the halyard only
const WINCH_KEYS = codes(["KeyQ", "KeyE", "KeyR", "KeyB", "KeyF"]);
const HELM_KEYS = codes(["KeyA", "KeyD", "ArrowLeft", "ArrowRight", "KeyQ", "KeyE", "KeyR", "KeyB", "KeyF"]);
/** arena/src/play.js GUN_KEYS */
const GUN_KEYS = L([["KeyR", "Reload"]]);
/** machine/src/patchwork/input.js KEYS.doom */
const DOOM_KEYS = L([
  ["ArrowUp", "Forward"], ["ArrowDown", "Back"], ["ArrowLeft", "Turn left"], ["ArrowRight", "Turn right"],
  ["KeyW", "Forward"], ["KeyS", "Back"], ["KeyA", "Strafe left"], ["KeyD", "Strafe right"],
  ["Comma", "Strafe left"], ["Period", "Strafe right"], ["AltLeft", "Strafe"], ["AltRight", "Strafe"],
  ["ShiftLeft", "Run"], ["ShiftRight", "Run"], ["ControlLeft", "Fire"], ["ControlRight", "Fire"],
  ["Space", "Use"], ["KeyE", "Use"],
  ["Digit1", "Weapon"], ["Digit2", "Weapon"], ["Digit3", "Weapon"], ["Digit4", "Weapon"], ["Digit5", "Weapon"], ["Digit6", "Weapon"], ["Digit7", "Weapon"],
]);
/** machine/src/patchwork/input.js KEYS.snes */
const SNES_KEYS = L([
  ["ArrowUp", "Up"], ["ArrowDown", "Down"], ["ArrowLeft", "Left"], ["ArrowRight", "Right"],
  ["KeyZ", "B"], ["KeyX", "A"], ["KeyA", "Y"], ["KeyS", "X"], ["KeyQ", "L"], ["KeyW", "R"],
  ["Enter", "Start"], ["ShiftRight", "Select"], ["Backspace", "Select"],
]);

// Look, Edit and a seat all declare [] (stage/bodies.js, seats/src/body.js): one row.
const BODIES = { none: [], walk: WALK_KEYS, aboard: ABOARD_KEYS, post: POST_KEYS, mast: MAST_KEYS, winch: WINCH_KEYS, helm: HELM_KEYS };
// bag's drawn piece declares CARRY_KEYS (bag/src/extension.js); the machine's pad declares its kind's KEYS
const TOOLS = { none: null, gun: GUN_KEYS, piece: CARRY_KEYS, doom: DOOM_KEYS, snes: SNES_KEYS };
// the open gesture: scene's carry (and bag's hand, the same CARRY_KEYS)
const GESTURES = { none: null, carry: CARRY_KEYS };

/** What Chrome sends as KeyboardEvent.key for each code in the repo, no modifier held (scene/probes/cdp.mjs keyDown's table, inverted). */
const CHROME = {
  KeyA: "a", KeyB: "b", KeyD: "d", KeyE: "e", KeyF: "f", KeyQ: "q", KeyR: "r", KeyS: "s", KeyW: "w", KeyX: "x", KeyZ: "z",
  Digit1: "1", Digit2: "2", Digit3: "3", Digit4: "4", Digit5: "5", Digit6: "6", Digit7: "7",
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  ShiftLeft: "Shift", ShiftRight: "Shift", AltLeft: "Alt", AltRight: "Alt", ControlLeft: "Control", ControlRight: "Control",
  Space: " ", Comma: ",", Period: ".", Enter: "Enter", Backspace: "Backspace",
};

const CARRY = "g.KeyQ=Turn left, g.KeyE=Turn right, g.KeyF=Turn over, g.AltLeft=Place freely";
const DOOM = "t.ArrowUp=Forward@up, t.ArrowDown=Back@down, t.ArrowLeft=Turn left@left, t.ArrowRight=Turn right@right, t.KeyA=Strafe left, t.KeyD=Strafe right";
const DOOM_REST = "t.ShiftLeft=Run, t.ControlLeft=Fire, t.Space=Use, t.Digit1=Weapon"; // after Strafe (AltLeft), which a carry takes
const SNES = "t.ArrowUp=Up@up, t.ArrowDown=Down@down, t.ArrowLeft=Left@left, t.ArrowRight=Right@right, t.KeyZ=B, t.KeyX=A, t.KeyA=Y, t.KeyS=X";
const SNES_REST = "t.KeyW=R, t.Enter=Start, t.ShiftRight=Select"; // after L (KeyQ), which a carry takes
const WALK = "b.KeyW=Forward@up, b.KeyA=Left@left, b.KeyS=Back@down, b.KeyD=Right@right, b.ShiftLeft=Run, b.Space=Jump";
const ABOARD = "b.KeyW=W, b.KeyA=A, b.KeyS=S, b.KeyD=D, b.ArrowUp=↑@up, b.ArrowDown=↓@down, b.ArrowLeft=←@left, b.ArrowRight=→@right, b.ShiftLeft=Shift, b.Space=Space";

// Each case's controls, in order: from (g)esture, (t)ool or (b)ody, the code
// pressed, the label, and the pad slot if any. Shorthands are each
// layer's controls when nothing before it shadows any of its keys.
const J = (...parts) => parts.filter(Boolean).join(", ");
const EXPECTED = {
  "none|none|none": "",
  "none|none|carry": CARRY,
  "none|gun|none": "t.KeyR=Reload",
  "none|gun|carry": J(CARRY, "t.KeyR=Reload"),
  "none|piece|none": "t.KeyQ=Turn left, t.KeyE=Turn right, t.KeyF=Turn over, t.AltLeft=Place freely",
  "none|piece|carry": CARRY, // the gesture shadows every key the piece declares
  "none|doom|none": J(DOOM, "t.AltLeft=Strafe", DOOM_REST),
  "none|doom|carry": J(CARRY, DOOM, DOOM_REST), // Alt is the carry's: no Strafe
  "none|snes|none": J(SNES, "t.KeyQ=L", SNES_REST),
  "none|snes|carry": J(CARRY, SNES, SNES_REST), // Q is the carry's: no L

  "walk|none|none": WALK,
  "walk|none|carry": J(CARRY, WALK),
  "walk|gun|none": J("t.KeyR=Reload", WALK),
  "walk|gun|carry": J(CARRY, "t.KeyR=Reload", WALK),
  "walk|piece|none": J("t.KeyQ=Turn left, t.KeyE=Turn right, t.KeyF=Turn over, t.AltLeft=Place freely", WALK),
  "walk|piece|carry": J(CARRY, WALK),
  "walk|doom|none": J(DOOM, "t.AltLeft=Strafe", DOOM_REST), // the pad takes every key walk declares
  "walk|doom|carry": J(CARRY, DOOM, DOOM_REST),
  // the pad takes W, A, S, ShiftRight and every arrow: walk keeps D (Right, a button: the pad holds the right place), ShiftLeft, Space
  "walk|snes|none": J(SNES, "t.KeyQ=L", SNES_REST, "b.KeyD=Right, b.ShiftLeft=Run, b.Space=Jump"),
  "walk|snes|carry": J(CARRY, SNES, SNES_REST, "b.KeyD=Right, b.ShiftLeft=Run, b.Space=Jump"),

  "aboard|none|none": ABOARD,
  "aboard|none|carry": J(CARRY, ABOARD),
  "aboard|gun|none": J("t.KeyR=Reload", ABOARD),
  "aboard|gun|carry": J(CARRY, "t.KeyR=Reload", ABOARD),
  "aboard|piece|none": J("t.KeyQ=Turn left, t.KeyE=Turn right, t.KeyF=Turn over, t.AltLeft=Place freely", ABOARD),
  "aboard|piece|carry": J(CARRY, ABOARD),
  "aboard|doom|none": J(DOOM, "t.AltLeft=Strafe", DOOM_REST),
  "aboard|doom|carry": J(CARRY, DOOM, DOOM_REST),
  "aboard|snes|none": J(SNES, "t.KeyQ=L", SNES_REST, "b.KeyD=D, b.ShiftLeft=Shift, b.Space=Space"),
  "aboard|snes|carry": J(CARRY, SNES, SNES_REST, "b.KeyD=D, b.ShiftLeft=Shift, b.Space=Space"),

  "post|none|none": "b.KeyQ=Q, b.KeyE=E, b.KeyR=R, b.KeyF=F",
  "post|none|carry": J(CARRY, "b.KeyR=R"), // the carry's Q, E, F over the post's
  "post|gun|none": "t.KeyR=Reload, b.KeyQ=Q, b.KeyE=E, b.KeyF=F", // the gun's R over the post's
  "post|gun|carry": J(CARRY, "t.KeyR=Reload"),
  "post|piece|none": J("t.KeyQ=Turn left, t.KeyE=Turn right, t.KeyF=Turn over, t.AltLeft=Place freely", "b.KeyR=R"),
  "post|piece|carry": J(CARRY, "b.KeyR=R"),
  "post|doom|none": J(DOOM, "t.AltLeft=Strafe", DOOM_REST, "b.KeyQ=Q, b.KeyR=R, b.KeyF=F"),
  "post|doom|carry": J(CARRY, DOOM, DOOM_REST, "b.KeyR=R"),
  "post|snes|none": J(SNES, "t.KeyQ=L", SNES_REST, "b.KeyE=E, b.KeyR=R, b.KeyF=F"),
  "post|snes|carry": J(CARRY, SNES, SNES_REST, "b.KeyR=R"),

  "mast|none|none": "b.KeyR=R, b.KeyF=F",
  "mast|none|carry": J(CARRY, "b.KeyR=R"),
  "mast|gun|none": "t.KeyR=Reload, b.KeyF=F",
  "mast|gun|carry": J(CARRY, "t.KeyR=Reload"),
  "mast|piece|none": J("t.KeyQ=Turn left, t.KeyE=Turn right, t.KeyF=Turn over, t.AltLeft=Place freely", "b.KeyR=R"),
  "mast|piece|carry": J(CARRY, "b.KeyR=R"),
  "mast|doom|none": J(DOOM, "t.AltLeft=Strafe", DOOM_REST, "b.KeyR=R, b.KeyF=F"),
  "mast|doom|carry": J(CARRY, DOOM, DOOM_REST, "b.KeyR=R"),
  "mast|snes|none": J(SNES, "t.KeyQ=L", SNES_REST, "b.KeyR=R, b.KeyF=F"),
  "mast|snes|carry": J(CARRY, SNES, SNES_REST, "b.KeyR=R"),

  "winch|none|none": "b.KeyQ=Q, b.KeyE=E, b.KeyR=R, b.KeyB=B, b.KeyF=F",
  "winch|none|carry": J(CARRY, "b.KeyR=R, b.KeyB=B"),
  "winch|gun|none": "t.KeyR=Reload, b.KeyQ=Q, b.KeyE=E, b.KeyB=B, b.KeyF=F",
  "winch|gun|carry": J(CARRY, "t.KeyR=Reload, b.KeyB=B"),
  "winch|piece|none": J("t.KeyQ=Turn left, t.KeyE=Turn right, t.KeyF=Turn over, t.AltLeft=Place freely", "b.KeyR=R, b.KeyB=B"),
  "winch|piece|carry": J(CARRY, "b.KeyR=R, b.KeyB=B"),
  "winch|doom|none": J(DOOM, "t.AltLeft=Strafe", DOOM_REST, "b.KeyQ=Q, b.KeyR=R, b.KeyB=B, b.KeyF=F"),
  "winch|doom|carry": J(CARRY, DOOM, DOOM_REST, "b.KeyR=R, b.KeyB=B"),
  "winch|snes|none": J(SNES, "t.KeyQ=L", SNES_REST, "b.KeyE=E, b.KeyR=R, b.KeyB=B, b.KeyF=F"),
  "winch|snes|carry": J(CARRY, SNES, SNES_REST, "b.KeyR=R, b.KeyB=B"),

  "helm|none|none": "b.KeyA=A, b.KeyD=D, b.ArrowLeft=←@left, b.ArrowRight=→@right, b.KeyQ=Q, b.KeyE=E, b.KeyR=R, b.KeyB=B, b.KeyF=F",
  "helm|none|carry": J(CARRY, "b.KeyA=A, b.KeyD=D, b.ArrowLeft=←@left, b.ArrowRight=→@right, b.KeyR=R, b.KeyB=B"),
  "helm|gun|none": "t.KeyR=Reload, b.KeyA=A, b.KeyD=D, b.ArrowLeft=←@left, b.ArrowRight=→@right, b.KeyQ=Q, b.KeyE=E, b.KeyB=B, b.KeyF=F",
  "helm|gun|carry": J(CARRY, "t.KeyR=Reload, b.KeyA=A, b.KeyD=D, b.ArrowLeft=←@left, b.ArrowRight=→@right, b.KeyB=B"),
  "helm|piece|none": J("t.KeyQ=Turn left, t.KeyE=Turn right, t.KeyF=Turn over, t.AltLeft=Place freely", "b.KeyA=A, b.KeyD=D, b.ArrowLeft=←@left, b.ArrowRight=→@right, b.KeyR=R, b.KeyB=B"),
  "helm|piece|carry": J(CARRY, "b.KeyA=A, b.KeyD=D, b.ArrowLeft=←@left, b.ArrowRight=→@right, b.KeyR=R, b.KeyB=B"),
  "helm|doom|none": J(DOOM, "t.AltLeft=Strafe", DOOM_REST, "b.KeyQ=Q, b.KeyR=R, b.KeyB=B, b.KeyF=F"), // the pad's A, D, ← and → (and E)
  "helm|doom|carry": J(CARRY, DOOM, DOOM_REST, "b.KeyR=R, b.KeyB=B"),
  "helm|snes|none": J(SNES, "t.KeyQ=L", SNES_REST, "b.KeyD=D, b.KeyE=E, b.KeyR=R, b.KeyB=B, b.KeyF=F"),
  "helm|snes|carry": J(CARRY, SNES, SNES_REST, "b.KeyD=D, b.KeyR=R, b.KeyB=B"),
};

const FROM = { g: "gesture", t: "tool", b: "body" };
/** "b.KeyW=Forward@up" → { code, key, label, slot, from }, the key from Chrome's table. */
const parse = (s) =>
  s
    ? s.split(", ").map((c) => {
        const [, f, code, label, slot = null] = /^([gtb])\.(\w+)=([^@]+)(?:@(\w+))?$/.exec(c);
        return { code, key: CHROME[code], label, slot, from: FROM[f] };
      })
    : [];

const viewOf = (b, t, g) => ({ body: { keys: BODIES[b] }, held: TOOLS[t] && { keys: TOOLS[t] }, gesture: GESTURES[g] && { keys: GESTURES[g] } });
const CASES = Object.keys(BODIES).flatMap((b) => Object.keys(TOOLS).flatMap((t) => Object.keys(GESTURES).map((g) => [b, t, g])));

describe("touchControls: every keys declaration in the repo, in every combination (7 bodies × 5 tools × 2 gestures)", () => {
  it("the table covers every case and only those", () => {
    expect(CASES.length).toBe(70);
    expect(Object.keys(EXPECTED).sort()).toEqual(CASES.map((c) => c.join("|")).sort());
  });

  it.each(CASES)("%s body, %s tool, %s gesture", (b, t, g) => {
    const view = viewOf(b, t, g);
    const got = touchControls(view);
    expect(got).toEqual(parse(EXPECTED[`${b}|${t}|${g}`]));

    const layers = { gesture: view.gesture, tool: view.held, body: view.body };
    // a shown key works: each control reaches the reserver it's shown for
    for (const c of got) expect(reservedBy(c.code, layers)).toBe(c.from);
    // no two controls look the same within one reserver, and no pad place is held twice
    const seen = got.map((c) => `${c.from}|${c.label}`);
    expect(new Set(seen).size).toBe(seen.length);
    const slots = got.map((c) => c.slot).filter(Boolean);
    expect(new Set(slots).size).toBe(slots.length);
    // every declared, reserved code is reachable: its reserver shows a control by its label
    for (const from of ["gesture", "tool", "body"]) {
      for (const k of layers[from]?.keys ?? []) {
        if (reservedBy(k.code, layers) !== from) continue;
        expect(seen).toContain(`${from}|${k.label ?? nameOf(k.code)}`);
      }
    }
  });
});

describe("touchControls: the bodies with no keys", () => {
  it.each([["Look", LOOK], ["Edit", EDIT], ["a seat", { id: "seat", keys: [] }]])("%s shows nothing", (_, body) => {
    expect(touchControls({ body, held: null, gesture: null })).toEqual([]);
  });
  it("nothing at all (no body yet) shows nothing", () => {
    expect(touchControls({})).toEqual([]);
    expect(touchControls({ body: null, held: null, gesture: null })).toEqual([]);
  });
});

describe("touchControls: the declaration's shape", () => {
  it("bare codes and { code } entries read the same", () => {
    expect(touchControls({ body: { keys: ["KeyQ", { code: "KeyE" }] } })).toEqual(parse("b.KeyQ=Q, b.KeyE=E"));
  });
  it("a code declared twice is one entry, at its first place and label", () => {
    expect(touchControls({ body: { keys: [{ code: "KeyQ", label: "Ease" }, "KeyE", { code: "KeyQ", label: "Haul" }] } })).toEqual(parse("b.KeyQ=Ease, b.KeyE=E"));
  });
  it("unlabelled codes that read the same are one control (ShiftLeft and ShiftRight are Shift)", () => {
    expect(touchControls({ body: { keys: ["ShiftRight", "ShiftLeft"] } })).toEqual(parse("b.ShiftRight=Shift"));
  });
  it("an empty label is no label", () => {
    expect(touchControls({ body: { keys: [{ code: "KeyQ", label: "" }] } })).toEqual(parse("b.KeyQ=Q"));
  });
  it("a group presses its first code the earlier layers leave it", () => {
    // the gesture takes KeyW; walk's Forward still has ArrowUp, and keeps its place on the pad
    expect(touchControls({ gesture: { keys: ["KeyW"] }, body: { keys: WALK_KEYS.slice(0, 1).concat(WALK_KEYS.slice(4, 5)) } })).toEqual(parse("g.KeyW=W, b.ArrowUp=Forward@up"));
  });
  it("a control takes its first arrow's place, whatever the layer before it holds", () => {
    expect(touchControls({ body: { keys: [{ code: "ArrowLeft", label: "Turn" }, { code: "ArrowRight", label: "Turn" }] } })).toEqual(parse("b.ArrowLeft=Turn@left"));
    expect(touchControls({ held: { keys: [{ code: "ArrowUp", label: "Up" }] }, body: { keys: [{ code: "KeyW", label: "Forward" }, { code: "ArrowDown", label: "Forward" }] } })).toEqual(parse("t.ArrowUp=Up@up, b.KeyW=Forward@down"));
  });
});

describe("keyOf: the key a US keyboard sends", () => {
  it.each(Object.entries(CHROME))("%s sends %j (every code a declaration in the repo uses, as Chrome sends it)", (code, key) => {
    expect(keyOf(code)).toBe(key);
  });

  // keymap.js codeOfKey is the inverse for every key it names: the two tables agree
  const NAMED = [
    ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => `Key${c}`),
    ..."0123456789".split("").map((d) => `Digit${d}`),
    "Space", "Period", "Comma", "Slash", "Semicolon", "Quote", "BracketLeft", "BracketRight", "Minus", "Equal", "Backquote", "Backslash",
    "Enter", "Escape", "Delete", "Backspace", "Tab", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Insert",
    ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
  ];
  it.each(NAMED)("codeOfKey(keyOf(%s)) is itself", (code) => {
    expect(codeOfKey(keyOf(code))).toBe(code);
  });

  it.each([
    ["MetaLeft", "Meta"],
    ["MetaRight", "Meta"],
    ["IntlBackslash", "Unidentified"],
    ["", "Unidentified"],
    [null, "Unidentified"],
  ])("%s sends %j", (code, key) => {
    expect(keyOf(code)).toBe(key);
  });
});

describe("nameOf: an unlabelled code as a person reads it", () => {
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
    expect(nameOf(code)).toBe(name);
  });
});
