// Shortcuts (PLANS.md §5): a command's `shortcut`, a key with ⌘ (Ctrl off a
// Mac) held: "Mod+G", "Shift+Mod+G". The key map's keys are plain keys, and a
// key with ⌘ or Ctrl is the browser's (./keys.js); a shortcut is the one
// way a command takes one, run by scene.keys on attention's target (./keys.js).
// `shortcutBy` names what already does it ("clipboard": ⌘V is the browser's
// paste event, the one way to read the clipboard, which transfer.js hears):
// such a shortcut is only shown, never run here. Pure.

import { applicable } from "../stage/public.js";

/** Is this a Mac (⌘ is Mod there)? As the router tells. */
export const onMac = (nav = globalThis.navigator) => /Mac/i.test(`${nav?.platform ?? ""} ${nav?.userAgent ?? ""}`);

/** "Shift+Mod+G" → { mod, shift, alt, key } (key lower-cased), or null. */
export function parseShortcut(text) {
  if (typeof text !== "string" || !text) return null;
  const parts = text.split("+").map((p) => p.trim()).filter(Boolean);
  const key = parts.pop();
  if (!key) return null;
  const mods = new Set(parts.map((p) => p.toLowerCase()));
  if (![...mods].every((m) => m === "mod" || m === "shift" || m === "alt")) return null;
  if (!mods.has("mod")) return null; // a shortcut is a ⌘ key; a plain key is the key map's
  return { mod: true, shift: mods.has("shift"), alt: mods.has("alt"), key: key.toLowerCase() };
}

/** A command's shortcuts, as declared (one or a list). */
export const shortcutsOf = (command) => (Array.isArray(command?.shortcut) ? command.shortcut : command?.shortcut ? [command.shortcut] : []).filter((s) => typeof s === "string");

/**
 * The letter or name a key event means, without what Shift does to it: its
 * `key` when that is a letter or digit (the layout's: Undo is on the key
 * labelled Z, on AZERTY too), else the physical key's (Alt on a Mac turns Z
 * into Ω: KeyZ → "z"), else its `key`.
 */
function keyOf(ev) {
  const key = String(ev?.key ?? "");
  if (/^[a-z0-9]$/i.test(key)) return key.toLowerCase();
  const code = typeof ev?.code === "string" ? ev.code : "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return key.toLowerCase();
}

/** Does this key event ({ key, code, meta, ctrl, shift, alt }) press this shortcut? ⌘ on a Mac, Ctrl elsewhere. */
export function shortcutMatches(text, ev, mac) {
  const s = parseShortcut(text);
  if (!s || !ev) return false;
  const mod = mac ? !!ev.meta && !ev.ctrl : !!ev.ctrl && !ev.meta;
  return mod && !!ev.shift === s.shift && !!ev.alt === s.alt && keyOf(ev) === s.key;
}

/** A shortcut as a person reads it: "⇧⌘G" on a Mac, "Ctrl+Shift+G" elsewhere. */
export function shortcutLabel(text, mac) {
  const s = parseShortcut(text);
  if (!s) return "";
  const key = s.key.length === 1 ? s.key.toUpperCase() : s.key;
  if (mac) return `${s.alt ? "⌥" : ""}${s.shift ? "⇧" : ""}⌘${key}`;
  return ["Ctrl", s.alt ? "Alt" : null, s.shift ? "Shift" : null, key].filter(Boolean).join("+");
}

/**
 * Which command a ⌘ key is: the first whose shortcut it presses (and that
 * isn't another's to do: `shortcutBy`) and that applies (the kernel's walk),
 * on attention's path, innermost first, then the scene. A disabled one is
 * still the key's (it is claimed, and does nothing). → { ext, command,
 * target, disabled } or null.
 * @param {{ id: string, value: any }[]} collected  a stage's collect("commands")
 * @param {object} ctx  its context
 * @param {(string | null)[]} targets  attention's path, then null
 */
export function shortcutInvocation(collected, ev, mac, ctx, targets) {
  const presses = ({ command }) => !command.shortcutBy && shortcutsOf(command).some((s) => shortcutMatches(s, ev, mac));
  for (const target of targets) {
    const e = applicable(collected, target, ctx, presses)[0];
    if (e) return { ext: e.ext, command: e.command.id, target, disabled: !!e.state.disabled };
  }
  return null;
}

/** The key event a shortcut's press is (what pressing it sends), on a Mac or not; null for no shortcut. */
export function shortcutEvent(text, mac) {
  const s = parseShortcut(text);
  if (!s) return null;
  const code = /^[a-z]$/.test(s.key) ? `Key${s.key.toUpperCase()}` : /^[0-9]$/.test(s.key) ? `Digit${s.key}` : s.key;
  return { key: s.key, code, meta: !!mac, ctrl: !mac, shift: s.shift, alt: s.alt, repeat: false };
}
