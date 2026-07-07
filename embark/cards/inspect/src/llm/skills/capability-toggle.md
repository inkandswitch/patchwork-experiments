# Capability toggles

The simplest card archetype: while the card sits face-up on the canvas, a
feature is on; flip or remove the card and it's off. The card publishes a
value into a channel in setup and releases it in cleanup — nothing else. The
card shell already handles the flip (it tears your module down), so "off" is
just your cleanup running.

The main case is publishing a CodeMirror extension into
`codemirror:extensions`, which the host installs into every editor on the
canvas:

```js
import { keymap } from "@codemirror/view"; // codemirror is in the importmap

const CodemirrorExtensions = { name: "codemirror:extensions", empty: {} };

export default (handle, element) => {
  const store = findContextStore(element);
  const scope = store.handle(CodemirrorExtensions, ownerOf(element));

  // Create the extension ONCE and publish that same reference. This channel
  // carries live objects, and the store's change-detection compares them by
  // identity per key — a fresh object every write would recurse into
  // CodeMirror internals.
  const extension = keymap.of([/* ... */]);
  scope.change((slice) => { slice["my-feature"] = extension; });

  return () => scope.release();
};
```

- The slice key (`"my-feature"`) is your stable name for the capability. Two
  cards publishing under the same key collide (last writer wins) — which is
  exactly how duplicate toggle cards degrade gracefully: the feature is
  simply on while at least one is face-up.
- The same shape works for any "provide a thing while present" channel — the
  toggle pattern isn't specific to CodeMirror.
- Off-canvas (no editors, no host) the write is harmless; the card just does
  nothing.
