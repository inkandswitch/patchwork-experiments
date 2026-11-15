// For tests only: a sea for a wind as a boat alone floats on it, the
// spectrum's waves (ocean.js seaWaves) evaluated by the copy of the water
// package's surface (./surface.js): what the water package's reader is for a
// doc that is its own world at level 0.
import { seaWaves } from "../ocean.js";
import { createSurface } from "./surface.js";

/** @param {Parameters<typeof seaWaves>[0]} [p] */
export function createOcean(p) {
  const w = seaWaves(p);
  return { ...w, ...createSurface(w.components) };
}
