/**
 * Relay provider components.
 *
 * `makeRelayProvider(selector)` builds a `<patchwork-view component="...">`
 * wrapper behavior that relays one Emitter — looked up by selector in the
 * per-frame registry stamped on the wrapper (SPATIAL_REGISTRY_KEY) — to any
 * descendant tool that subscribes for that selector. Distinct selectors →
 * wrapper nesting order is irrelevant.
 *
 * The FRAME owns only the coordinate-system provider. Each recognition layer
 * ships its OWN relay provider (a `patchwork:component`) in its layer package,
 * built with this same `makeRelayProvider` factory (re-exported for that use).
 */

import { accept } from "@inkandswitch/patchwork-providers";
import {
  SPATIAL_REGISTRY_KEY,
  COORDINATE_SYSTEM_SELECTOR,
  CALIBRATION_DOC_SELECTOR,
  type Emitter,
  type SpatialRegistryHost,
} from "./spatial-source.js";

type SubscribeEvent = CustomEvent<{
  selector?: { type?: string };
  port: MessagePort;
}>;

/** Relay whichever Emitter the frame registered for `selectorType` on THIS element. */
export function makeRelayProvider(selectorType: string) {
  return (element: SpatialRegistryHost) => {
    const onSubscribe = (event: Event) => {
      const e = event as SubscribeEvent;
      if (e.detail?.selector?.type !== selectorType) return;
      const emitter = element[SPATIAL_REGISTRY_KEY]?.get(selectorType) as
        | Emitter<unknown>
        | undefined;
      if (!emitter) return; // not our frame's wrapper / not ready → let it bubble
      accept(e as never, ((respond: (value: unknown) => void) => {
        respond(emitter.value); // initial snapshot
        return emitter.subscribe(respond); // stream; teardown on unsubscribe
      }) as never);
    };
    element.addEventListener("patchwork:subscribe", onSubscribe);
    return () => element.removeEventListener("patchwork:subscribe", onSubscribe);
  };
}

/** Frame-owned coordinate-system provider. */
export const SpatialCoordinateSystemProvider = makeRelayProvider(
  COORDINATE_SYSTEM_SELECTOR,
);

/** Frame-owned calibration-doc-URL broker (current system; re-emits on switch). */
export const CalibrationDocProvider = makeRelayProvider(CALIBRATION_DOC_SELECTOR);
