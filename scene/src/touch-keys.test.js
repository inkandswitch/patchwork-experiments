import { describe, it, expect } from "vitest";
import { touchControls } from "./touch-keys.js";
import { keyHolder, keyOfCode, nameOfCode, reservedBy } from "./key-order.js";
import { CARRY_KEYS } from "./parts/carry.js";
import { LOOK } from "./stage/bodies.js";

// Every keys declaration in the repo, copied as literals (scene can't import
// another package). Re-copy when one changes.
const L = (pairs) => pairs.map(([code, label]) => ({ code, label }));

/** walk/src/body.js WALK_KEYS */
const WALK_KEYS = L([["KeyW", "Forward"], ["KeyA", "Left"], ["KeyS", "Back"], ["KeyD", "Right"], ["ArrowUp", "Forward"], ["ArrowDown", "Back"], ["ArrowLeft", "Left"], ["ArrowRight", "Right"], ["ShiftLeft", "Run"], ["ShiftRight", "Run"], ["Space", "Jump"]]);
/**
 * sailing/src/stations.js, as crew.js's station body declares them: every
 * set a station can take (sailing's stations.test.js asserts each). A post
 * is sailKeys (Q E with the sheet, R the halyard: takePost always works it)
 * + F; a winch is jibKeys (Q E R B with a jib) + F; the helm is A D ← → +
 * sailKeys (sheet and halyard, with a sail) + jibKeys (B, with a jib) + F.
 */
const [Q, E, R, FURL, B, F] = [["KeyQ", "Haul in"], ["KeyE", "Ease out"], ["KeyR", "Halyard"], ["KeyR", "Furler"], ["KeyB", "Back jib / let fly"], ["KeyF", "Leave"]];
const STEER = [["KeyA", "Steer to port"], ["KeyD", "Steer to starboard"], ["ArrowLeft", "Steer to port"], ["ArrowRight", "Steer to starboard"]];
const POST_KEYS = L([Q, E, R, F]); // the mainsheet, or the mast with the sheet led there
const MAST_KEYS = L([R, F]); // the mast, the halyard only
const BARE_KEYS = L([F]); // a post with no sail, a winch with no jib
const WINCH_KEYS = L([Q, E, FURL, B, F]);
const HELM_KEYS = L([...STEER, Q, E, R, B, F]); // a sail and a jib
const HELM_SAIL_KEYS = L([...STEER, Q, E, R, F]); // a sail, no jib
const HELM_JIB_KEYS = L([...STEER, B, F]); // a jib, no sail
const HELM_BARE_KEYS = L([...STEER, F]); // neither
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
const BODIES = {
  none: [], walk: WALK_KEYS,
  post: POST_KEYS, mast: MAST_KEYS, bare: BARE_KEYS, winch: WINCH_KEYS,
  helm: HELM_KEYS, helmSail: HELM_SAIL_KEYS, helmJib: HELM_JIB_KEYS, helmBare: HELM_BARE_KEYS,
};
// bag's drawn piece declares CARRY_KEYS (bag/src/extension.js); the machine's pad declares its kind's KEYS
const TOOLS = { none: null, gun: GUN_KEYS, piece: CARRY_KEYS, doom: DOOM_KEYS, snes: SNES_KEYS };
// the open gesture: scene's carry (and bag's hand, the same CARRY_KEYS)
const GESTURES = { none: null, carry: CARRY_KEYS };

const CARRY = "g.KeyQ=Turn left, g.KeyE=Turn right, g.KeyF=Turn over, g.AltLeft=Place freely";
const PIECE = "t.KeyQ=Turn left, t.KeyE=Turn right, t.KeyF=Turn over, t.AltLeft=Place freely";
const DOOM = "t.ArrowUp=Forward@up, t.ArrowDown=Back@down, t.ArrowLeft=Turn left@left, t.ArrowRight=Turn right@right, t.KeyA=Strafe left, t.KeyD=Strafe right";
// Digit1–7 are all labelled "Weapon", so they read as one control that picks
// weapon 1: a known loss, asserted as it is (machine labels them alike;
// HISTORY.md, TOOLS Decisions 12, for the lead)
const DOOM_REST = "t.ShiftLeft=Run, t.ControlLeft=Fire, t.Space=Use, t.Digit1=Weapon"; // after Strafe (AltLeft), which a carry takes
const SNES = "t.ArrowUp=Up@up, t.ArrowDown=Down@down, t.ArrowLeft=Left@left, t.ArrowRight=Right@right, t.KeyZ=B, t.KeyX=A, t.KeyA=Y, t.KeyS=X";
const SNES_REST = "t.KeyW=R, t.Enter=Start, t.ShiftRight=Select"; // after L (KeyQ), which a carry takes
const WALK = "b.KeyW=Forward@up, b.KeyA=Left@left, b.KeyS=Back@down, b.KeyD=Right@right, b.ShiftLeft=Run, b.Space=Jump";
// A and ← are one "Steer to port", in the pad's left place; D and → one "Steer to starboard"
const WHEEL = "b.KeyA=Steer to port@left, b.KeyD=Steer to starboard@right";

