// Aids to navigation and landmarks from OSM's seamark tags, as small
// models: lighthouses, light towers and beacons standing on their rock,
// buoys floating at the waterline in their IALA colours (Canada is IALA B:
// red to starboard returning), cardinal buoys with their topmarks, radio
// masts. Sizes are typical, not surveyed: the light's height when OSM
// gives one, else the kind's.

import { soup, cylinder } from "./shapes.js";

const COLOURS = { red: "#c8322b", green: "#2f8a3e", yellow: "#e8c22a", black: "#202020", white: "#f2f0ea", orange: "#e07a1f", blue: "#2b5bb8", grey: "#8b9096" };
const hex = (name, fallback = "white") => COLOURS[name] ?? COLOURS[fallback];

/** A cardinal's bands, top to bottom, by its quadrant (IALA): the points of its topmark cones show where the black is. */
export const CARDINAL = Object.freeze({
  north: ["black", "yellow"],
  south: ["yellow", "black"],
  east: ["black", "yellow", "black"],
  west: ["yellow", "black", "yellow"],
});

/** A cardinal's body bands, top to bottom: its quadrant's when OSM says which (the colours alone can't), else OSM's colours, else grey. */
export function cardinalBands(m) {
  if (CARDINAL[m.category]) return [...CARDINAL[m.category]];
  return m.colours.length ? m.colours.slice(0, 3) : ["grey"];
}

/**
 * A buoy's colour and shape, from what OSM says and nothing more. Canada is
 * IALA B: a lateral buoy red to starboard (conical), green to port (can).
 * A lateral buoy with neither a colour nor a side is drawn grey, a spar:
 * not invented as either.
 * @returns {{ colour: string, shape: "cone" | "can" | "spar" }}
 */
export function buoyLook(m) {
  const side = m.category ?? "";
  const colour = m.colours[0] ?? (m.type === "buoy_lateral" ? (/^starboard$/.test(side) ? "red" : /^port$/.test(side) ? "green" : null) : null);
  const tagged = m.shape ?? "";
  const shape = /conical/.test(tagged) ? "cone" : /can|cylindrical/.test(tagged) ? "can" : /spar|pillar/.test(tagged) ? "spar" : !colour ? "spar" : m.type === "buoy_lateral" ? (colour === "red" ? "cone" : colour === "green" ? "can" : "spar") : "can";
  return { colour: colour ?? "grey", shape };
}

/** What model a mark gets, or null for marks not drawn (notices, wrecks, harbour areas…). */
export function modelOf(m) {
  const t = m.type;
  if (t === "lighthouse") return "lighthouse";
  if (t === "buoy_cardinal") return "cardinal";
  if (t === "buoy_lateral" || t === "buoy_safe_water" || t === "buoy_isolated_danger") return "buoy";
  if (t === "buoy_special_purpose") return "special";
  if (t === "mooring") return "mooring";
  if (t === "radio_station") return "mast";
  if (t === "landmark" || t === "light_minor" || t === "light_major" || /^beacon/.test(t)) return t === "beacon_special_purpose" ? "special-beacon" : "beacon";
  return null;
}

/**
 * @param {object[]} marks  osm.js marks
 * @param {(x: number, z: number) => number | null} groundAt  the terrain's height there (metres above MWL), null off the grid
 * @returns {{ positions, colors, placed: { id, name, type, model, position }[] }}
 */
