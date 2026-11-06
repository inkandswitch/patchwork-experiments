// Putting a ship on the sea, for the "Ship at sea" template (template.js).
// The sloop is the "Sloop" part's (parts.js): each part of her (ship.js) is
// its own GLB file doc and its own scene object, so it can be moved,
// swapped or edited like anything else: the hull at the root, and
// everything aboard attached under it (parent = the hull, transform in the
// hull's frame), so it all goes where the hull goes. The stations carry the
// traits that make them work; nothing else says what a ship is. Objects are
// written straight into the scene doc, as any importer does.
//
// Everything here takes what it needs ({ file or repo, change, newId }),
// which a template's context has.

import { PIECES, WIND, newSea, objectsFor, sloopFiles, sloopObjects, writeObjects, fileFor, partObject } from "./parts.js";
import { QUARTER, SEA, SHIP } from "./traits.js";

export { SEA, SHIP, WIND, partObject };

/**
 * The yaw (about +Y) that points the bow (body −Z) at compass bearing
 * `from` (degrees from −Z toward +X): a ship at anchor lies head to wind.
 */
export const headTo = (from) => (-from * Math.PI) / 180;

/** How far off the wind she starts (radians, the wind on her starboard beam), and how fast (m/s). */
export const REACH = (85 * Math.PI) / 180;
export const WAY = 3;

/** A point in a frame turned by `yaw` about +Y (and moved to `at`), in the world. */
export function turn([x, y, z], yaw, at = [0, 0, 0]) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [at[0] + x * c + z * s, at[1] + y, at[2] - x * s + z * c];
}

// You join her under way, as you join a ship in Sea of Thieves: on a beam
// reach, the sail up and drawing, the anchor up (the parts' own settings).
// (Lying head to wind at anchor, a one-sail boat takes minutes to fall off
// once the anchor's up; a jib to back is what a sailor would use, and she
// has none yet.)

// Landmarks, in the ship's heading frame (ahead is −Z), so they're in view
// from astern whichever way the wind put the bow: something to sail past and
// to see you're moving. Each is the part of that name.
const LANDMARKS = [
  { part: "redBuoy", at: [-14, 0, -48] },
  { part: "greenBuoy", at: [18, 0, -70] },
  { part: "islet", at: [-45, 0, -160], yaw: 0.6 },
];

/**
 * Lay out a sloop under way on open water in one change: the sea trait,
 * the Sloop part with way on, landmarks in a group, the editor's home view
 * from the stern quarter, and the doc's starting activity set to play, so
 * whoever opens it (its maker too) is aboard, not in the editor.
 * @param {{ file?, repo?, change, newId }} ctx
 * @param {{ wind?: { speed, from }, seed?: number, at?: number[] }} [opts]
 * @returns {Promise<string>} the hull's id
 */
export async function layOutShip(ctx, { wind = WIND, seed = Math.floor(Math.random() * 1e9), at = [0, 0, 0] } = {}) {
  // the landmarks lie upwind, in the wind's frame; she sails across it
  const yaw = headTo(wind.from);
  const course = yaw + REACH;
  const ahead = [-Math.sin(course), 0, -Math.cos(course)];
  const files = await sloopFiles(ctx);
  for (const l of LANDMARKS) for (const p of PIECES[l.part]) files[p.kind] ??= await fileFor(ctx, p.kind);

  const ship = sloopObjects({ position: at, yaw: course }, files, ctx.newId, { motion: { velocity: ahead.map((v) => v * WAY), spin: [0, 0, 0] } });
  const group = ctx.newId("g");
  const marks = LANDMARKS.flatMap((l) =>
    objectsFor(l.part, { parent: null, transform: { position: turn(l.at, yaw, at), rotation: [0, yaw + (l.yaw ?? 0), 0] } }, files, ctx.newId, { group, locked: true }),
  );
  ctx.change((d) => {
    if (!d.traits) d.traits = {};
    if (!d.view) d.view = {};
    d.traits[SEA] = newSea({ wind, seed });
    d.view.activity = "play";
    // where the editor opens (play opens off her quarter wherever she has sailed to: crew.js)
    d.view.home = { position: turn(QUARTER.position, course, at), target: turn(QUARTER.target, course, at) };
    writeObjects(d, ship);
    d.objects[group] = { kind: "group", name: "Landmarks", group: null, visible: true, opacity: 1 };
    d.order.push(group);
    writeObjects(d, marks);
  });
  return ship[0][0];
}