// Each case's controls, in order: from (g)esture, (t)ool or (b)ody, the code
// pressed, the label, and the pad slot if any. The gesture's and the tool's
// controls come before the body's in the key order, and a layer's controls
// depend only on the layers before it: ABOVE is the gesture's and tool's for
// each (tool, gesture), BELOW the body's under each. A case is ABOVE then
// BELOW, each written out.
const J = (...parts) => parts.filter(Boolean).join(", ");
const COLUMNS = ["none|none", "none|carry", "gun|none", "gun|carry", "piece|none", "piece|carry", "doom|none", "doom|carry", "snes|none", "snes|carry"];
const ABOVE = {
  "none|none": "",
  "none|carry": CARRY,
  "gun|none": "t.KeyR=Reload",
  "gun|carry": J(CARRY, "t.KeyR=Reload"),
  "piece|none": PIECE,
  "piece|carry": CARRY, // the gesture shadows every key the piece declares
  "doom|none": J(DOOM, "t.AltLeft=Strafe", DOOM_REST),
  "doom|carry": J(CARRY, DOOM, DOOM_REST), // Alt is the carry's: no Strafe
  "snes|none": J(SNES, "t.KeyQ=L", SNES_REST),
  "snes|carry": J(CARRY, SNES, SNES_REST), // Q is the carry's: no L
};
// the body's controls, one per COLUMN
const BELOW = {
  none: ["", "", "", "", "", "", "", "", "", ""],
  // doom takes every key walk declares; snes takes W, A, S, ShiftRight and every arrow, so walk keeps
  // D (Right, a button: the pad's right place is snes's), ShiftLeft and Space. Labels are one per
  // reserver, not across them: snes's "Right" and walk's "Right" are both shown (the pad shows `from`)
  walk: [WALK, WALK, WALK, WALK, WALK, WALK, "", "", "b.KeyD=Right, b.ShiftLeft=Run, b.Space=Jump", "b.KeyD=Right, b.ShiftLeft=Run, b.Space=Jump"],
  // the carry's Q, E, F over a station's; the gun's R over the post's
  post: ["b.KeyQ=Haul in, b.KeyE=Ease out, b.KeyR=Halyard, b.KeyF=Leave", "b.KeyR=Halyard", "b.KeyQ=Haul in, b.KeyE=Ease out, b.KeyF=Leave", "", "b.KeyR=Halyard", "b.KeyR=Halyard", "b.KeyQ=Haul in, b.KeyR=Halyard, b.KeyF=Leave", "b.KeyR=Halyard", "b.KeyE=Ease out, b.KeyR=Halyard, b.KeyF=Leave", "b.KeyR=Halyard"],
  mast: ["b.KeyR=Halyard, b.KeyF=Leave", "b.KeyR=Halyard", "b.KeyF=Leave", "", "b.KeyR=Halyard", "b.KeyR=Halyard", "b.KeyR=Halyard, b.KeyF=Leave", "b.KeyR=Halyard", "b.KeyR=Halyard, b.KeyF=Leave", "b.KeyR=Halyard"],
  bare: ["b.KeyF=Leave", "", "b.KeyF=Leave", "", "", "", "b.KeyF=Leave", "", "b.KeyF=Leave", ""],
  winch: ["b.KeyQ=Haul in, b.KeyE=Ease out, b.KeyR=Furler, b.KeyB=Back jib / let fly, b.KeyF=Leave", "b.KeyR=Furler, b.KeyB=Back jib / let fly", "b.KeyQ=Haul in, b.KeyE=Ease out, b.KeyB=Back jib / let fly, b.KeyF=Leave", "b.KeyB=Back jib / let fly", "b.KeyR=Furler, b.KeyB=Back jib / let fly", "b.KeyR=Furler, b.KeyB=Back jib / let fly", "b.KeyQ=Haul in, b.KeyR=Furler, b.KeyB=Back jib / let fly, b.KeyF=Leave", "b.KeyR=Furler, b.KeyB=Back jib / let fly", "b.KeyE=Ease out, b.KeyR=Furler, b.KeyB=Back jib / let fly, b.KeyF=Leave", "b.KeyR=Furler, b.KeyB=Back jib / let fly"],
  // doom takes the wheel's A, D, ← and → (and E); snes takes A, ← and → (and Q)
  helm: [J(WHEEL, "b.KeyQ=Haul in, b.KeyE=Ease out, b.KeyR=Halyard, b.KeyB=Back jib / let fly, b.KeyF=Leave"), J(WHEEL, "b.KeyR=Halyard, b.KeyB=Back jib / let fly"), J(WHEEL, "b.KeyQ=Haul in, b.KeyE=Ease out, b.KeyB=Back jib / let fly, b.KeyF=Leave"), J(WHEEL, "b.KeyB=Back jib / let fly"), J(WHEEL, "b.KeyR=Halyard, b.KeyB=Back jib / let fly"), J(WHEEL, "b.KeyR=Halyard, b.KeyB=Back jib / let fly"), "b.KeyQ=Haul in, b.KeyR=Halyard, b.KeyB=Back jib / let fly, b.KeyF=Leave", "b.KeyR=Halyard, b.KeyB=Back jib / let fly", "b.KeyD=Steer to starboard, b.KeyE=Ease out, b.KeyR=Halyard, b.KeyB=Back jib / let fly, b.KeyF=Leave", "b.KeyD=Steer to starboard, b.KeyR=Halyard, b.KeyB=Back jib / let fly"],
  helmSail: [J(WHEEL, "b.KeyQ=Haul in, b.KeyE=Ease out, b.KeyR=Halyard, b.KeyF=Leave"), J(WHEEL, "b.KeyR=Halyard"), J(WHEEL, "b.KeyQ=Haul in, b.KeyE=Ease out, b.KeyF=Leave"), WHEEL, J(WHEEL, "b.KeyR=Halyard"), J(WHEEL, "b.KeyR=Halyard"), "b.KeyQ=Haul in, b.KeyR=Halyard, b.KeyF=Leave", "b.KeyR=Halyard", "b.KeyD=Steer to starboard, b.KeyE=Ease out, b.KeyR=Halyard, b.KeyF=Leave", "b.KeyD=Steer to starboard, b.KeyR=Halyard"],
  helmJib: [J(WHEEL, "b.KeyB=Back jib / let fly, b.KeyF=Leave"), J(WHEEL, "b.KeyB=Back jib / let fly"), J(WHEEL, "b.KeyB=Back jib / let fly, b.KeyF=Leave"), J(WHEEL, "b.KeyB=Back jib / let fly"), J(WHEEL, "b.KeyB=Back jib / let fly"), J(WHEEL, "b.KeyB=Back jib / let fly"), "b.KeyB=Back jib / let fly, b.KeyF=Leave", "b.KeyB=Back jib / let fly", "b.KeyD=Steer to starboard, b.KeyB=Back jib / let fly, b.KeyF=Leave", "b.KeyD=Steer to starboard, b.KeyB=Back jib / let fly"],
  helmBare: [J(WHEEL, "b.KeyF=Leave"), WHEEL, J(WHEEL, "b.KeyF=Leave"), WHEEL, WHEEL, WHEEL, "b.KeyF=Leave", "", "b.KeyD=Steer to starboard, b.KeyF=Leave", "b.KeyD=Steer to starboard"],
};
const EXPECTED = Object.fromEntries(Object.entries(BELOW).flatMap(([b, row]) => COLUMNS.map((col, i) => [`${b}|${col}`, J(ABOVE[col], row[i])])));

