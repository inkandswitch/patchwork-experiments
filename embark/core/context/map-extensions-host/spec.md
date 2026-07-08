# Map extensions host

The map analog of the [codemirror extensions host](../codemirror-extensions-host):
lets cards attach behavior to every map on their canvas without the map knowing
about any of them.

- a card publishes a `MapExtension` — `(element, map) => cleanup` — under a
  stable key in its slice of the `map:extensions` channel
- the map tool calls `installMapExtensionsHost(element, map)` once; the host
  reconciles installed extensions against the channel by identity, tearing an
  extension down when its card leaves
- installation is gated on the style `load` event, so extensions can add
  sources/layers immediately
- extensions receive the *map tool's* element: repo access and context
  discovery resolve there, so extension context traffic is attributed to the
  map view
- values are live functions (not JSON); cards must publish a stable reference,
  and the registered `map-extension` context view draws a placeholder chip
