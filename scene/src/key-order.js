// The key order (STAGE.md, "Keys"): who a key belongs to before any command
// is asked. Pure: no api, and no DOM but for isTyping, which reads the
// element it is given.
//
// One key order: a focused field (the DOM's, before any of this), the open
// gesture (a carry's Q/E/F), the hands' declared keys (the stack top down:
// a key is the topmost hand's that declares it), the body's, then `input.key`
// over attention's path. Keys have no position, so what reserves them comes
// before what offers verbs. Escape is none of these: it is the ladder's
// (stage/ladder.js).
//
// The gesture, the hands and the body *declare* their keys ({ code, label }),
// so whether a key is theirs is known before it is pressed: a surface that
// shows a key can ask whether it is reserved (the editor's key map,
// parts/keymap.js, resolves after this), and the touch pad shows the
// declared keys as controls.

/** Is someone typing into this element (a focused field: the first in the key order, so it keeps its keys)? */
export function isTyping(el) {
  if (!el || el.nodeType !== 1) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!el.isContentEditable || el.getAttribute?.("contenteditable") === "true";
}

/** The physical key (KeyboardEvent.code, US layout) a command's `key` names, or null when it names none. */
export function codeOfKey(key) {
  if (typeof key !== "string" || !key) return null;
  if (key.length === 1) {
    const c = key.toUpperCase();
    if (c >= "A" && c <= "Z") return `Key${c}`;
    if (c >= "0" && c <= "9") return `Digit${c}`;
    return PUNCT[key] ?? null;
  }
  return NAMED.has(key) ? key : null;
}
const PUNCT = { " ": "Space", ".": "Period", ",": "Comma", "/": "Slash", ";": "Semicolon", "'": "Quote", "[": "BracketLeft", "]": "BracketRight", "-": "Minus", "=": "Equal", "`": "Backquote", "\\": "Backslash" };
const NAMED = new Set(["Enter", "Escape", "Delete", "Backspace", "Tab", "Home", "End", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Insert", ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`)]);

const KEY_OF_PUNCT = Object.fromEntries(Object.entries(PUNCT).map(([key, code]) => [code, key]));
const MODIFIERS = { ShiftLeft: "Shift", ShiftRight: "Shift", AltLeft: "Alt", AltRight: "Alt", ControlLeft: "Control", ControlRight: "Control", MetaLeft: "Meta", MetaRight: "Meta" };

/**
 * The KeyboardEvent.key a US keyboard sends for a physical code with no
 * modifier held: codeOfKey's inverse from the same tables, plus the
 * modifiers (which no command's `key` names). "Unidentified" for a code
 * outside them. Handlers read `ev.key` ("q", "Alt") as often as `ev.code`,
 * so whatever presses a declared code sends both.
 * @param {string} code  KeyboardEvent.code
 */
export function keyOfCode(code) {
  if (typeof code !== "string") return "Unidentified";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (NAMED.has(code)) return code;
  return MODIFIERS[code] ?? KEY_OF_PUNCT[code] ?? "Unidentified";
}

/** A code as a person reads it, for a declaration with no label: "Q", "Shift", "↑", "Space"; else the code itself. */
export function nameOfCode(code) {
  const key = keyOfCode(code);
  return key === "Unidentified" ? String(code) : labelOf(key);
}

/**
 * A keys declaration ([{ code, label? } | code]) read once: its entries as
 * { code, label }, the first of each code only, `label` the declared one or
 * null (an empty label is none). The one reading of a declaration: codesOf
 * and the touch controls both go through it.
 */
export function declaredKeys(declared) {
  const out = [];
  const seen = new Set();
  for (const k of Array.isArray(declared) ? declared : []) {
    const code = typeof k === "string" ? k : k?.code;
    if (typeof code !== "string" || !code || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, label: (typeof k === "object" && typeof k.label === "string" && k.label) || null });
  }
  return out;
}

/** Declared keys ([{ code, label }]) as a set of codes. */
export const codesOf = (declared) => new Set(declaredKeys(declared).map((k) => k.code));

/**
 * The layers that may declare keys, in the key order: the open gesture, the
 * hands top first (`hands` as the view has them, top last), the top body;
 * each { from: "gesture" | "hand" | "body", layer }, the absent left out.
 * @param {{ gesture?: { keys? } | null, hands?: { keys? }[] | null, body?: { keys? } | null }} layers
 */
export function keyLayers({ gesture = null, hands = null, body = null } = {}) {
  const out = [];
  if (gesture) out.push({ from: "gesture", layer: gesture });
  for (const h of Array.isArray(hands) ? [...hands].reverse() : []) if (h) out.push({ from: "hand", layer: h });
  if (body) out.push({ from: "body", layer: body });
  return out;
}

/**
 * Who a key's physical code belongs to: the first layer in the key order
 * that declares it ({ from, layer }: keyLayers'), or null (the key map's).
 * @param {string | null} code  @param {object} layers  keyLayers'
 */
export function keyHolder(code, layers) {
  if (typeof code !== "string" || !code) return null;
  return keyLayers(layers).find(({ layer }) => codesOf(layer.keys).has(code)) ?? null;
}

/**
 * Who a key's physical code is reserved by, in the key order: "gesture",
 * "hand" (the topmost hand declaring it) or "body", or null (the key map's).
 * @param {string | null} code
 * @param {{ gesture?: { keys? } | null, hands?: { keys? }[] | null, body?: { keys? } | null }} layers
 */
export const reservedBy = (code, layers) => keyHolder(code, layers)?.from ?? null;

/** What a look reaches: the object, then what it's attached to, nearest first. */
export function lookChain(id, parents) {
  if (id == null) return [];
  const out = [id];
  for (let p = parents?.get?.(id); p != null && !out.includes(p); p = parents.get(p)) out.push(p);
  return out;
}

const KEY_NAMES = { Escape: "Esc", Delete: "Del", Backspace: "⌫", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", " ": "Space" };

/** A key as a person reads it. */
export const labelOf = (k) => KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k);
