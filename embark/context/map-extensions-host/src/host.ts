import type maplibregl from "maplibre-gl";
import type { ToolElement } from "@inkandswitch/patchwork-plugins";
import { subscribeContext } from "@embark/context";
import { MapExtensions, type MapExtension } from "./channel";

// The map-side half of the extension contract: the map tool calls this once
// after constructing its maplibre instance, and the host keeps the installed
// extension set in step with the canvas `MapExtensions` channel — installing a
// card's extension when it appears, tearing it down when the card leaves (or
// republishes a different function under the same key).
//
// Unlike the codemirror host (where a compartment reconfigure is idempotent),
// installing a map extension runs arbitrary setup, so the host tracks one
// cleanup per key and reconciles by identity.
//
// Extensions may add sources/layers, which maplibre only allows once the style
// has loaded — so installation is gated on the `load` event and extension
// authors never have to handle that timing themselves.
export function installMapExtensionsHost(
  element: ToolElement,
  map: maplibregl.Map,
): () => void {
  const installed = new Map<string, { ext: MapExtension; cleanup: () => void }>();
  let latest: Record<string, unknown> = {};
  let ready = map.isStyleLoaded();
  let disposed = false;

  const reconcile = () => {
    if (!ready || disposed) return;
    for (const [key, entry] of installed) {
      if (latest[key] === entry.ext) continue;
      entry.cleanup();
      installed.delete(key);
    }
    for (const [key, value] of Object.entries(latest)) {
      if (installed.has(key) || typeof value !== "function") continue;
      const ext = value as MapExtension;
      installed.set(key, { ext, cleanup: ext(element, map) });
    }
  };

  const onLoad = () => {
    ready = true;
    reconcile();
  };
  if (!ready) map.once("load", onLoad);

  const unsubscribe = subscribeContext(element, MapExtensions, (all) => {
    latest = all;
    reconcile();
  });

  return () => {
    disposed = true;
    map.off("load", onLoad);
    unsubscribe();
    for (const { cleanup } of installed.values()) cleanup();
    installed.clear();
  };
}
