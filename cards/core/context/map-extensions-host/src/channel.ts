import type maplibregl from "maplibre-gl";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";

// The canonical channel definition lives in the core package root's
// hand-written channels/map.js (with `definedBy`/`spec` attribution) so
// publisher cards can import it by the core package's automerge url; the
// bundled host code re-exports it from there.
export { MapExtensions } from "../../../channels/map.js";

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