export function markMesh(marks, groundAt) {
  const s = soup();
  const placed = [];
  for (const m of marks) {
    const model = modelOf(m);
    const g = groundAt(m.x, m.z);
    if (!model || g == null) continue;
    const { x, z } = m;
    // a structure stands on its rock, or on the bottom where the rock is awash (out of the water by at least a little)
    const foot = Math.max(g, -2);
    let top = 0;
    if (model === "lighthouse") {
      const h = Math.min(Math.max(m.height ?? 12, 6), 30);
      cylinder(s, x, z, foot - 1, g + h, 2.2, 1.5, hex("white"));
      cylinder(s, x, z, g + h, g + h + 2, 1.3, 1.3, hex(m.light === "green" ? "green" : "red"));
      cylinder(s, x, z, g + h + 2, g + h + 3.2, 1.6, 0, hex("red"));
      top = g + h + 3.2;
    } else if (model === "beacon" || model === "special-beacon") {
      const h = Math.min(Math.max((m.height ?? 6) - Math.max(g, 0), 3), 15);
      const base = Math.max(g, 0);
      const [c1, c2] = model === "special-beacon" ? ["yellow", "yellow"] : [m.colours[0] ?? "white", m.colours[1] ?? m.colours[0] ?? "white"];
      cylinder(s, x, z, foot - 1, base + h * 0.55, 0.7, 0.6, hex(c1));
      cylinder(s, x, z, base + h * 0.55, base + h, 0.6, 0.5, hex(c2));
      cylinder(s, x, z, base + h, base + h + 0.8, 0.35, 0.35, hex(m.light ?? "white"));
      top = base + h + 0.8;
    } else if (model === "cardinal") {
      const cat = CARDINAL[m.category] ? m.category : null;
      const bands = cardinalBands(m);
      // the body, -0.8 … 2.2, in its bands top to bottom
      const y0 = -0.8, y1 = 2.2, step = (y1 - y0) / bands.length;
      bands.forEach((c, k) => {
        const top = y1 - k * step, bottom = top - step;
        const r = (y) => 0.8 - ((y - y0) / (y1 - y0)) * 0.2;
        cylinder(s, x, z, bottom, top, r(bottom), r(top), hex(c, "grey"));
      });
      top = 2.2;
      if (cat) {
        cylinder(s, x, z, 2.2, 3.0, 0.08, 0.08, hex("black"), 6);
        // two cones: north both up, south both down, east base to base, west point to point
        const cone = (y, up) => (up ? cylinder(s, x, z, y, y + 0.5, 0.35, 0, hex("black"), 10) : cylinder(s, x, z, y + 0.5, y, 0.35, 0, hex("black"), 10));
        const [lower, upper] = { north: [true, true], south: [false, false], east: [false, true], west: [true, false] }[cat];
        cone(3.0, lower);
        cone(3.55, upper);
        top = 4.05;
      }
    } else if (model === "buoy") {
      const { colour, shape } = buoyLook(m);
      const c = hex(colour, "grey");
      if (shape === "spar") {
        cylinder(s, x, z, -0.8, 2.2, 0.25, 0.2, c, 8);
        top = 2.2;
      } else {
        cylinder(s, x, z, -0.6, 1.0, 0.6, 0.55, c);
        if (shape === "cone") cylinder(s, x, z, 1.0, 1.8, 0.55, 0, c);
        else cylinder(s, x, z, 1.0, 1.4, 0.55, 0.55, c);
        top = shape === "cone" ? 1.8 : 1.4;
      }
    } else if (model === "special") {
      cylinder(s, x, z, -0.6, 1.4, 0.55, 0.5, hex("yellow"));
      top = 1.4;
    } else if (model === "mooring") {
      cylinder(s, x, z, -0.3, 0.35, 0.45, 0.4, hex("white"), 10);
      top = 0.35;
    } else if (model === "mast") {
      const h = Math.min(Math.max(m.height ?? 25, 8), 60);
      const base = Math.max(g, 0);
      for (let k = 0; k < 6; k++) cylinder(s, x, z, base + (h * k) / 6, base + (h * (k + 1)) / 6, 0.45 - k * 0.04, 0.41 - k * 0.04, hex(k % 2 ? "white" : "red"), 8);
      top = base + h;
    }
    placed.push({ id: m.id, name: m.name, type: m.type, model, position: [x, Math.round(top * 100) / 100, z] });
  }
  return { ...s.done(), placed };
}
