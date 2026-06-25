/**
 * Relay provider components. Each is mounted by the host as a
 * `<patchwork-view component="...">` wrapper around the embedded view and relays
 * one Emitter — looked up by selector in the per-host registry the host stamped
 * on the wrapper (SPATIAL_REGISTRY_KEY) — to any descendant tool that subscribes
 * for that selector. Distinct selectors → wrapper nesting order is irrelevant.
 *
 * The host owns the coordinate-system provider; each recognition layer
 * contributes its own provider (derived from the LAYERS registry).
 */

import { accept } from "@inkandswitch/patchwork-providers";
import {
  SPATIAL_REGISTRY_KEY,
  COORDINATE_SYSTEM_SELECTOR,
  type Emitter,
  type SpatialRegistryHost,
} from "./spatial-source.js";
import { LAYERS } from "./layers/index.js";

type SubscribeEvent = CustomEvent<{
  selector?: { type?: string };
  port: MessagePort;
}>;

/** Relay whichever Emitter the host registered for `selectorType` on THIS element. */
export function makeRelayProvider(selectorType: string) {
  return (element: SpatialRegistryHost) => {
    const onSubscribe = (event: Event) => {
      const e = event as SubscribeEvent;
      if (e.detail?.selector?.type !== selectorType) return;
      const emitter = element[SPATIAL_REGISTRY_KEY]?.get(selectorType) as
        | Emitter<unknown>
        | undefined;
      if (!emitter) return; // not our host's wrapper / not ready → let it bubble
      accept(e as never, ((respond: (value: unknown) => void) => {
        respond(emitter.value); // initial snapshot
        return emitter.subscribe(respond); // stream; teardown on unsubscribe
      }) as never);
    };
    element.addEventListener("patchwork:subscribe", onSubscribe);
    return () => element.removeEventListener("patchwork:subscribe", onSubscribe);
  };
}

/** Host-owned coordinate-system provider. */
export const SpatialCoordinateSystemProvider = makeRelayProvider(
  COORDINATE_SYSTEM_SELECTOR,
);

/** One relay provider per layer, keyed by its provider component id. */
export const layerProviders: Record<
  string,
  ReturnType<typeof makeRelayProvider>
> = Object.fromEntries(
  LAYERS.map((l) => [l.providerComponentId, makeRelayProvider(l.selector)]),
);
