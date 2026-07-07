import type { AutomergeUrl } from "@automerge/automerge-repo";
import type { ToolRender } from "@inkandswitch/patchwork-plugins";
import { getContextHandle } from "@embark/context";
import { Pointer, type PointerState } from "./channels";

// Pointer card behavior, loaded by the shared card shell as this package's
// `card.js`. While face-up it listens to the page's pointer events and
// publishes the pointer's position, the embed under it, and whether a button
// is held into the `pointer` channel (defined in ./channels). That's all it
// does — it reports, and readers decide what the pointer means: the context
// viewer follows it (highlighting and previewing the hovered embed) only
// while its target mode is armed. Renders nothing into the middle slot.
const card: ToolRender = (_handle, element) => {
  const pointer = getContextHandle(element, Pointer);

  // Publishing is rAF-throttled: events only stash the latest state, and one
  // frame callback writes it, so a fast pointermove burst costs one context
  // write per frame.
  let frame = 0;
  let last: PointerEvent | undefined;
  let pressed = false;

  const publish = () => {
    frame = 0;
    const event = last;
    if (!event) return;

    // The embed under the pointer: the canvas wraps each embed in a
    // `[data-embed-id]` element whose `<patchwork-view>` carries the doc url —
    // the same structure `requireOwner` reads, so the channel names embeds the
    // way the rest of the context system does.
    const target = event.target instanceof Element ? event.target : null;
    const embed = target?.closest("[data-embed-id]");
    const view = target?.closest("patchwork-view") ?? embed?.querySelector("patchwork-view");
    const docUrl = (view?.getAttribute("doc-url") ?? undefined) as
      | AutomergeUrl
      | undefined;
    const embedId = embed?.getAttribute("data-embed-id") ?? undefined;

    pointer.change((slice: PointerState) => {
      slice.x = Math.round(event.clientX);
      slice.y = Math.round(event.clientY);
      slice.pressed = pressed;
      if (docUrl) slice.docUrl = docUrl;
      else delete slice.docUrl;
      if (embedId) slice.embedId = embedId;
      else delete slice.embedId;
    });
  };

  const schedule = (event: PointerEvent) => {
    last = event;
    if (!frame) frame = requestAnimationFrame(publish);
  };
  const onMove = (event: PointerEvent) => schedule(event);
  const onDown = (event: PointerEvent) => {
    pressed = true;
    schedule(event);
  };
  const onUp = (event: PointerEvent) => {
    pressed = false;
    schedule(event);
  };

  // Capture-phase window listeners, so embeds that stop propagation (drag
  // surfaces, editors) can't hide the pointer from the card.
  window.addEventListener("pointermove", onMove, { capture: true });
  window.addEventListener("pointerdown", onDown, { capture: true });
  window.addEventListener("pointerup", onUp, { capture: true });
  window.addEventListener("pointercancel", onUp, { capture: true });

  return () => {
    window.removeEventListener("pointermove", onMove, { capture: true });
    window.removeEventListener("pointerdown", onDown, { capture: true });
    window.removeEventListener("pointerup", onUp, { capture: true });
    window.removeEventListener("pointercancel", onUp, { capture: true });
    if (frame) cancelAnimationFrame(frame);
    // Releasing drops this card's slice, so the pointer channel goes quiet.
    pointer.release();
  };
};

export default card;
