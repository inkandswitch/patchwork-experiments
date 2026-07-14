// Commands card behavior, loaded by the shared card shell as this package's
// `card.js`. While the card sits face-up on a canvas it publishes the
// slash-command codemirror extension (./extension.js) into that canvas's
// `codemirror:extensions` channel, so the host extension (installed in every
// editor) turns the `/` menu on there; flipping or removing the card releases
// the slice and turns it back off. It renders nothing into the middle slot —
// the face is drawn by the shell.
//
// Plain-JS bundleless module: bare imports are importmap-provided; channel
// definitions from sibling packages are imported by their automerge urls.

import { slashCommands } from "./extension.js";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

const { getContextHandle } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { CodemirrorExtensions } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "channels/codemirror.js")
);

// The suggestion context view rides this module's `plugins` export: the card
// shell registers it when the card first turns face-up and keeps it until the
// card leaves the canvas.
export const plugins = [
  {
    type: "embark:context-view",
    id: "suggestion-context-view",
    name: "Command suggestion context view",
    supports: ["suggestion"],
    async load() {
      const { suggestionView } = await import("./views.js");
      return suggestionView;
    },
  },
];

export default function card(_handle, element) {
  // The extension is created ONCE and held by reference so the context
  // store's change-detection compares by identity rather than recursing into
  // CodeMirror internals.
  const scope = getContextHandle(element, CodemirrorExtensions);
  const extension = slashCommands();
  scope.change((slice) => {
    slice["commands"] = extension;
  });
  return () => scope.release();
}
