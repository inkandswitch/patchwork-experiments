/**
 * Discover physical-layer packages from the plugin registry.
 *
 * Each layer package registers a `patchwork:physical-layer` plugin whose
 * `load()` returns a `PhysicalLayer` descriptor (plus a separate
 * `patchwork:component` for its relay provider). The frame enumerates ALL of
 * them — `getRegistry(type).all()` — loads their descriptors, and uses them to
 * create one Emitter + reader per layer (readers spun up lazily, on subscribe).
 *
 * A brand-new layer type is auto-discoverable: registries are created on first
 * `getRegistry(type)` and a new type string needs no whitelist.
 */

import { getRegistry } from "@inkandswitch/patchwork-plugins";
import {
  PHYSICAL_LAYER_PLUGIN_TYPE,
  type PhysicalLayer,
} from "./physical-layer.js";

/** Load every registered physical-layer's descriptor. */
export async function loadPhysicalLayerDescriptors(): Promise<
  PhysicalLayer[]
> {
  // The registry stores each plugin's loaded value on `.module`.
  const registry = getRegistry(PHYSICAL_LAYER_PLUGIN_TYPE) as ReturnType<
    typeof getRegistry
  >;
  const all = registry.all();
  const loaded = await registry.loadAll(all);
  const descriptors: PhysicalLayer[] = [];
  for (const p of loaded) {
    const mod = (p as { module?: unknown }).module;
    if (isPhysicalLayer(mod)) descriptors.push(mod);
    else
      console.warn(
        "[physical-frame] ignoring physical-layer with unexpected shape:",
        (p as { id?: string }).id,
      );
  }
  return descriptors;
}

function isPhysicalLayer(v: unknown): v is PhysicalLayer {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.selector === "string" &&
    typeof o.providerComponentId === "string" &&
    typeof o.initialResult === "function" &&
    typeof o.createReader === "function"
  );
}
