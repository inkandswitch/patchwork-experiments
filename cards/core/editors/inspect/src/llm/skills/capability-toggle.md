# Capability toggles

The simplest card archetype: while the card sits face-up on the canvas, a
feature is on; flip or remove the card and it's off. The card publishes a
value into a channel in setup and releases it in cleanup — nothing else. The
card shell already handles the flip (it tears your module down), so "off" is
just your cleanup running.

The main case is publishing a CodeMirror extension into
`codemirror:extensions`, owned by `@embark/core` (which also ships the host
that installs the union into every editor on the canvas):

```js
import { keymap } from "@codemirror/view"; // codemirror is in the importmap
import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

const { getContextHandle } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { CodemirrorExtensions } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "channels/codemirror.js")
);

export default (handle, element) => {
  const scope = getContextHandle(element, CodemirrorExtensions);

  // Create the extension ONCE and publish that same reference. This channel
  // carries live objects, and the store's change-detection compares them by
  // identity per key — a fresh object every write would recurse into
  // CodeMirror internals.
  const extension = keymap.of([/* ... */]);
  scope.change((slice) => { slice["my-feature"] = extension; });

  return () => scope.release();
};
```

Declare the dependency in `package.json`:

```json
"dependencies": {
  "@embark/core": "automerge:2YxstDCjGbfeAqud8w38yuBYBncY"
}
```

- The slice key (`"my-feature"`) is your stable name for the capability. Two
  cards publishing under the same key collide (last writer wins) — which is
  exactly how duplicate toggle cards degrade gracefully: the feature is
  simply on while at least one is face-up.
- The same shape works for any "provide a thing while present" channel — the
  toggle pattern isn't specific to CodeMirror. The map equivalent is
  `map:extensions` (see map-extensions).
- Off-canvas (no editors, no host) the write is harmless; the card just does
  nothing.
