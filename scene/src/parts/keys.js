// scene.keys: the key map. Unclaimed keys become command invocations (M,
// F, P, G/R/H, Escape, Delete are commands, each from its own part).
//
// A key runs the first command whose `key` matches (letters in either case)
// that applies to, in turn, the selection, the scene, then the hovered object
// (STAGE.md, "A command"); within one target, in running order then command
// order. What you chose comes first, whatever kind of target it is (an
// object, or a ref such as a dimension: its owner's commands answer for it);
// then scene-wide commands (Escape); the object under the pointer only last,
// for scenes where nothing gets selected (a game table: S shuffles the pile
// you're pointing at). So Delete removes the selection, never something you
// merely passed over while something was selected. Keys work whatever a
// command's `show` says. With ctrl or meta held a key is the
// browser's (copy, reload…). An auto-repeated key that matches is claimed but
// not run again, so holding M doesn't flicker the measure tool and holding
// Delete doesn't remove one thing after another.

import { commandState, flatCommands, keyMatches } from "./toolbar-commands.js";

/**
 * The invocation a key makes, or null. Pure (given the collected commands).
 * @param {{ id, value }[]} collected  api.collect("commands")
 * @param {string} key  KeyboardEvent.key
 * @param {{ scene, local }} ctx
 * @returns {{ ext, command, target } | null}
 */
export function invocationFor(collected, key, ctx) {
  const matching = flatCommands(collected).filter(({ command }) => keyMatches(command, key));
  if (!matching.length) return null;
  const objects = ctx.scene?.objects ?? {};
  const targets = [];
  const sel = ctx.local?.selected;
  const hov = ctx.local?.hovered;
  if (sel != null) targets.push(sel);
  targets.push(null);
  if (hov != null && objects[hov] && hov !== sel) targets.push(hov);
  for (const target of targets) {
    for (const { ext, command } of matching) {
      const s = commandState(command, target, ctx);
      if (s && !s.disabled) return { ext, command: command.id, target };
    }
  }
  return null;
}

function create(api) {
  return {
    input: {
      key(ev) {
        if (ev.ctrl || ev.meta || typeof ev.key !== "string") return false;
        const inv = invocationFor(api.collect("commands"), ev.key, {
          scene: api.scene(),
          local: api.local.get(),
        });
        if (!inv) return false;
        if (ev.repeat) return true;
        return api.run(inv);
      },
    },
  };
}

export default { create };
