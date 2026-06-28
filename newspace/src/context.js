// The canvas CONTEXT — camera / pointer / tool / brush / selection, each a
// `Source` opstream (snapshot-only, so no wasteful op-history), obtained via the
// provide/accept protocol with FALLBACK-TO-OWN.
//
// For each entry the canvas:
//   1. `subscribe`s for an external provider (selector e.g. "sketchy:camera"). If
//      one answers, the Source mirrors it and we're no longer the owner.
//   2. owns it otherwise — `.set(v)` drives the Source (fallback-to-own).
//   3. `accept`s the same selector so DESCENDANTS (nested canvases in nested
//      patchwork-views) can subscribe to OUR value. Per-selector, so a box can
//      inherit `tool`/`brush` from the parent while owning its `pointer`/`camera`.
//
// Transport is JSON over a MessagePort (provide/accept) — you can't send an
// opstream object across it; the `Source` is the LOCAL face, the provider wraps
// its emissions into `respond(value)`.
import { subscribe, accept } from "@inkandswitch/patchwork-providers";
import { Source, isSnapshot } from "./opstreams.js";

export const CONTEXT_SELECTORS = {
  camera: "sketchy:camera",
  pointer: "sketchy:pointer",
  tool: "sketchy:tool",
  brush: "sketchy:brush-config", // distinct from the "sketchy:brush" PLUGIN type
  selection: "sketchy:selection",
};

// A `Source` with a `.set()` (alias of push) and an `.owned()` flag.
function contextSource(initial) {
  const src = new Source(initial);
  src.set = (v) => src.push(v);
  let owned = true;
  src.owned = () => owned;
  src._accepted = () => { owned = false; };
  return src;
}

export function createCanvasContext(element, { fallbacks = {}, selectors = CONTEXT_SELECTORS } = {}) {
  const ctx = {};
  const teardowns = [];

  for (const key of Object.keys(selectors)) {
    const sel = { type: selectors[key] };
    const source = contextSource(fallbacks[key]);

    if (element) {
      // (1) accept an external provider's value, if any answers
      try {
        const off = subscribe(element, sel, (value) => {
          source._accepted();
          source.push(value);
        });
        teardowns.push(off);
      } catch {
        // provide/accept transport unavailable (e.g. no MessageChannel) — own it
      }

      // (3) provide our value to descendants
      const onSub = (e) => {
        if (e.detail?.selector?.type !== sel.type) return;
        accept(e, (respond) => source.connect((op) => respond(isSnapshot(op) ? op.value : source.value)));
      };
      element.addEventListener("patchwork:subscribe", onSub);
      teardowns.push(() => element.removeEventListener("patchwork:subscribe", onSub));
    }

    ctx[key] = source;
  }

  ctx.selectors = selectors;
  ctx.destroy = () => { for (const t of teardowns) { try { t(); } catch {} } };
  return ctx;
}
