// What a command is and when it applies (STAGE.md, "Commands"): the kernel's
// part of a command, read the same way by `api.run` and by every surface that
// shows one. Pure: no DOM, no api. What a surface does with a command (its
// `show`, keys, icon, the bar, the menu, the key map) is the surface's
// (EDITOR.md, "A command").

import { KERNEL_KINDS, holding } from "./bodies.js";

/**
 * Every running extension's commands, flattened, in running order then
 * command order. Anything that isn't a command (no id, no run) is skipped.
 * @param {{ id: string, value: any, stage?: number }[]} collected  api.collect("commands")
 * @returns {{ ext: string, command: object, stage?: number }[]}
 */
export function flatCommands(collected) {
  const out = [];
  for (const { id: ext, value, stage } of collected ?? []) {
    let list;
    try {
      list = Array.isArray(value) ? value : value && typeof value[Symbol.iterator] === "function" ? [...value] : [];
    } catch {
      continue;
    }
    // (a view plugin's collection tags each with the stage it is from: STAGE.md, "View plugins")
    for (const command of list) if (command && command.id != null && typeof command.run === "function") out.push(stage === undefined ? { ext, command } : { ext, command, stage });
  }
  return out;
}

/**
 * A command's state for a target in a context, or null when it doesn't
 * apply. In order:
 *   - `hand: kind`: it applies only while a hand of that kind is in the
 *     view's stack (`ctx.view.hands`; inHand);
 *   - `state(target, ctx)`: null (or false) doesn't apply, an object is the
 *     state; a throw doesn't apply. Without state() it applies only to the
 *     null target (the scene);
 *   - `reach: true`: beyond the body's reach it is disabled, TOO_FAR. Every
 *     caller passes the same context, `from` (the eye), `reach` (the body's,
 *     metres or Infinity) and `distance(target)`. Reach is ergonomics, not
 *     permission: Look's is Infinity.
 * @param {object} command
 * @param {string | null} target
 * @param {{ view?: object, reach?: number, distance?: (target: string) => number }} ctx  its stage reader's context(hit)
 * @returns {object | null}
 */
export function commandState(command, target, ctx) {
  if (!inHand(command, ctx?.view)) return null;
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

/**
 * Is the hand this command names held in this view (or does it name none)?
 * Whether it may apply at all, before its state: a surface may ask this
 * alone to know whether a command is there, whatever its state says now. A
 * command naming one of the kernel's own kinds (KERNEL_KINDS: a tool, a
 * popover) is never there.
 */
export const inHand = (command, view) => typeof command?.hand !== "string" || (!KERNEL_KINDS.includes(command.hand) && holding(view, command.hand));

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
