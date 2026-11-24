import { describe, it, expect } from "vitest";
import { touchControls } from "./touch-keys.js";
import { keyOfCode } from "./key-order.js";
import { LOOK } from "./stage/bodies.js";

// Three made-up declarations whose overlaps give every outcome the layering
// can have: a label over several codes (Forward, Left, Run, Weapon), a higher
// layer taking part of a group (W or ↑ of Forward) or a whole control (Q's L,
// Alt's Strafe), a group losing its arrow and becoming a button (Forward
// under the tool), and one label under two reservers (the tool's and the
// body's Right).
const L = (pairs) => pairs.map(([code, label]) => ({ code, label }));
const BODY = L([["KeyW", "Forward"], ["ArrowUp", "Forward"], ["KeyA", "Left"], ["ArrowLeft", "Left"], ["KeyD", "Right"], ["ShiftLeft", "Run"], ["ShiftRight", "Run"]]);
const TOOL = L([["ArrowUp", "Up"], ["ArrowRight", "Right"], ["KeyQ", "L"], ["AltLeft", "Strafe"], ["Digit1", "Weapon"], ["Digit2", "Weapon"]]);
const GESTURE = ["KeyQ", "AltLeft", "KeyW"];

const FROM = { g: "gesture", t: "hand", b: "body" };
/** "b.KeyW=Forward@up" → { code, key, label, slot, from }; the key is keyOfCode's (key-order.test.js checks it against what Chrome sends). */
const parse = (s) =>
  s
    ? s.split(", ").map((c) => {
        const [, f, code, label, slot = null] = /^([gtb])\.(\w+)=([^@]+)(?:@(\w+))?$/.exec(c);
        return { code, key: keyOfCode(code), label, slot, from: FROM[f] };
      })
    : [];

// Each case's controls, in order: from (g)esture, (t)ool or (b)ody, the code
// pressed, the label, and the pad slot if any.
describe("touchControls: a code shows under the layer that reserves it, one control per label", () => {
  const G = "g.KeyQ=Q, g.AltLeft=Alt, g.KeyW=W";
  const T = "t.ArrowUp=Up@up, t.ArrowRight=Right@right, t.KeyQ=L, t.AltLeft=Strafe, t.Digit1=Weapon";
  const T_UNDER_G = "t.ArrowUp=Up@up, t.ArrowRight=Right@right, t.Digit1=Weapon"; // Q and Alt are the gesture's: no L, no Strafe
  const B = "b.KeyW=Forward@up, b.KeyA=Left@left, b.KeyD=Right, b.ShiftLeft=Run";
  it.each([
    ["the body alone", { body: BODY }, B],
    ["the tool alone", { tool: TOOL }, T],
    ["the gesture alone", { gesture: GESTURE }, G],
    // the gesture takes W: Forward presses ↑, and keeps the up place
    ["the body under the gesture", { body: BODY, gesture: GESTURE }, `${G}, b.ArrowUp=Forward@up, b.KeyA=Left@left, b.KeyD=Right, b.ShiftLeft=Run`],
    // the tool takes ↑: Forward is a button on W; the tool's Right and the body's Right are both shown
    ["the body under the tool", { body: BODY, tool: TOOL }, `${T}, b.KeyW=Forward, b.KeyA=Left@left, b.KeyD=Right, b.ShiftLeft=Run`],
    ["the tool under the gesture", { tool: TOOL, gesture: GESTURE }, `${G}, ${T_UNDER_G}`],
    // W is the gesture's and ↑ the tool's: Forward is gone
    ["all three", { body: BODY, tool: TOOL, gesture: GESTURE }, `${G}, ${T_UNDER_G}, b.KeyA=Left@left, b.KeyD=Right, b.ShiftLeft=Run`],
  ])("%s", (_, { body = null, tool = null, gesture = null }, expected) => {
    const view = { body: body && { keys: body }, hands: tool ? [{ keys: tool }] : [], gesture: gesture && { keys: gesture } };
    expect(touchControls(view)).toEqual(parse(expected));
  });

  // two hands: each code is the topmost hand's that declares it, and the top hand's controls come first
  it.each([
    ["the tool under a second hand", [{ keys: TOOL }, { keys: GESTURE }], "t.KeyQ=Q, t.AltLeft=Alt, t.KeyW=W, t.ArrowUp=Up@up, t.ArrowRight=Right@right, t.Digit1=Weapon"],
    ["a second hand under the tool", [{ keys: GESTURE }, { keys: TOOL }], `${T}, t.KeyW=W`],
  ])("%s", (_, hands, expected) => {
    expect(touchControls({ hands })).toEqual(parse(expected));
  });
});

describe("touchControls: the bodies with no keys", () => {
  it("Look shows nothing", () => {
    expect(touchControls({ body: LOOK, hands: [], gesture: null })).toEqual([]);
  });
  it("nothing at all (no body yet) shows nothing", () => {
    expect(touchControls({})).toEqual([]);
    expect(touchControls({ body: null, hands: null, gesture: null })).toEqual([]);
  });
});

describe("touchControls: the declaration's shape", () => {
  it("unlabelled codes that read the same are one control (ShiftLeft and ShiftRight are Shift)", () => {
    expect(touchControls({ body: { keys: ["ShiftRight", "ShiftLeft"] } })).toEqual(parse("b.ShiftRight=Shift"));
  });
  // geometry wins over the label: a "Forward" declared on ArrowDown sits in the down place (Decisions 12)
  it("a control takes its first arrow's place, whatever the layer before it holds", () => {
    expect(touchControls({ body: { keys: [{ code: "ArrowLeft", label: "Turn" }, { code: "ArrowRight", label: "Turn" }] } })).toEqual(parse("b.ArrowLeft=Turn@left"));
    expect(touchControls({ hands: [{ keys: [{ code: "ArrowUp", label: "Up" }] }], body: { keys: [{ code: "KeyW", label: "Forward" }, { code: "ArrowDown", label: "Forward" }] } })).toEqual(parse("t.ArrowUp=Up@up, b.KeyW=Forward@down"));
  });
});
