// What the key resolver (../keymap.js) needs, read from one extension's api:
// the layers that reserve keys (the open gesture's, the held tool's and the
// body's declared keys, from local), every command, the command context and
// attention. Every surface that shows a key asks hintFor with this, and the
// key map dispatches with it, so what a surface shows is what a key does.

/**
 * The command context keys are resolved in, from attention: its hit, else
 * the look (with a selection, attention's hit is null, but where the eye is
 * still decides the distance to the target and the point on it). The one
 * place it is built: hints (resolverState), the key map and the prompt all
 * ask this, so a hint and its key are decided in the same context.
 * @param {{ context(hit): object, look(): object | null }} api
 * @param {{ selected?, hit? }} attention
 */
export function keyContext(api, attention) {
  return api.context(attention?.hit ?? api.look());
}

/**
 * Attention as keys see it: pinned to a held verb's target while one is held
 * (scene.keys says which, as its "keymap" contribution), else api.attention().
 */
export function keyAttention(api) {
  const km = (api.collect("keymap") ?? []).map((r) => r?.value).find((v) => v && typeof v.pinned === "function");
  const pinned = km?.pinned();
  return pinned !== undefined ? Object.freeze({ selected: pinned, hit: null }) : api.attention();
}

/**
 * @param {object} api
 * @param {{ selected?, hit? }} [attention]  keyAttention(api) unless given (the key map gives its own)
 * @returns {{ gesture, tool, body, collected, ctx, attention }}
 */
export function resolverState(api, attention = keyAttention(api)) {
  const local = api.view.get();
  return {
    gesture: local.gesture ?? null,
    tool: local.held ?? null,
    body: local.body ?? null,
    collected: api.collect("commands"),
    ctx: keyContext(api, attention),
    attention,
  };
}
