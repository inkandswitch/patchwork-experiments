// The `codemirror:extensions` channel, owned by the core package — an
// editor-owned socket, not a card: the values are live CodeMirror `Extension`
// objects installed by the globally-registered host extension (src/host.ts),
// so a card makes no sense as the owner.
//
// A card publishes its codemirror extension under a stable key in its own
// slice; the host extension (installed in every markdown editor) reads the
// union and installs it into a compartment, so a card appearing on the canvas
// turns its behavior on for every editor in that canvas and removing it turns
// it off. Values are live objects, not JSON, so this channel is deliberately
// typed `unknown`: the substrate keeps no CodeMirror dependency, and each card
// must publish a *stable reference* (create the extension once) so the store's
// structural change-detection short-circuits by identity per key rather than
// recursing into CodeMirror internals. Generic JSON inspectors should skip
// this channel.
//
// This module is the canonical definition — publisher cards import it by the
// core package's automerge url; the bundled host
// (context/codemirror-extensions-host) re-exports it from src/channel.ts.

// The core package's own automerge url (pushwork rootUrl), self-reference for
// attribution.
const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

/** `{ [stableKey]: Extension }` */
export const CodemirrorExtensions = {
  name: "codemirror:extensions",
  empty: {},
  value: "codemirror-extension",
  definedBy: `${CORE_PACKAGE_URL}/channels/codemirror.js`,
  spec: `${CORE_PACKAGE_URL}/context/codemirror-extensions-host/spec.md`,
};
