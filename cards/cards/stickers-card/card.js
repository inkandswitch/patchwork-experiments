// Stickers card behavior, loaded by the shared card shell as this package's
// `card.js`. While the card sits face-up on a canvas it publishes the sticker
// renderer codemirror extension (./renderer.js) into that canvas's
// `codemirror:extensions` channel, so the host extension (installed in every
// editor) draws stickers there; flipping or removing the card releases the
// slice and stops drawing them. It renders nothing into the middle slot — the
// face is drawn by the shell.
//
// Plain-JS bundleless module: bare imports are importmap-provided; channel
// definitions from sibling packages are imported by their automerge urls.

import { stickerRenderer } from "./renderer.js";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

const { getContextHandle } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { CodemirrorExtensions } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "channels/codemirror.js")
);

// The sticker context view rides this module's `plugins` export: the card
// shell registers it when the card first turns face-up and keeps it until the
// card leaves the canvas.
export const plugins = [
  {
    type: "embark:context-view",
    id: "sticker-context-view",
    name: "Sticker context view",
    supports: ["sticker"],
    async load() {
      const { stickerView } = await import("./views.js");
      return stickerView;
    },
  },
];

export default function card(_handle, element) {
  // The extension is created ONCE and held by reference so the context
  // store's change-detection compares by identity rather than recursing into
  // CodeMirror internals.
  const scope = getContextHandle(element, CodemirrorExtensions);
  const extension = stickerRenderer();
  scope.change((slice) => {
    slice["stickers"] = extension;
  });
  return () => scope.release();
}
