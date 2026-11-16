// What the keys do while you hold a machine's pad: the rows of the controls
// panel at the top left of the view (extension.js draws it), made from the
// keys the pad reads (input.js KEYS), so what's shown is what's read and
// nothing else. All pure but `panel`, whose only state is when the pad in
// hand last changed.

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

/**
 * A row's key names as shown on keycaps: a run of three or more digits in a
 * row, ascending, is one cap ("1–7"); every other name is its own, in order.
 */
export function caps(names) {
  const out = [];
  for (let i = 0; i < names.length; ) {
    let j = i;
    while (j + 1 < names.length && /^[0-9]$/.test(names[j]) && /^[0-9]$/.test(names[j + 1]) && Number(names[j + 1]) === Number(names[j]) + 1) j++;
    if (j - i >= 2) out.push(`${names[i]}–${names[j]}`);
    else for (let k = i; k <= j; k++) out.push(names[k]);
    i = j + 1;
  }
  return out;
}

/** The controls of a machine of `kind`'s pad. */
export const controlsOf = (kind) => controls(KEYS[kind] ?? []);

/** How long the panel stays open (ms) once a pad comes into hand, before it folds to its title (hovered, it opens again). */
export const OPEN_MS = 8000;

/**
 * The controls panel, over time: `(held, now)` → null (no pad in hand), or
 * { key, title, open, rows } for the pad in hand (`held`: { id, kind, title,
 * port }), open for OPEN_MS (`openMs`) from when that pad (that machine, its
 * kind and title, that port) came into hand. `key` changes exactly when what
 * the panel shows does, so it is redrawn only then.
 */
export function panel(openMs = OPEN_MS) {
  let ident = null;
  let since = 0;
  return (held, now) => {
    const id = held ? JSON.stringify([held.id, held.kind, held.title, held.port]) : null;
    if (id !== ident) {
      ident = id;
      since = now;
    }
    if (!held) return null;
    const open = now - since < openMs;
    const title = held.port == null ? held.title : `${held.title} · P${held.port + 1}`;
    return { key: `${id}:${open}`, title, open, rows: controlsOf(held.kind).map((r) => ({ label: r.label, keys: caps(r.keys) })) };
  };
}
