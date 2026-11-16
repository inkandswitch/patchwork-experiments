// What the keys do while you hold a machine's pad: the rows of the controls
// shown beside the screen (extension.js draws them), made from the keys the
// pad reads (input.js KEYS), so what's shown is what's read and nothing else.
// Pure.

import { KEYS } from "../patchwork/input.js";

/** What a key is called on a keycap, by its code (KeyboardEvent.code). */
const NAMES = {
  ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→",
  Space: "Space", Enter: "Enter", Backspace: "Backspace", Comma: ",", Period: ".",
  ShiftLeft: "Shift", ShiftRight: "Right Shift", AltLeft: "Alt", AltRight: "Right Alt", ControlLeft: "Ctrl", ControlRight: "Right Ctrl",
};
export const keyName = (code) => NAMES[code] ?? (/^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit[0-9]$/.test(code) ? code.slice(5) : code);

/**
 * The rows for keys `keys` ([{ code, label }], a held tool's): one per
 * label, in the order labels first appear, each with its keys' names in
 * order, each name once; a row with both sides of a key (Shift and Right
 * Shift) names it once, plainly.
 */
export function controls(keys) {
  const rows = new Map();
  for (const { code, label } of keys ?? []) {
    if (!rows.has(label)) rows.set(label, []);
    const names = rows.get(label);
    const name = keyName(code);
    if (!names.includes(name)) names.push(name);
  }
  return [...rows].map(([label, names]) => ({ label, keys: names.filter((n) => !(n.startsWith("Right ") && names.includes(n.slice(6)))) }));
}

/** The controls of a machine of `kind`'s pad. */
export const controlsOf = (kind) => controls(KEYS[kind] ?? []);
