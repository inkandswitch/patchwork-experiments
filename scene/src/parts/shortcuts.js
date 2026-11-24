// Shortcuts (PLANS.md §5): a command's `shortcut`, a key with ⌘ (Ctrl off a
// Mac) held: "Mod+G", "Shift+Mod+G". The key map's keys are plain keys, and a
// key with ⌘ or Ctrl is the browser's (./keys.js); a shortcut is the one
// way a command takes one, run by scene.keys on attention's target (./keys.js).
// `shortcutBy` names what already does it ("clipboard": ⌘C and ⌘V are the
// browser's copy and paste events, which transfer.js hears): such a shortcut
// is only shown, never run here. Pure.

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

/** The letter or name a key event means, without what Shift does to it ("G" → "g"; KeyG → "g"). */
function keyOf(ev) {
  const code = typeof ev?.code === "string" ? ev.code : "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  return String(ev?.key ?? "").toLowerCase();
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
 * Which command a ⌘ key runs: the first whose shortcut it presses (and that
 * isn't another's to do: `shortcutBy`) and that applies (the kernel's walk),
 * on attention's path, innermost first, then the scene. → { ext, command,
 * target } or null.
 * @param {{ id: string, value: any }[]} collected  a stage's collect("commands")
 * @param {object} ctx  its context
 * @param {(string | null)[]} targets  attention's path, then null
 */
export function shortcutInvocation(collected, ev, mac, ctx, targets) {
  const presses = ({ command }) => !command.shortcutBy && shortcutsOf(command).some((s) => shortcutMatches(s, ev, mac));
  for (const target of targets) {
    const e = applicable(collected, target, ctx, presses).find(({ state }) => !state.disabled);
    if (e) return { ext: e.ext, command: e.command.id, target };
  }
  return null;
}
