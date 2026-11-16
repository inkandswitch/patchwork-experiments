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

import { PIECES, SEA_CLIP_DEPTH, WIND, bringSea, objectsFor, sloopFiles, sloopObjects, writeObjects, fileFor, partObject } from "./parts.js";
import { ISLET_REACH } from "./ship.js";
import { ANCHOR, JIB, QUARTER, RODE, SAIL, SEA, SHIP, WEATHER } from "./traits.js";
import { SLOOP } from "./hull-model.js";
import { DEPTH } from "./sim.js";

export { SEA, SHIP, WEATHER, WIND, partObject };

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
// (Lying head to wind at anchor, she takes about a minute to fall off by
// herself once the anchor's up; a crew backs the jib, which is how "Ship at
// anchor" leaves: ANCHORAGE_AIR, below.)

// Landmarks, in the ship's heading frame (ahead is −Z), so they're in view
// from astern whichever way the wind put the bow: something to sail past and
// to see you're moving. Each is the part of that name.
const LANDMARKS = [
  { part: "redBuoy", at: [-14, 0, -48] },
  { part: "greenBuoy", at: [18, 0, -70] },
  { part: "islet", at: [-45, 0, -160], yaw: 0.6 },
];

// At anchor she lies head to wind off the islet, its shore some 50 m
// upwind (its middle further: it's ~25 m across the rock), so it's there
// ahead of her, close enough to read as an anchorage, with room to fall
// off either way once the anchor's up. The buoys mark the way out.
const ANCHORAGE = [
  { part: "redBuoy", at: [-12, 0, -32] },
  { part: "greenBuoy", at: [16, 0, -44] },
  { part: "islet", at: [-14, 0, -80], yaw: 0.6 },
];

/**
 * The anchorage's breeze (speed m/s, from degrees): a moderate one, Beaufort
 * 4. Her sail is down at anchor, so it costs nothing there. The main raised
 * at anchor and the anchor up, she leaves as a crew does: the jib backed (B
 * at the helm unrolls it backed; dead ahead, on the side the wheel picks),
 * off in 6–10 s at 12 kn (stock-rig.test.js); left alone she drifts astern
 * and falls off by herself in about a minute.
 */
export const ANCHORAGE_AIR = Object.freeze({ speed: 6.5, from: 45 });

/** Her stations at anchor: the main down, the jib rolled away, the anchor down with its rode out. */
export const AT_ANCHOR = Object.freeze({ [SAIL]: Object.freeze({ raised: 0 }), [JIB]: Object.freeze({ furl: 1 }), [ANCHOR]: Object.freeze({ down: true, rode: RODE }) });

/** How far the template's Sea reaches past what it covers (m). */
export const CLIP_MARGIN = 10;
/** The islet's reach from its middle (m): ship.js's bound on its rock, 31.2 (the mesh reaches 27.8, at its base). */
export { ISLET_REACH };
/** How deep every Sea sailing writes a clip for is (m): a metre below the bottom a dropped anchor lies on (sim.js DEPTH), so her chain is in it wherever her crew lets it go. */
export { SEA_CLIP_DEPTH };
/** A buoy's reach (m). */
export const BUOY_REACH = 2;

/**
 * What a template's Sea keeps where its world offers no open water
 * (water/WATER.md, "Clipped open water"; WATER Decision 102), worked out from
 * its own layout as data: the rectangle, in the layout's turned frame (yaw),
 * covering
 *   - at anchor: her swing circle, the anchor under her bow at the start
 *     (sim.js dropPoint) ± the rode's horizontal reach to the bottom (RODE
 *     over DEPTH) and her length;
 *   - under way: a circle of her length about her start;
 *   - every landmark (the islet ISLET_REACH about its middle, a buoy
 *     BUOY_REACH),
 * and CLIP_MARGIN more all round. Under way or at anchor it is SEA_CLIP_DEPTH
 * deep: a metre below the bottom a dropped anchor lies on (DEPTH), so her
 * chain is in it whenever it goes down. Pure.
 * @returns {{ clip: number[], position: number[], yaw: number, covers: { at: number[], r: number }[] }}  the clip, the Sea's place (its centre, level at at[1]) and heading, and what it covers (in the world)
 */
