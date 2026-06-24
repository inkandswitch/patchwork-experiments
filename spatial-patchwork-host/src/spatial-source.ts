/**
 * Per-host-instance live data channel between the host tool and the provider
 * components wrapping its embedded view. The host owns one SpatialSource and
 * stamps it on the provider wrapper elements (SPATIAL_SOURCE_KEY); each provider
 * reads it off its own element and relays the relevant Emitter to subscribers.
 * Per-instance (never global) → multiple hosts on one page never collide.
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

export type CoordinateSystem = { width: number; height: number };

export type SpatialTagCorner = { nx: number; ny: number };

export type SpatialTag = {
  id: number;
  /** center, normalized 0..1 within the box (canonical) */
  nx: number;
  ny: number;
  /** radians, derived from corner0 -> corner1 */
  angle: number;
  corners: SpatialTagCorner[];
};

export type SpatialTags = { tags: SpatialTag[] };

export interface SpatialSource {
  coordinateSystem: Emitter<CoordinateSystem>;
  apriltags: Emitter<SpatialTags>;
}

export function createSpatialSource(): SpatialSource {
  return {
    coordinateSystem: new Emitter<CoordinateSystem>({ width: 0, height: 0 }),
    apriltags: new Emitter<SpatialTags>({ tags: [] }),
  };
}

/** Property key the host stamps on the provider wrapper <patchwork-view> elements. */
export const SPATIAL_SOURCE_KEY = "__spatialSource";

export type SpatialSourceHost = HTMLElement & {
  [SPATIAL_SOURCE_KEY]?: SpatialSource;
};

export const COORDINATE_SYSTEM_SELECTOR = "spatial:coordinate-system";
export const APRILTAGS_SELECTOR = "spatial:apriltags";
