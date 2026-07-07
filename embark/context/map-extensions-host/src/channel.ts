import type maplibregl from "maplibre-gl";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { defineChannel } from "@embark/context";

// A map extension: behavior a card attaches to every map on its canvas. The
// host (see ./host, installed by the map tool) calls it with the map tool's
// element — the anchor for repo access and context discovery, so the
// extension's context traffic is attributed to the map view — and the live
// maplibre instance, once the style has loaded (sources/layers can be added
// immediately). It returns a teardown that undoes everything it did.
export type MapExtension = (
  element: ToolElement,
  map: maplibregl.Map,
) => () => void;

// Map extensions contributed by cards on the canvas. A card publishes its
// extension under a stable key in its own slice; every map tool on the canvas
// installs the union (see ./host), so a card appearing on the canvas turns its
// behavior on for every map there and removing it turns it off. Values are
// live `MapExtension` functions, not JSON, so this channel is deliberately
// typed `unknown`: each card must publish a *stable reference* (create the
// extension once) so the store's structural change-detection short-circuits by
// identity per key, and so the host doesn't tear down and reinstall on every
// emission. Generic JSON inspectors should skip this channel.
export const MapExtensions = defineChannel<Record<string, unknown>>({
  name: "map:extensions",
  empty: {},
  value: "map-extension",
});
