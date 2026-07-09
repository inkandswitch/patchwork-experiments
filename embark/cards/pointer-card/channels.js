// The `pointer` channel, owned by the Pointer card (the existing precedent for
// the card-owns-its-channel model). The card publishes where the pointer is
// right now, which document it is over, and whether a button is held.
// Single-writer (one card), so the merged value is just that card's slice;
// with no pointer card running the channel rests at its empty value. `docUrl`
// is absent while the pointer is over no `<patchwork-view>`. Readers import
// this definition by this package's automerge url.

// This package's own automerge url (pushwork rootUrl), self-reference for
// attribution.
const PACKAGE_URL = "automerge:uMCUHr7SvWiwF1YtmZsWhnUhWY2";

/**
 * @typedef {{ x?: number, y?: number, docUrl?: string, pressed?: boolean }} PointerState
 */

export const Pointer = {
  name: "pointer",
  empty: {},
  definedBy: `${PACKAGE_URL}/channels.js`,
  spec: `${PACKAGE_URL}/spec.md`,
};