const FROM = { g: "gesture", t: "hand", b: "body" };
/** "b.KeyW=Forward@up" → { code, key, label, slot, from }; the key is keyOfCode's (keymap.test.js checks it against what Chrome sends). */
const parse = (s) =>
  s
    ? s.split(", ").map((c) => {
        const [, f, code, label, slot = null] = /^([gtb])\.(\w+)=([^@]+)(?:@(\w+))?$/.exec(c);
        return { code, key: keyOfCode(code), label, slot, from: FROM[f] };
      })
    : [];

const viewOf = (b, t, g) => ({ body: { keys: BODIES[b] }, hands: TOOLS[t] ? [{ keys: TOOLS[t] }] : [], gesture: GESTURES[g] && { keys: GESTURES[g] } });
const CASES = Object.keys(BODIES).flatMap((b) => Object.keys(TOOLS).flatMap((t) => Object.keys(GESTURES).map((g) => [b, t, g])));

describe("touchControls: every keys declaration in the repo, in every combination (10 bodies × 5 tools × 2 gestures)", () => {
  it.each(CASES)("%s body, %s tool, %s gesture", (b, t, g) => {
    const view = viewOf(b, t, g);
    const got = touchControls(view);
    expect(got).toEqual(parse(EXPECTED[`${b}|${t}|${g}`]));

    const layers = { gesture: view.gesture, hands: view.hands, body: view.body };
    const of = { gesture: [view.gesture], hand: view.hands, body: [view.body] };
    // a shown key works: each control reaches the reserver it's shown for
    for (const c of got) expect(reservedBy(c.code, layers)).toBe(c.from);
    // no two controls look the same within one reserver, and no pad place is held twice
    const seen = got.map((c) => `${c.from}|${c.label}`);
    expect(new Set(seen).size).toBe(seen.length);
    const slots = got.map((c) => c.slot).filter(Boolean);
    expect(new Set(slots).size).toBe(slots.length);
    // every declared, reserved code's (reserver, label) has a control (an empty label is none, as in the code);
    // not every code: one label is one control, so a group's later codes have none of their own
    for (const from of ["gesture", "hand", "body"]) {
      for (const k of of[from].flatMap((l) => l?.keys ?? [])) {
        if (reservedBy(k.code, layers) !== from) continue;
        expect(seen).toContain(`${from}|${k.label || nameOfCode(k.code)}`);
      }
    }
  });
});

