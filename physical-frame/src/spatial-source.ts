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

/**
 * A tiny last-value pub/sub. New subscribers immediately get the current value.
 *
 * Optional activity hooks let the frame drive DEMAND-DRIVEN reading: `onActive`
 * fires when the listener count goes 0→1 (something started subscribing), and
 * `onIdle` fires when it goes 1→0 (no more subscribers). The frame uses these to
 * lazily `ensure()` a layer's reader on first subscriber and (debounced) `stop()`
 * it when the last subscriber leaves.
 */
export interface EmitterActivityHooks {
  onActive?: () => void;
  onIdle?: () => void;
}

export class Emitter<T> {
  #value: T;
  #listeners = new Set<(value: T) => void>();
  #hooks: EmitterActivityHooks;

  constructor(initial: T, hooks: EmitterActivityHooks = {}) {
    this.#value = initial;
    this.#hooks = hooks;
  }

  /** Set/replace the activity hooks after construction. */
  setActivityHooks(hooks: EmitterActivityHooks): void {
    this.#hooks = hooks;
  }

  get value(): T {
    return this.#value;
  }

  /** Current number of live subscribers. */
  get subscriberCount(): number {
    return this.#listeners.size;
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
    const wasEmpty = this.#listeners.size === 0;
    this.#listeners.add(listener);
    if (wasEmpty) {
      try {
        this.#hooks.onActive?.();
      } catch (err) {
        console.error("[spatial-source] onActive threw:", err);
      }
    }
    // Deliver the current value immediately (matches the doc comment) so late
    // subscribers sync without waiting for the next set().
    try {
      listener(this.#value);
    } catch (err) {
      console.error("[spatial-source] listener threw:", err);
    }
    return () => {
      const had = this.#listeners.delete(listener);
      if (had && this.#listeners.size === 0) {
        try {
          this.#hooks.onIdle?.();
        } catch (err) {
          console.error("[spatial-source] onIdle threw:", err);
        }
      }
    };
  }
}

/** Host-owned provider: the aligned box size in live CSS pixels. */
export type CoordinateSystem = { width: number; height: number };
export const COORDINATE_SYSTEM_SELECTOR = "physical:coordinate-system";

/**
 * Selector brokering the CURRENT system's calibration doc URL (a string).
 * Distinct from the `physical:calibration` plugin TYPE (different namespace —
 * provider selector vs. registry plugin-type). Consumers recover the live
 * handle from the repo via this url; re-emits when the frame switches systems.
 */
export const CALIBRATION_DOC_SELECTOR = "physical:calibration-doc";

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
