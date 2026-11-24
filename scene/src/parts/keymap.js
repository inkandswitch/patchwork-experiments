// The key map's resolver (EDITOR.md, "The use prompt and key map"): where a
// key goes once the key order (../key-order.js) leaves it to the key map, and the
// key a surface shows for a verb. Pure: no api, no DOM.
//
// A shown key works by construction: every surface that shows a command's
// key (the prompt, the menu, the bar) asks `hintFor`, which resolves that key
// exactly as the key map dispatches it, and shows it only when it would
// reach that command on that target.
//
// Attention is one target per view: the selection if any, else the look
// (the pointer's hit, or the eye ray under lock). Its path is the selection
// itself, or the look's chain: the hit, then what it is attached to,
// nearest first (looking at a spoke of the wheel reaches the helm's verbs
// when the spoke has none for that key). The key map tries the path, then
// the scene (the null target).

import { codeOfKey, commandState, flatCommands, labelOf, lookChain, reservedBy } from "../stage/public.js";
import { keyMatches, keysOf } from "./toolbar-commands.js";

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
 * The segments the key map visits (STAGE.md, "Keys"): attention's path,
 * one per stage, innermost first, each with its own commands, context and
 * attention; a state with none is one segment of its own fields.
 */
export const segmentsOf = (state) => (Array.isArray(state?.segments) && state.segments.length ? state.segments : [{ stage: undefined, collected: state?.collected ?? [], ctx: state?.ctx, attention: state?.attention }]);

/**
 * The whole resolver: where a key goes. Escape is the ladder's (null here).
 * @param {{ key: string, code?: string | null }} k
 * @param {{ gesture?, hands?, body?, collected, ctx, attention }} state
 * @returns {{ layer: "gesture" | "hand" | "body" } | { layer: "map", invocation: object } | null}
 */
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
 * @param {{ gesture?, hands?, body?, collected, ctx, attention }} state
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
