/**
 * The two spatial provider components, registered as `patchwork:component`
 * plugins and mounted by the host as `<patchwork-view component="...">` wrappers
 * around the embedded view.
 *
 * Each provider relays one Emitter from the host's per-instance SpatialSource
 * (read lazily off its own element via SPATIAL_SOURCE_KEY) to any descendant
 * tool that subscribes for its selector. The two providers are independent
 * (distinct selectors, no inter-dependency), so their nesting order is
 * irrelevant.
 */

import { accept } from "@inkandswitch/patchwork-providers";
import {
  SPATIAL_SOURCE_KEY,
  COORDINATE_SYSTEM_SELECTOR,
  APRILTAGS_SELECTOR,
} from "./spatial-source.js";

/**
 * Build a provider component fn that answers `selectorType` by relaying the
 * Emitter chosen by `pickEmitter(source)`.
 *
 * Provider contract: (element, repo) => cleanup. We attach a single
 * `patchwork:subscribe` listener; subscribe events from descendant views bubble
 * up to us. `accept` stops propagation only for our matched selector, so the
 * sibling provider still receives the other selector's events.
 */
function makeRelayProvider(selectorType, pickEmitter) {
  return (element) => {
    const onSubscribe = (event) => {
      if (!event.detail || event.detail.selector?.type !== selectorType) return;
      // Read the source lazily, at subscribe time: the host has stamped the
      // property by now. If this isn't our host's wrapper (no source), don't
      // call accept() — let the event keep bubbling to an outer provider.
      const source = element[SPATIAL_SOURCE_KEY];
      if (!source) return;
      const emitter = pickEmitter(source);
      if (!emitter) return;
      accept(event, (respond) => {
        respond(emitter.value); // initial snapshot
        return emitter.subscribe(respond); // stream; teardown on unsubscribe
      });
    };

    element.addEventListener("patchwork:subscribe", onSubscribe);
    return () => element.removeEventListener("patchwork:subscribe", onSubscribe);
  };
}

export const SpatialCoordinateSystemProvider = makeRelayProvider(
  COORDINATE_SYSTEM_SELECTOR,
  (source) => source.coordinateSystem,
);

export const SpatialApriltagsProvider = makeRelayProvider(
  APRILTAGS_SELECTOR,
  (source) => source.apriltags,
);
