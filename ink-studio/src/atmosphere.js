// An ink world's sky and sun as the scene's `atmosphere` ambient
// (scene/CONVENTIONS.md, "Atmosphere"): what an ink object offers the scene
// it's in when its `ink.scene` trait says `atmosphere: true`.
//
// The sky is sampled as ink's renderer samples it (webgl/environment.mjs:
// EnvironmentFrame.timeline, then SkyEnvironment.withCelestials), at the
// world's time: zenith, horizon and ground become the scene sky's top,
// horizon and bottom; ink's sun its sun, turned into the scene by the
// object's rotation. A world with no sky environment offers its background
// (palette 0) as a flat sky and no sun. Ink's colours here are sRGB in 0..1.
// Pure apart from the toolkit's own sampling.

const hex = ([r, g, b]) =>
  `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
const paletteHex = (n) => `#${(n >>> 0 & 0xffffff).toString(16).padStart(6, "0")}`;

/** The scene's key light is 1.5 (scene atmosphere.js LIGHTS.key); ink's sun strength runs about 0..1. */
export const SUN_SCALE = 2.5;

/** A unit direction turned by the rotation part of a column-major 4×4 (its scale taken out). */
export function turn(m, d) {
  if (!m) return d;
  const cols = [0, 4, 8].map((o) => {
    const c = [m[o], m[o + 1], m[o + 2]];
    const n = Math.hypot(...c) || 1;
    return c.map((v) => v / n);
  });
  const out = [0, 1, 2].map((r) => cols[0][r] * d[0] + cols[1][r] * d[1] + cols[2][r] * d[2]);
  const n = Math.hypot(...out) || 1;
  return out.map((v) => v / n);
}

/**
 * @param {object} toolkit  the ink toolkit module
 * @param {object} world    a built world
 * @param {number} time     the world's time, seconds
 * @param {number[] | null} [matrix]  the object's matrix in the doc's root frame (column-major), for the sun
 * @returns {object | null}  an atmosphere, plain JSON
 */
export function inkAtmosphere(toolkit, world, time, matrix = null) {
  if (!world?.pal?.length) return null;
  const background = paletteHex(world.pal[0]);
  const frameAPI = toolkit.EnvironmentFrame, skyAPI = toolkit.SkyEnvironment;
  if (!world.skyEnvironment || !frameAPI || !skyAPI) return { sky: { top: background, horizon: background, bottom: background } };
  const sampled = frameAPI.timeline(world, {}, time, undefined, toolkit.KIT?.weather?.tracks);
  const celestial = toolkit.CelestialTracks?.settings?.(world.celestialTracks, undefined)?.frame?.(sampled.skyTime);
  const bg = [(world.pal[0] >> 16) & 255, (world.pal[0] >> 8) & 255, world.pal[0] & 255].map((v) => v / 255);
  const sky = skyAPI.withCelestials(sampled.environment?.sky, celestial, bg);
  if (!sky?.zenith) return { sky: { top: background, horizon: background, bottom: background } };
  const out = { sky: { top: hex(sky.zenith), horizon: hex(sky.horizon), bottom: hex(sky.ground) } };
  if (Array.isArray(sky.sun) && sky.sun.length === 3 && (sky.sunStrength ?? 0) > 0) {
    out.sun = {
      direction: turn(matrix, sky.sun),
      color: hex(sky.sunColor ?? [1, 1, 1]),
      intensity: +(sky.sunStrength * SUN_SCALE).toFixed(3),
    };
  }
  return out;
}

/**
 * An ink world's water bodies as the water package's objects (water/src/parts.js
 * waterObject, copied: packages don't import each other): one box per body, its
 * origin the surface at rest, attached to the ink object so it moves with it.
 * Positions are in the ink object's frame (its local units). Pure.
 * @returns {object[]} scene objects, without ids
 */
export function waterObjects(world, parent) {
  const media = world?.water?.media ?? [];
  return media
    .filter((m) => m?.kind === "water" && m.bounds)
    .map((m, i) => {
      const { min, max } = m.bounds;
      const size = [max[0] - min[0], Math.max(0.05, max[1] - min[1]), max[2] - min[2]].map((v) => +v.toFixed(3));
      return {
        name: `Water${media.length > 1 ? ` ${i + 1}` : ""} (${m.id ?? "ink"})`,
        sourceUrl: null,
        providerId: null,
        renderUrl: null,
        parent,
        group: null,
        visible: true,
        color: null,
        opacity: 1,
        wireframe: false,
        transform: { position: [(min[0] + max[0]) / 2, max[1], (min[2] + max[2]) / 2].map((v) => +v.toFixed(3)), rotation: [0, 0, 0], scale: 1 },
        traits: { water: { size } },
      };
    });
}