export function seaClip({ anchored = false, at = [0, 0, 0], yaw = 0, loa = SLOOP.length } = {}) {
  const covers = anchored ? [{ at: [0, 0, -loa / 2], r: Math.sqrt(RODE * RODE - DEPTH * DEPTH) + loa }] : [{ at: [0, 0, 0], r: loa }];
  for (const l of anchored ? ANCHORAGE : LANDMARKS) covers.push({ at: l.at, r: l.part === "islet" ? ISLET_REACH : BUOY_REACH });
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const { at: p, r } of covers) {
    x0 = Math.min(x0, p[0] - r);
    x1 = Math.max(x1, p[0] + r);
    z0 = Math.min(z0, p[2] - r);
    z1 = Math.max(z1, p[2] + r);
  }
  x0 -= CLIP_MARGIN;
  x1 += CLIP_MARGIN;
  z0 -= CLIP_MARGIN;
  z1 += CLIP_MARGIN;
  const tidy = (v) => Math.round(v * 1e6) / 1e6 + 0;
  const centre = turn([(x0 + x1) / 2, 0, (z0 + z1) / 2], yaw, at);
  return {
    clip: [tidy(x1 - x0), SEA_CLIP_DEPTH, tidy(z1 - z0)],
    position: [tidy(centre[0]), at[1], tidy(centre[2])],
    yaw,
    covers: covers.map(({ at: p, r }) => ({ at: turn(p, yaw, at), r })),
  };
}

/**
 * Lay out a sloop under way on open water in one change: the weather and a
 * Sea (a water object with a sea on it, first in the order), the Sloop part
 * with way on, landmarks in a group, the editor's home view
 * from the stern quarter (view.start's home: TOOLS.md §2), where whoever
 * opens it (its maker too) sees her and a click on her comes aboard (crew.js).
 *
 * `anchored`: lying at anchor instead, head to wind, still, her sail down
 * and her anchor down (AT_ANCHOR), off the islet (ANCHORAGE). Raising the
 * sail and weighing the anchor gets her under way as ever.
 * @param {{ file?, repo?, change, newId }} ctx
 * @param {{ wind?: { speed, from }, seed?: number, at?: number[], anchored?: boolean }} [opts]
 * @returns {Promise<string>} the hull's id
 */
export async function layOutShip(ctx, { wind = WIND, seed = Math.floor(Math.random() * 1e9), at = [0, 0, 0], anchored = false } = {}) {
  // the landmarks lie upwind, in the wind's frame; she sails across it (or lies head to it)
  const yaw = headTo(wind.from);
  const course = anchored ? yaw : yaw + REACH;
  const ahead = [-Math.sin(course), 0, -Math.cos(course)];
  const landmarks = anchored ? ANCHORAGE : LANDMARKS;
  const files = await sloopFiles(ctx);
  for (const l of landmarks) for (const p of PIECES[l.part]) files[p.kind] ??= await fileFor(ctx, p.kind);

  const ship = anchored
    ? sloopObjects({ position: at, yaw: course }, files, ctx.newId, {}, { settings: AT_ANCHOR })
    : sloopObjects({ position: at, yaw: course }, files, ctx.newId, { motion: { velocity: ahead.map((v) => v * WAY), spin: [0, 0, 0] } });
  const group = ctx.newId("g");
  const marks = landmarks.flatMap((l) =>
    objectsFor(l.part, { parent: null, transform: { position: turn(l.at, yaw, at), rotation: [0, yaw + (l.yaw ?? 0), 0] } }, files, ctx.newId, { group, locked: true }),
  );
  const sea = seaClip({ anchored, at, yaw });
  ctx.change((d) => {
    bringSea(d, ctx.newId, { wind, seed, clip: sea.clip, position: sea.position, yaw: sea.yaw });
    // people start off her quarter, in Look (no body named: the stage's orbit
    // camera, not the editor), where a click on her comes aboard (crew.js: an
    // untouched camera follows her quarter wherever she has sailed to)
    d.view.start = { home: { position: turn(QUARTER.position, course, at), target: turn(QUARTER.target, course, at) } };
    writeObjects(d, ship);
    d.objects[group] = { kind: "group", name: "Landmarks", group: null, visible: true, opacity: 1 };
    d.order.push(group);
    writeObjects(d, marks);
  });
  return ship[0][0];
}
