// The `map:extensions` channel, owned by the core package — an editor-owned
// socket, not a card: the values are live `MapExtension` functions installed
// by every map tool (src/host.ts), so a card makes no sense as the owner.
//
// A map extension is behavior a card attaches to every map on its canvas:
// `(element, map) => teardown`, called with the map tool's element — the
// anchor for repo access and context discovery, so the extension's context
// traffic is attributed to the map view — and the live maplibre instance,
// once the style has loaded (sources/layers can be added immediately).
//
// A card publishes its extension under a stable key in its own slice; every
// map tool on the canvas installs the union, so a card appearing on the
// canvas turns its behavior on for every map there and removing it turns it
// off. Values are live functions, not JSON, so this channel is deliberately
// typed `unknown`: each card must publish a *stable reference* (create the
// extension once) so the store's structural change-detection short-circuits
// by identity per key, and so the host doesn't tear down and reinstall on
// every emission. Generic JSON inspectors should skip this channel.
//
// This module is the canonical definition — publisher cards import it by the
// core package's automerge url; the bundled host (context/map-extensions-host)
// re-exports it from src/channel.ts.

// The core package's own automerge url (pushwork rootUrl), self-reference for
// attribution.
const CORE_PACKAGE_URL = "automerge:2YxstDCjGbfeAqud8w38yuBYBncY";

/** `{ [stableKey]: MapExtension }` */
export const MapExtensions = {
  name: "map:extensions",
  empty: {},
  value: "map-extension",
  definedBy: `${CORE_PACKAGE_URL}/channels/map.js`,
  spec: `${CORE_PACKAGE_URL}/context/map-extensions-host/spec.md`,
};
