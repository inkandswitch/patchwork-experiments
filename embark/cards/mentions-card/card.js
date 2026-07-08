// Mentions card behavior, loaded by the shared card shell as this package's
// `card.js`. While the card sits face-up on a canvas it publishes the @mention
// codemirror extension (./extension.js) into that canvas's
// `codemirror:extensions` channel, so the host extension (installed in every
// editor) turns mentions on there; flipping or removing the card releases the
// slice and turns them back off. It renders nothing into the middle slot —
// the face is drawn by the shell.
//
// Plain-JS bundleless module: bare imports are importmap-provided; channel
// definitions from sibling packages are imported by their automerge urls.

import { mentionSearch } from "./extension.js";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

const { getContextHandle } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { CodemirrorExtensions } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "channels/codemirror.js")
);

export default function card(_handle, element) {
  // The extension is created ONCE and held by reference so the context
  // store's change-detection compares by identity rather than recursing into
  // CodeMirror internals.
  const scope = getContextHandle(element, CodemirrorExtensions);
  const extension = mentionSearch();
  scope.change((slice) => {
    slice["mentions"] = extension;
  });
  return () => scope.release();
}
