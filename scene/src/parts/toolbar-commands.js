// Reading commands (STAGE.md, "A command"), for the surfaces that present
// them: the toolbar, the key map and the menu. Pure: no DOM, no api.

import { inBody } from "../stage/bodies.js";

/**
 * Every running extension's commands, flattened, in running order then
 * command order. Anything that isn't a command (no id, no run) is skipped.
 * @param {{ id: string, value: any }[]} collected  api.collect("commands")
 * @returns {{ ext: string, command: object }[]}
 */
export function flatCommands(collected) {
  const out = [];
  for (const { id: ext, value } of collected ?? []) {
    let list;
    try {
      list = Array.isArray(value) ? value : value && typeof value[Symbol.iterator] === "function" ? [...value] : [];
    } catch {
      continue;
    }
    for (const command of list) if (command && command.id != null && typeof command.run === "function") out.push({ ext, command });
  }
  return out;
}

/**
 * A command's state for a target, or null when it doesn't apply. A command
 * without state() applies only to the null target (the scene). A state()
 * that throws doesn't apply.
 *
 * A command that says `reach: true` applies only within the body's reach
 * (TOOLS.md §4): every surface passes the same context, `from` (the eye),
 * `reach` (the body's, metres or Infinity) and `distance(target)` (from the
 * eye to the look's hit when the look is on the target, else to the
 * target's box), and beyond reach the verb shows disabled, "too far". Reach
 * is ergonomics, not permission: Look's and Edit's are Infinity.
 *
 * A command that says `edit: true` is the editor's (../stage/bodies.js): it
 * applies only while the body is Edit, so outside it it is on no surface
 * and doesn't run.
 * @param {object} command
 * @param {string | null} target
 * @param {{ scene: object, local: object, from?: number[] | null, reach?: number, distance?: (target: string) => number, hit?: object | null }} ctx
 * @returns {object | null}
 */
export function commandState(command, target, ctx) {
  if (!inBody(command, ctx?.local)) return null;
  let s;
  if (typeof command?.state !== "function") s = target == null ? {} : null;
  else {
    try {
      const r = command.state(target, ctx);
      s = r && typeof r === "object" ? r : r == null || r === false ? null : {};
    } catch {
      return null;
    }
  }
  if (s && command.reach === true && target != null && !inReach(target, ctx)) return { ...s, disabled: true, title: TOO_FAR };
  return s;
}

/** What a verb beyond reach says. */
export const TOO_FAR = "too far";

/** Is a target within the context's reach? (No measure, or no reach given: yes.) */
export function inReach(target, ctx) {
  const reach = typeof ctx?.reach === "number" && !Number.isNaN(ctx.reach) ? ctx.reach : Infinity;
  if (reach === Infinity || typeof ctx?.distance !== "function") return true;
  let d;
  try {
    d = Number(ctx.distance(target));
  } catch {
    d = Infinity;
  }
  return Number.isFinite(d) && d <= reach;
}

/**
 * Is this command meant for this surface? An explicit `show` list decides;
 * without one, every surface it applies to (unless `strict`: then only an
 * explicit mention counts, as for the menu's scene commands).
 */
export function shownOn(command, surface, { strict = false } = {}) {
  const show = command?.show;
  if (Array.isArray(show)) return show.includes(surface);
  if (typeof show === "string") return show === surface;
  return !strict;
}

/** A command's keys, as a list. */
export const keysOf = (command) => {
  const k = command?.key;
  if (typeof k === "string" && k) return [k];
  if (Array.isArray(k)) return k.filter((x) => typeof x === "string" && x);
  return [];
};

/** Does a KeyboardEvent.key match one of this command's keys? (letters regardless of case) */
export function keyMatches(command, key) {
  if (typeof key !== "string" || !key) return false;
  for (const k of keysOf(command)) {
    if (k === key) return true;
    if (k.length === 1 && key.length === 1 && k.toLowerCase() === key.toLowerCase()) return true;
  }
  return false;
}

const KEY_NAMES = {
  Escape: "Esc",
  Delete: "Del",
  Backspace: "⌫",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  " ": "Space",
};

/** A command's first key, as a person reads it ("M", "Esc", "F2"), or "". */
export function keyLabel(command) {
  const k = keysOf(command)[0];
  if (!k) return "";
  if (KEY_NAMES[k]) return KEY_NAMES[k];
  return k.length === 1 ? k.toUpperCase() : k;
}

/** A tooltip: the state's title (else the name), with the key (the resolver's hint, where a surface has one: ../keymap.js hintFor). */
export function tooltip(command, state, key = keyLabel(command)) {
  const base = String(state?.title ?? command?.name ?? command?.id ?? "");
  return key ? `${base} (${key})` : base;
}

/** What kind of control a state calls for: "choices", "toggle" or "button". */
export function controlKind(state) {
  if (Array.isArray(state?.choices)) return "choices";
  if (typeof state?.checked === "boolean") return "toggle";
  return "button";
}

/** The choices as [{ value, label }] (a bare value is its own label). */
export function cleanChoices(choices) {
  return (Array.isArray(choices) ? choices : []).map((c) =>
    c && typeof c === "object" && "value" in c ? { value: c.value, label: String(c.label ?? c.value ?? "") } : { value: c, label: String(c ?? "") },
  );
}

/**
 * The commands that apply to a target on a surface, each with its state.
 * @param {{ ext, command }[]} flat  flatCommands()
 * @param {string | null} target
 * @param {{ scene, local }} ctx
 * @param {string} surface
 * @param {{ strict?: boolean }} [opts]
 * @returns {{ ext, command, state }[]}
 */
export function applicable(flat, target, ctx, surface, opts) {
  const out = [];
  for (const { ext, command } of flat) {
    if (surface && !shownOn(command, surface, opts)) continue;
    const state = commandState(command, target, ctx);
    if (state) out.push({ ext, command, state });
  }
  return out;
}

/** Everything a rendered control shows, as one string (to tell whether it changed). */
export function controlKey({ ext, command, state, key }) {
  const choices = Array.isArray(state.choices) ? cleanChoices(state.choices) : null;
  return JSON.stringify([ext, command.id, command.name ?? "", controlKind(state), tooltip(command, state, key), state.checked ?? null, state.value ?? null, choices, !!state.disabled, state.label ?? null]);
}

/** Has anything but these local keys changed? (a shallow compare) */
export function localChanged(prev, next, ignore = ["hovered"]) {
  if (prev === next) return false;
  if (!prev || !next) return true;
  const skip = new Set(ignore);
  for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) if (!skip.has(k) && prev[k] !== next[k]) return true;
  return false;
}
