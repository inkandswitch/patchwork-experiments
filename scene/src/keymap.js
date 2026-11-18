// The one key resolver (STAGE.md, "Keys"). Pure: no api, and no DOM but
// for isTyping, which reads the element it is given.
//
// One key order: a focused field (the DOM's, before any of this), the open
// gesture (a carry's Q/E/F), the held tool's declared keys, the body's, then
// the key map over attention's path. Keys have no position, so what
// reserves them comes before what offers verbs. Escape is none of these:
// it is the ladder's (stage/ladder.js).
//
// The gesture, the tool and the body *declare* their keys ({ code, label }),
// so whether a key is theirs is known before it is pressed. That is what
// makes a shown key work by construction: every surface that shows a
// command's key (the prompt, the menu, the bar) asks `hintFor`, which
// resolves that key exactly as the router dispatches it, and shows it only
// when it would reach that command on that target.
//
// Attention is one target per view: the selection if any, else the look
// (the pointer's hit, or the eye ray under lock). Its path is the selection
// itself, or the look's chain: the hit, then what it is attached to,
// nearest first (looking at a spoke of the wheel reaches the helm's verbs
// when the spoke has none for that key). The key map tries the path, then
// the scene (the null target).

import { commandState, flatCommands, keyMatches, keysOf } from "./parts/toolbar-commands.js";

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
 * Who a key's physical code is reserved by, in the key order: "gesture",
 * "tool" or "body", or null (the key map's).
 * @param {string | null} code
 * @param {{ gesture?: { keys? } | null, tool?: { keys? } | null, body?: { keys? } | null }} layers
 */
export function reservedBy(code, { gesture = null, tool = null, body = null } = {}) {
  if (typeof code !== "string" || !code) return null;
  if (gesture && codesOf(gesture.keys).has(code)) return "gesture";
  if (tool && codesOf(tool.keys).has(code)) return "tool";
  if (body && codesOf(body.keys).has(code)) return "body";
  return null;
}

/** What a look reaches: the object, then what it's attached to, nearest first. */
export function lookChain(id, parents) {
  if (id == null) return [];
  const out = [id];
  for (let p = parents?.get?.(id); p != null && !out.includes(p); p = parents.get(p)) out.push(p);
  return out;
}

/**
 * Attention's path: [the selection], or the look's chain, or [] (nothing
 * selected, nothing looked at).
 * @param {{ selected?: string | null, hit?: { id } | null }} attention
 * @param {Map<string, string>} parents  scene().parents
 */
export function attentionPath(attention, parents) {
  if (attention?.selected != null) return [attention.selected];
  return lookChain(attention?.hit?.id ?? null, parents);
}

/**
 * The key map's invocation for a key, or null: the first command whose
 * `key` matches (letters in either case) and whose state applies and isn't
 * disabled, for each target of attention's path in turn, then the scene.
 * Within one target, in running order then command order. `show` doesn't
 * matter to keys.
 * @param {{ id, value }[]} collected  api.collect("commands")
 * @param {string} key  KeyboardEvent.key
 * @param {object} ctx  the command context
 * @param {{ selected?, hit? }} attention
 * @returns {{ ext: string, command: string, target: string | null } | null}
 */
export function mapInvocation(collected, key, ctx, attention) {
  const matching = flatCommands(collected).filter(({ command }) => keyMatches(command, key));
  if (!matching.length) return null;
  const path = attentionPath(attention, ctx?.scene?.parents).filter((t) => attention?.selected != null || ctx?.scene?.objects?.[t]);
  for (const target of [...path, null]) {
    for (const { ext, command } of matching) {
      const s = commandState(command, target, ctx);
      if (s && !s.disabled) return { ext, command: command.id, target };
    }
  }
  return null;
}

/**
 * The whole resolver: where a key goes. Escape is the ladder's (null here).
 * @param {{ key: string, code?: string | null }} k
 * @param {{ gesture?, tool?, body?, collected, ctx, attention }} state
 * @returns {{ layer: "gesture" | "tool" | "body" } | { layer: "map", invocation: object } | null}
 */
/**
 * The segments the key map visits (STAGE.md, "The input chain"): attention's path,
 * one per stage, innermost first, each with its own commands, context and
 * attention; a state with none is one segment of its own fields.
 */
export const segmentsOf = (state) => (Array.isArray(state?.segments) && state.segments.length ? state.segments : [{ stage: undefined, collected: state?.collected ?? [], ctx: state?.ctx, attention: state?.attention }]);

export function resolveKey({ key, code = null }, state) {
  if (key === "Escape") return null;
  const by = reservedBy(code ?? codeOfKey(key), state);
  if (by) return { layer: by };
  // each stage on attention's path, innermost first: its element of the path, then its null target
  for (const seg of segmentsOf(state)) {
    const invocation = mapInvocation(seg.collected, key, seg.ctx, seg.attention);
    if (invocation) return { layer: "map", invocation: seg.stage === undefined ? invocation : { ...invocation, stage: seg.stage } };
  }
  return null;
}

/**
 * The key a surface shows for a command on a target: its first key that
 * the resolver sends to exactly that command on exactly that target, as a
 * person reads it ("F", "Del"), else "". So a verb whose key is reserved
 * (walking, D is the body's) shows without one.
 * @param {{ ext: string, command: object, target: string | null }} entry
 * @param {{ gesture?, tool?, body?, collected, ctx, attention }} state
 */
export function hintFor(verb, state) {
  const k = keyFor(verb, state);
  return k == null ? "" : labelOf(k);
}

/**
 * The key (a command's `key`, as declared) that does this verb on this
 * target in this state, as the router dispatches it, or null: hintFor's
 * key before it is named. Whatever presses a verb's key (the use prompt's
 * button) asks this as it presses, so it presses only a key that does it.
 */
export function keyFor({ ext, command, target = null, stage = undefined }, state) {
  for (const k of keysOf(command)) {
    const r = resolveKey({ key: k, code: codeOfKey(k) }, state);
    if (r?.layer === "map" && r.invocation.ext === ext && r.invocation.command === command.id && r.invocation.target === (target ?? null) && (stage === undefined || r.invocation.stage === stage)) return k;
  }
  return null;
}

const KEY_NAMES = { Escape: "Esc", Delete: "Del", Backspace: "⌫", ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", " ": "Space" };

/** A key as a person reads it. */
export const labelOf = (k) => KEY_NAMES[k] ?? (k.length === 1 ? k.toUpperCase() : k);
