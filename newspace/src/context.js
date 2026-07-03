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

// ── THE DRAW-CLAIM PROTOCOL ──────────────────────────────────────────────────
// "Inner things should have shapes, but they should ask their parent if it wants to draw."
// A spatial box (the map, a frame) can capture draw gestures itself — but when it's embedded
// in a canvas that CLAIMS drawing, it must let those gestures through so the canvas draws
// rough.js/perfect-freehand marks INTO the box's coordinate space (selectable, draggable out).
//
// MECHANISM (the least invasive one available): the claim rides the context OBJECT that
// editor mounts already receive (`context: ctx.context` in editor-item.jsx) — a plain
// `claims.draw` marker set by the claiming canvas via `claimDraws(context)`. No provide/
// accept transport is needed: a box gets the claiming canvas's own context object directly,
// and a NESTED canvas builds its OWN context (and claims for itself), which re-roots the
// claim exactly as ARCHITECTURE.md §3a's fallback-to-own prescribes.
export function claimDraws(context) { if (context) context.claims = { ...(context.claims || {}), draw: true }; }
export const drawsClaimed = (context) => !!(context && context.claims && context.claims.draw);

// Claims are PER-BRUSH-KIND: only draw/erase gestures are claimable. select/hand (and
// wire/text/place) are NEVER claimed — the inner tool stays live for them (panning the
// map, clicking inside an embed). This list matches the map's historical draw-vs-pan split.
export const UNCLAIMABLE_TOOLS = ["select", "hand", "wire", "text", "place"];
export const toolIsClaimable = (tool) => !!tool && !UNCLAIMABLE_TOOLS.includes(tool);

// The claim decision, PURE — the one predicate both sides consult. It is load-bearing
// beyond the map: it's how a box can be simultaneously drawable-over from outside
// (annotation), enterable (content), and viewable standalone (fallback-to-own).
//   • tool not claimable            → "none"        (select/hand/…: nobody intercepts)
//   • entered (the box — or a surface inside it — is the ACTIVE surface: entering
//     RE-ROOTS the claim; the entered surface is the top of its own chain) → "content"
//   • an ancestor canvas claims     → "annotation"  (the outer canvas draws, parented onto the box)
//   • standalone / nobody claims    → "own"         (the box's fallback captures its own draws)
export function drawClaim({ tool, claimed, entered }) {
  if (!toolIsClaimable(tool)) return "none";
  if (entered) return "content";
  return claimed ? "annotation" : "own";
}

export const CONTEXT_SELECTORS = {
  camera: "sketchy:camera",
  pointer: "sketchy:pointer",
  tool: "sketchy:tool",
  brush: "sketchy:brush-config", // distinct from the "sketchy:brush" PLUGIN type
  selection: "sketchy:selection",
};

// A `Source` with a `.set()` (alias of push) and an `.owned()` flag.
//
// OWNERSHIP is per-write, not a one-way latch: a provider's value marks the
// source not-owned (`_accepted`, on EVERY provided push), and a LOCAL `set()`
// RECLAIMS ownership. Without the reclaim, a parent canvas unmounting left a
// nested canvas frozen on the last provided value forever — the providers
// package has no provider-close signal, so "the provider went away" is
// undetectable directly; re-owning on local writes is the best local
// mitigation (the next gesture on the orphaned canvas takes the value back).
// RESIDUAL LIMITATION: between the parent unmounting and the first local
// set(), the source still reports the stale provided value / owned()=false —
// see the subscribe site below. TODO: adopt a provider-close signal if
// patchwork-providers ever grows one, and drop this workaround.
function contextSource(initial) {
  const src = new Source(initial);
  let owned = true;
  src.set = (v) => { owned = true; src.push(v); }; // a local write reclaims ownership
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
      // (1) accept an external provider's value, if any answers. NOTE: there is
      // no provider-CLOSE signal in patchwork-providers, so we can't hear the
      // provider go away — `_accepted` marks not-owned per push, and a local
      // `set()` reclaims (see contextSource). Until that first local write, an
      // orphaned nested canvas keeps showing the provider's last value.
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
