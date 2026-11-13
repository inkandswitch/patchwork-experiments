// What the key resolver (../keymap.js) needs, read from one extension's api:
// the layers that reserve keys (the open gesture's, the held tool's and the
// body's declared keys, from local), every command, the command context and
// attention. Every surface that shows a key asks hintFor with this, so what
// it shows is what the router and the key map do.

/** @returns {{ gesture, tool, body, collected, ctx, attention }} */
export function resolverState(api) {
  const local = api.local.get();
  const attention = api.attention();
  return {
    gesture: local.gesture ?? null,
    tool: local.held ?? null,
    body: local.body ?? null,
    collected: api.collect("commands"),
    ctx: api.context(attention.hit),
    attention,
  };
}
