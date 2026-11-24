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
    // (a view plugin's collection tags each with the stage it is from: API.md, "View plugins")
    for (const command of list) if (command && command.id != null && typeof command.run === "function") out.push(stage === undefined ? { ext, command } : { ext, command, stage });
  }
  return out;
}

/**
 * The one walk every surface takes: each collected command `keep` accepts
 * (given its flat entry `{ ext, command, stage? }`), with its state for
 * `target` in `ctx` (commandState), those that apply, in collected order,
 * each with the stage it was collected from, so it runs there.
 * @param {{ id: string, value: any, stage?: number }[]} collected  a stage's or view's collect("commands")
 * @param {string | null} target
 * @param {object} ctx  its stage reader's context(hit)
 * @param {(entry: { ext: string, command: object, stage?: number }) => boolean} [keep]  the surface's filter
 * @returns {{ ext: string, command: object, state: object, stage?: number }[]}
 */
export function applicable(collected, target, ctx, keep = () => true) {
  const out = [];
  for (const entry of flatCommands(collected)) {
    if (!keep(entry)) continue;
    const state = commandState(entry.command, target, ctx);
    if (state) out.push({ ...entry, state });
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

/**
 * How far `target` is from the eye at `from` (a command context's `distance`): to the hit when it is on the
 * target or on something hanging on it (`chain(id)`: the hit object, then what it hangs on, nearest first), else
 * to the nearest point of the target's box (`box(target)`: { min, max } or null), else to its origin
 * (`worldOf(target)`: a column-major matrix or null); Infinity with no eye or none of those. Each is asked only
 * when the one before it doesn't say.
 */
export function distanceTo(from, hit, target, { chain, box, worldOf }) {
  if (!Array.isArray(from) || target == null) return Infinity;
  if (hit?.id != null && chain(hit.id).includes(target)) {
    if (Number.isFinite(hit.distance)) return hit.distance;
    if (Array.isArray(hit.point)) return Math.hypot(hit.point[0] - from[0], hit.point[1] - from[1], hit.point[2] - from[2]);
  }
  const b = box(target);
  if (b) {
    const q = [0, 1, 2].map((i) => Math.max(b.min[i], Math.min(from[i], b.max[i])));
    return Math.hypot(q[0] - from[0], q[1] - from[1], q[2] - from[2]);
  }
  const m = worldOf(target);
  return m ? Math.hypot(m[12] - from[0], m[13] - from[1], m[14] - from[2]) : Infinity;
}

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
