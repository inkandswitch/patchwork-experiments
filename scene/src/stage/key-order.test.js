// The key order (./key-order.js): how a keys declaration is read, and what a
// US keyboard sends for a code.
import { describe, it, expect } from "vitest";
import { codeOfKey, codesOf, declaredKeys, keyOfCode, nameOfCode } from "./key-order.js";

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
 * What Chrome sends as KeyboardEvent.key on a US layout with no modifier
 * held: one code for each of keyOfCode's rules (a letter, a digit, a named
 * key), every modifier, and the punctuation. Written from the UI Events
 * `code` and `key` tables, not from key-order.js's own.
 */
const CHROME = {
  KeyQ: "q", Digit1: "1", ArrowUp: "ArrowUp",
  ShiftLeft: "Shift", ShiftRight: "Shift", AltLeft: "Alt", AltRight: "Alt", ControlLeft: "Control", ControlRight: "Control",
  Space: " ", Comma: ",", Period: ".",
};

describe("keyOfCode: the key a US keyboard sends", () => {
  it.each(Object.entries(CHROME))("%s sends %j", (code, key) => {
    expect(keyOfCode(code)).toBe(key);
  });

  // codeOfKey's inverse: punctuation and named keys are the same tables read
  // both ways, so only the letter and digit rules (one regex each way) can disagree
  it.each(["KeyQ", "Digit3"])("codeOfKey(keyOfCode(%s)) is itself", (code) => {
    expect(codeOfKey(keyOfCode(code))).toBe(code);
  });

  it.each([
    ["MetaLeft", "Meta"],
    ["IntlBackslash", "Unidentified"],
    [null, "Unidentified"],
  ])("%s sends %j", (code, key) => {
    expect(keyOfCode(code)).toBe(key);
  });
});

describe("nameOfCode: an unlabelled code as a person reads it", () => {
  it.each([
    ["KeyQ", "Q"],
    ["ArrowUp", "↑"],
    ["ArrowDown", "↓"],
    ["ArrowLeft", "←"],
    ["ArrowRight", "→"],
    ["Space", "Space"],
    ["ShiftLeft", "Shift"],
    ["Enter", "Enter"],
    ["Backspace", "⌫"],
    ["Escape", "Esc"],
    ["IntlBackslash", "IntlBackslash"],
  ])("%s reads %j", (code, name) => {
    expect(nameOfCode(code)).toBe(name);
  });
});
