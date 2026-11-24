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
 * What Chrome sends as KeyboardEvent.key for each code a declaration in the
 * repo uses, on a US layout with no modifier held. Written from the UI
 * Events `code` and `key` tables, not from key-order.js's own.
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