describe("touchControls: the bodies with no keys", () => {
  it.each([["Look", LOOK], ["a seat", { id: "seat", keys: [] }]])("%s shows nothing", (_, body) => {
    expect(touchControls({ body, hands: [], gesture: null })).toEqual([]);
  });
  it("nothing at all (no body yet) shows nothing", () => {
    expect(touchControls({})).toEqual([]);
    expect(touchControls({ body: null, hands: null, gesture: null })).toEqual([]);
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
  // geometry wins over the label: a "Forward" declared on ArrowDown sits in the down place (Decisions 12)
  it("a control takes its first arrow's place, whatever the layer before it holds", () => {
    expect(touchControls({ body: { keys: [{ code: "ArrowLeft", label: "Turn" }, { code: "ArrowRight", label: "Turn" }] } })).toEqual(parse("b.ArrowLeft=Turn@left"));
    expect(touchControls({ hands: [{ keys: [{ code: "ArrowUp", label: "Up" }] }], body: { keys: [{ code: "KeyW", label: "Forward" }, { code: "ArrowDown", label: "Forward" }] } })).toEqual(parse("t.ArrowUp=Up@up, b.KeyW=Forward@down"));
  });
});

describe("touchControls: two hands", () => {
  // every pair of tool declarations held one over the other: each code is the
  // topmost hand's that declares it, so each control is under that hand, and
  // the top hand's controls come first
  const decls = Object.keys(TOOLS).filter((t) => TOOLS[t]?.length);
  it.each(decls.flatMap((a) => decls.map((b) => [a, b])))("%s under %s", (a, b) => {
    const under = { keys: TOOLS[a] };
    const over = { keys: TOOLS[b] };
    const view = { hands: [under, over] };
    const got = touchControls(view);
    for (const c of got) expect([c.code, keyHolder(c.code, view).layer === over]).toEqual([c.code, over.keys.some((k) => k.code === c.code) || !under.keys.some((k) => k.code === c.code)]);
    const tops = got.map((c) => keyHolder(c.code, view).layer === over);
    expect(tops).toEqual([...tops].sort((x, y) => Number(y) - Number(x)));
    expect(got.every((c) => c.from === "hand")).toBe(true);
  });
});
