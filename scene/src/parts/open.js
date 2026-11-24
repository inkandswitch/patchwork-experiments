// Open (EDITOR.md, "A command"; PLANS.md §5): going into a thing to edit what's
// inside, in place. A command with `open: true` is an Open (scene.links'
// Enter of a link; a package's editor for its content, such as patchwork-cad's
// model editor); a target's Open is the first that applies to it, in running
// order. The inspector's header, the menu, the outline, Enter and a
// double-click in Edit all run this one.
import { applicable } from "../stage/public.js";
import { focusReader } from "../per-focus.js";

/**
 * The target's Open: { ext, command, state, stage? }, or null when none
 * applies (or the one that would is disabled). Whether one applies is the
 * kernel's walk (its hand, its state, its reach), as on every surface.
 * @param {{ id: string, value: any, stage?: number }[]} collected  api.collect("commands")
 */
export function openFor(collected, target, ctx) {
  if (target == null) return null;
  const first = applicable(collected, target, ctx, ({ command }) => command.open === true)[0] ?? null;
  return first && !first.state.disabled ? first : null;
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
