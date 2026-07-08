// Geo Shapes card behavior, loaded by the shared card shell as this package's
// `card.js`. While the card sits face-up on a canvas it publishes the
// geo-shape renderer (./renderer.js) into that canvas's `map:extensions`
// channel, so every map there draws the `geo:shapes` union; flipping or
// removing the card releases the slice and the shapes disappear. It renders
// nothing into the middle slot — the face is drawn by the shell.
//
// Plain-JS bundleless module: bare imports are importmap-provided; channel
// definitions from sibling packages are imported by their automerge urls.

import { geoShapeRenderer } from "./renderer.js";

import { getImportableUrlFromAutomergeUrl } from "@inkandswitch/patchwork-filesystem";

const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

const { getContextHandle } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "client.js")
);
const { MapExtensions } = await import(
  getImportableUrlFromAutomergeUrl(CORE_PACKAGE_URL, "channels/map.js")
);

// The geo-shape context view rides this module's `plugins` export: the card
// shell registers it when the card first turns face-up and keeps it until the
// card leaves the canvas.
export const plugins = [
  {
    type: "embark:context-view",
    id: "geo-shape-context-view",
    name: "Geo shape context view",
    supports: ["geo-shape"],
    async load() {
      const { geoShapeView } = await import("./views.js");
      return geoShapeView;
    },
  },
];

export default function card(_handle, element) {
  // The extension is created ONCE and held by reference so the context
  // store's change-detection compares by identity, and so the host doesn't
  // tear it down and reinstall on every emission.
  const scope = getContextHandle(element, MapExtensions);
  const extension = geoShapeRenderer();
  scope.change((slice) => {
    slice["geo-shapes"] = extension;
  });
  return () => scope.release();
}
