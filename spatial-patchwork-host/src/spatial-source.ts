/**
 * Generic per-host-instance plumbing shared by the host framework and the
 * recognition layers.
 *
 * The host owns the camera + calibration and exposes live data to embedded tools
 * through provider components. Each provider relays one `Emitter` to its
 * subscribers; the host wires emitter→provider by stamping a per-instance
 * registry (selector → Emitter) on every provider wrapper element. Per-instance
 * (never global) → multiple hosts on one page never collide.
 *
 * Layer-specific payload types (e.g. AprilTags) live in their layer module, not
 * here, so this stays generic.
 */

/** A tiny last-value pub/sub. New subscribers immediately get the current value. */
export class Emitter<T> {
  #value: T;
  #listeners = new Set<(value: T) => void>();

  constructor(initial: T) {
    this.#value = initial;
  }

  get value(): T {
    return this.#value;
  }

  set(value: T): void {
    this.#value = value;
    for (const listener of this.#listeners) {
      try {
        listener(value);
      } catch (err) {
        console.error("[spatial-source] listener threw:", err);
      }
    }
  }

  subscribe(listener: (value: T) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/** Host-owned provider: the aligned box size in live CSS pixels. */
export type CoordinateSystem = { width: number; height: number };
export const COORDINATE_SYSTEM_SELECTOR = "spatial:coordinate-system";

/**
 * Per-host registry stamped on every provider wrapper element: maps a provider
 * selector to the Emitter that wrapper should relay. Replaces the old hardcoded
 * SpatialSource shape so any number of layers can plug in.
 */
export type SpatialRegistry = Map<string, Emitter<unknown>>;

export const SPATIAL_REGISTRY_KEY = "__spatialRegistry";

export type SpatialRegistryHost = HTMLElement & {
  [SPATIAL_REGISTRY_KEY]?: SpatialRegistry;
};
