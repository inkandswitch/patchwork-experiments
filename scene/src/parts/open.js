// Open (EDITOR.md, "A command"; PLANS.md §5): going into a thing to edit what's
// inside, in place. A command with `open: true` is an Open (scene.links'
// Enter of a link; a package's editor for its content, such as patchwork-cad's
// model editor); a target's Open is the first that applies to it, in running
// order. The inspector's header, the menu, the outline, Enter and a
// double-click in Edit all run this one.
import { focusReader } from "../per-focus.js";

/**
 * The target's Open: { ext, command, state, stage? }, or null when none
 * applies (or the one that would is disabled). One whose state throws
 * doesn't apply.
 * @param {{ id: string, value: any, stage?: number }[]} collected  api.collect("commands")
 */
export function openFor(collected, target, ctx) {
  if (target == null) return null;
  for (const { id: ext, value, stage } of collected ?? []) {
    for (const command of Array.isArray(value) ? value : []) {
      if (command?.open !== true || command.id == null || typeof command.run !== "function" || typeof command.state !== "function") continue;
      let state;
      try {
        state = command.state(target, ctx);
      } catch {
        state = null;
      }
      if (state == null || state === false) continue;
      const s = typeof state === "object" ? state : {};
      if (s.disabled) return null;
      return { ext, command, state: s, ...(stage !== undefined ? { stage } : {}) };
    }
  }
  return null;
}

/** Run `target`'s Open, through a view plugin's api, in its focus stage. @returns whether there was one */
export function runOpen(api, target) {
  const r = focusReader(api);
  if (!r || target == null) return false;
  const o = openFor(api.collect("commands"), target, r.context(null));
  if (!o) return false;
  api.run({ ...(o.stage !== undefined ? { stage: o.stage } : {}), ext: o.ext, command: o.command.id, target });
  return true;
}
