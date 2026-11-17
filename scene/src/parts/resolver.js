// What the key resolver (../keymap.js) needs, read from a view plugin's api:
// the layers that reserve keys (the open gesture's, the held tool's and the
// body's declared keys, from local), every command, the command context and
// attention. Every surface that shows a key asks hintFor with this, and the
// key map dispatches with it, so what a surface shows is what a key does.

import { elementOf } from "../stage/paths.js";

/**
 * The command context keys are resolved in, from attention: its hit, else
 * the look (with a selection, attention's hit is null, but where the eye is
 * still decides the distance to the target and the point on it). The one
 * place it is built: hints (resolverState), the key map and the prompt all
 * ask this, so a hint and its key are decided in the same context.
 * @param {{ context(hit): object, look(): object | null }} reader  a stage's (api.path())
 * @param {{ selected?, hit? }} attention
 */
export function keyContext(reader, attention) {
  return reader.context(attention?.hit ?? reader.look());
}

/**
 * The full path attention is pinned to while a held verb is (scene.keys says
 * which, as its "keymap" contribution: the links from the outermost in, then
 * its id), else null. A pin is attention held to a path, as a selection is:
 * each stage on it sees its own element of it.
 */
export function keyPinned(api) {
  const km = (api.collect("keymap") ?? []).map((r) => r?.value).find((v) => v && typeof v.pinned === "function");
  const pinned = km?.pinned();
  return Array.isArray(pinned) && pinned.length ? pinned : null;
}

/**
 * @param {object} api  a view plugin's
 * @param {string[] | null} [pinned]  keyPinned(api) unless given (the key map gives its own)
 * @returns {{ gesture, tool, body, collected, segments }}
 */
export function resolverState(api, pinned = keyPinned(api)) {
  const view = api.view.get();
  // the input path's stages, innermost first, the focus always among them
  // (STAGE.md, "The input chain"): each its own commands, in its own context, at its
  // own element of attention; a held verb holds attention to its target's
  // path, wherever the selection and the look have gone since
  const segments = api.path(pinned ? { at: pinned } : undefined).map((seg) => {
    const att = pinned ? Object.freeze({ selected: elementOf(pinned, seg.path), hit: null }) : seg.attention();
    return { stage: seg.stage, reader: seg, collected: seg.collect("commands"), ctx: keyContext(seg, att), attention: att };
  });
  return {
    gesture: view.gesture ?? null,
    tool: view.held ?? null,
    body: view.body ?? null,
    collected: segments.flatMap((s) => s.collected),
    segments,
  };
}
