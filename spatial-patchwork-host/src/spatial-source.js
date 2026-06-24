/**
 * Per-host-instance live data channel between the host tool and the provider
 * components wrapping its embedded view.
 *
 * The host owns one SpatialSource. It hands it to the provider wrapper elements
 * by stamping it on a JS property (SPATIAL_SOURCE_KEY); each provider reads that
 * property off its own element and relays the relevant Emitter to its
 * `patchwork:subscribe` consumers. Because it's per-instance (never a global),
 * multiple hosts on one page never collide.
 */

/**
 * A tiny last-value pub/sub. New subscribers immediately get the current value,
 * so a tool that subscribes after detection has begun sees the latest state.
 */
export class Emitter {
  #value;
  #listeners = new Set();

  constructor(initial) {
    this.#value = initial;
  }

  get value() {
    return this.#value;
  }

  set(value) {
    this.#value = value;
    for (const listener of this.#listeners) {
      try {
        listener(value);
      } catch (err) {
        console.error("[spatial-source] listener threw:", err);
      }
    }
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }
}

/**
 * @typedef {Object} CoordinateSystem
 * @property {number} width   CSS pixels of the aligned box
 * @property {number} height
 *
 * @typedef {Object} SpatialTagCorner
 * @property {number} nx  0..1 within the box
 * @property {number} ny
 *
 * @typedef {Object} SpatialTag
 * @property {number} id
 * @property {number} nx     center, 0..1 within the box (canonical)
 * @property {number} ny
 * @property {number} angle  radians, derived from corner0 -> corner1
 * @property {SpatialTagCorner[]} corners  4 corners, 0..1 within the box
 *
 * @typedef {Object} SpatialTags
 * @property {SpatialTag[]} tags
 */

export function createSpatialSource() {
  return {
    coordinateSystem: new Emitter({ width: 0, height: 0 }),
    apriltags: new Emitter({ tags: [] }),
  };
}

// Property key the host stamps on the provider wrapper <patchwork-view> elements.
export const SPATIAL_SOURCE_KEY = "__spatialSource";

// Provider selector types.
export const COORDINATE_SYSTEM_SELECTOR = "spatial:coordinate-system";
export const APRILTAGS_SELECTOR = "spatial:apriltags";
