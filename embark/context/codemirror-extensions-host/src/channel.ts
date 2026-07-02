import { defineChannel } from "@embark/context";

// CodeMirror extensions contributed by cards on the canvas. A card publishes its
// codemirror extension under a stable key in its own slice; the globally-
// installed host extension (see ./host) reads the union and installs them into a
// compartment, so a card appearing on the canvas turns its behavior on for every
// editor in that canvas and removing it turns it off. Values are live CodeMirror
// `Extension` objects, not JSON, so this channel is deliberately typed
// `unknown`: the substrate keeps no CodeMirror dependency, and each card must
// publish a *stable reference* (create the extension once) so the store's
// structural change-detection short-circuits by identity per key rather than
// recursing into CodeMirror internals. Generic JSON inspectors should skip this
// channel.
export const CodemirrorExtensions = defineChannel<Record<string, unknown>>({
  name: "codemirror:extensions",
  empty: {},
});
