// Pointer card behavior, loaded by the shared card shell as this package's
// `card.js`. While face-up it listens to the page's pointer events and
// publishes the pointer's position, the document under it, and whether a
// button is held into the `pointer` channel (./channels.js). That's all it
// does: it reports, and readers decide what the pointer means (the inspect
// tool's target picker follows it while armed). Renders nothing into the
// middle slot.
//
// The card knows nothing about the canvas. The document under the pointer is
// resolved generically: the closest enclosing `<patchwork-view>` names the
// document it renders via its `doc-url` (legacy) or `url` (component mode)
// attribute, wherever that view is mounted — a canvas embed, a sidebar card,
// a full-frame editor.
//
// Plain-JS bundleless module: bare imports are importmap-provided; the core
// platform is imported by its automerge url.

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

import { Pointer } from "./channels.js";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

const { getContextHandle } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);

export default function card(_handle, element) {
  const pointer = getContextHandle(element, Pointer);

  // Publishing is rAF-throttled: events only stash the latest state, and one
  // frame callback writes it, so a fast pointermove burst costs one context
  // write per frame.
  let frame = 0;
  let last;
  let pressed = false;

  const publish = () => {
    frame = 0;
    const event = last;
    if (!event) return;

    const target = event.target instanceof Element ? event.target : null;
    const view = target?.closest("patchwork-view");
    const docUrl =
      view?.getAttribute("doc-url") ?? view?.getAttribute("url") ?? undefined;

    pointer.change((slice) => {
      slice.x = Math.round(event.clientX);
      slice.y = Math.round(event.clientY);
      slice.pressed = pressed;
      if (docUrl) slice.docUrl = docUrl;
      else delete slice.docUrl;
    });
  };

  const schedule = (event) => {
    last = event;
    if (!frame) frame = requestAnimationFrame(publish);
  };
  const onMove = (event) => schedule(event);
  const onDown = (event) => {
    pressed = true;
    schedule(event);
  };
  const onUp = (event) => {
    pressed = false;
    schedule(event);
  };
  // A press that ends outside the window (release off-screen, touch scroll
  // cancel, cmd-tab away) never delivers pointerup here; without the reset
  // `pressed` sticks at true and the next press has no rising edge — readers
  // doing edge detection would silently miss it.
  const onBlur = () => {
    if (!pressed || !last) return;
    pressed = false;
    schedule(last);
  };

  // Capture phase, so views that stop propagation (drag surfaces, editors)
  // can't hide the pointer from the card.
  document.addEventListener("pointermove", onMove, { capture: true });
  document.addEventListener("pointerdown", onDown, { capture: true });
  document.addEventListener("pointerup", onUp, { capture: true });
  document.addEventListener("pointercancel", onUp, { capture: true });
  window.addEventListener("blur", onBlur);

  return () => {
    document.removeEventListener("pointermove", onMove, { capture: true });
    document.removeEventListener("pointerdown", onDown, { capture: true });
    document.removeEventListener("pointerup", onUp, { capture: true });
    document.removeEventListener("pointercancel", onUp, { capture: true });
    window.removeEventListener("blur", onBlur);
    if (frame) cancelAnimationFrame(frame);
    // Releasing drops this card's slice, so the pointer channel goes quiet.
    pointer.release();
  };
}
