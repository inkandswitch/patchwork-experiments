/**
 * The two spatial provider components, registered as `patchwork:component`
 * plugins and mounted by the host as `<patchwork-view component="...">` wrappers
 * around the embedded view. Each relays one Emitter from the host's per-instance
 * SpatialSource (read lazily off its own element via SPATIAL_SOURCE_KEY) to any
 * descendant tool that subscribes for its selector. Independent (distinct
 * selectors) → nesting order is irrelevant.
 */

import { accept } from "@inkandswitch/patchwork-providers";
import {
  SPATIAL_SOURCE_KEY,
  COORDINATE_SYSTEM_SELECTOR,
  APRILTAGS_SELECTOR,
  type Emitter,
  type SpatialSource,
  type SpatialSourceHost,
} from "./spatial-source.js";

type SubscribeEvent = CustomEvent<{
  selector?: { type?: string };
  port: MessagePort;
}>;

function makeRelayProvider<T>(
  selectorType: string,
  pickEmitter: (source: SpatialSource) => Emitter<T>,
) {
  return (element: SpatialSourceHost) => {
    const onSubscribe = (event: Event) => {
      const e = event as SubscribeEvent;
      if (e.detail?.selector?.type !== selectorType) return;
      // Read the source lazily, at subscribe time (the host has stamped it by
      // now). If this isn't our host's wrapper, don't accept — let it bubble.
      const source = element[SPATIAL_SOURCE_KEY];
      if (!source) return;
      const emitter = pickEmitter(source);
      if (!emitter) return;
      accept(e as never, ((respond: (value: T) => void) => {
        respond(emitter.value); // initial snapshot
        return emitter.subscribe(respond); // stream; teardown on unsubscribe
      }) as never);
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
