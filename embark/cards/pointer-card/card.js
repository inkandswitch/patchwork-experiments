// Pointer card behavior, loaded by the shared card shell as this package's
// `card.js`. While face-up it listens for mousedown anywhere on the page and
// publishes where the press landed — viewport x/y plus the document under it —
// into the `pointer` channel (./channels.js). That's all it does: it reports,
// and readers decide what the pointed-at document means. Renders nothing into
// the middle slot.
//
// The card knows nothing about the canvas. The document under the press is
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

  // Capture-phase document listener, so views that stop propagation (drag
  // surfaces, editors) can't hide the press from the card.
  const onMouseDown = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const view = target?.closest("patchwork-view");
    const docUrl =
      view?.getAttribute("doc-url") ?? view?.getAttribute("url") ?? undefined;

    pointer.change((slice) => {
      slice.x = Math.round(event.clientX);
      slice.y = Math.round(event.clientY);
      if (docUrl) slice.docUrl = docUrl;
      else delete slice.docUrl;
    });
  };

  document.addEventListener("mousedown", onMouseDown, { capture: true });

  return () => {
    document.removeEventListener("mousedown", onMouseDown, { capture: true });
    // Releasing drops this card's slice, so the pointer channel goes quiet.
    pointer.release();
  };
}
