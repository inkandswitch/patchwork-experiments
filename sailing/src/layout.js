// Putting a ship on the sea, for the "Ship at sea" template (template.js).
// Each part of the sloop (ship.js) is its own GLB file doc and its own scene
// object, so it can be moved, swapped or edited like anything else: the hull
// at the root, and everything aboard attached under it (parent = the hull,
// transform in the hull's frame), so it all goes where the hull goes. The
// stations carry the traits that make them work; nothing else says what a
// ship is. Objects are written straight into the scene doc, as any importer
// does.
//
// Everything here takes what it needs ({ repo, change, newId }), which a
// template's context has.

import { FIT, partGLB } from "./ship.js";
import { ANCHOR, HELM, HOOK, LADDER, QUARTER, SAIL, SEA, SHIP, FLOAT } from "./traits.js";

export { SEA, SHIP };

/** The wind a new sea starts with: a working breeze from the north-east (speed m/s, from degrees). */
export const WIND = Object.freeze({ speed: 7, from: 45 });

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

// What goes aboard: the part, its name, and the traits that make it what it
// is. You join her under way, as you join a ship in Sea of Thieves: on a
// beam reach, the sail up and drawing, the anchor up. (Lying head to wind at
// anchor, a one-sail boat takes minutes to fall off once the anchor's up;
// a jib to back is what a sailor would use, and she has none yet.)
const ABOARD = [
  { kind: "mast", name: "Mast" },
  { kind: "rig", name: "Boom and sail", traits: { [SAIL]: { raised: 1, sheet: 0.5 } } },
  { kind: "wheel", name: "Wheel", traits: { [HELM]: { angle: 0 } } },
  { kind: "windlass", name: "Windlass", traits: { [ANCHOR]: { down: false, rode: 0 } } },
  { kind: "anchor", name: "Anchor", traits: { [HOOK]: {} } },
  { kind: "ladder", name: "Ladder", traits: { [LADDER]: {} } },
];

// Landmarks, in the ship's heading frame (ahead is −Z), so they're in view
// from astern whichever way the wind put the bow: something to sail past and
// to see you're moving.
const LANDMARKS = [
  { kind: "redBuoy", name: "Red buoy", at: [-14, 0, -48], traits: { [FLOAT]: {} } },
  { kind: "greenBuoy", name: "Green buoy", at: [18, 0, -70], traits: { [FLOAT]: {} } },
  { kind: "islet", name: "Islet", at: [-45, 0, -160], yaw: 0.6 },
];


/** An object for the scene doc: a passthrough GLB. */
export function partObject({ name, url, transform, parent = null, group = null, traits, locked = false, hint }) {
  return {
    name,
    sourceUrl: url,
    providerId: "file-glb",
    renderUrl: null,
    parent,
    group,
    visible: true,
    color: null,
    opacity: 1,
    wireframe: false,
    locked,
    transform: { position: [...transform.position], rotation: [...transform.rotation], scale: transform.scale ?? 1 },
    ...(hint ? { hint } : {}),
    ...(traits ? { traits: JSON.parse(JSON.stringify(traits)) } : {}),
  };
}

/** Draw a part and file it as a GLB doc: its url, and the hint an importer would write. */
async function filePart(repo, kind) {
  const { name, bytes, bounds, triangles } = partGLB(kind);
  const file = await repo.create2({
    "@patchwork": { type: "file" },
    name: `${name}.glb`,
    extension: "glb",
    mimeType: "model/gltf-binary",
    content: bytes,
  });
  return { url: file.url, hint: { bounds: { min: [...bounds.min], max: [...bounds.max] }, triangles, bytes: bytes.byteLength } };
}

/**
 * Lay out a sloop at anchor on open water in one change: the sea trait, the
 * hull (a ship by its trait, its spec left to be read from its box), its
 * parts attached under it, landmarks in a group, the editor's home view
 * from the stern quarter, and the doc's starting activity set to play, so whoever
 * opens it (its maker too) is aboard, not in the editor.
 * @param {{ repo, change, newId }} ctx
 * @param {{ wind?: { speed, from }, seed?: number, at?: number[] }} [opts]
 * @returns {Promise<string>} the hull's id
 */
export async function layOutShip(ctx, { wind = WIND, seed = Math.floor(Math.random() * 1e9), at = [0, 0, 0] } = {}) {
  // the landmarks lie upwind, in the wind's frame; she sails across it
  const yaw = headTo(wind.from);
  const course = yaw + REACH;
  const ahead = [-Math.sin(course), 0, -Math.cos(course)];
  const files = {};
  for (const kind of ["hull", ...ABOARD.map((p) => p.kind), ...LANDMARKS.map((l) => l.kind)]) files[kind] = await filePart(ctx.repo, kind);

  const hull = ctx.newId("o");
  const group = ctx.newId("g");
  ctx.change((d) => {
    if (!d.traits) d.traits = {};
    if (!d.objects) d.objects = {};
    if (!d.order) d.order = [];
    if (!d.view) d.view = {};
    d.traits[SEA] = { wind: { speed: wind.speed, from: wind.from }, seed, scale: 1 };
    d.view.activity = "play";
    // where the editor opens (play opens off her quarter wherever she has sailed to: crew.js)
    d.view.home = { position: turn(QUARTER.position, course, at), target: turn(QUARTER.target, course, at) };

    d.objects[hull] = partObject({
      name: "Sloop",
      ...files.hull,
      transform: { position: at, rotation: [0, course, 0] },
      traits: { [SHIP]: { motion: { velocity: ahead.map((v) => v * WAY), spin: [0, 0, 0] } } },
    });
    d.order.push(hull);
    for (const p of ABOARD) {
      const id = ctx.newId("o");
      d.objects[id] = partObject({ name: p.name, ...files[p.kind], transform: FIT[p.kind], parent: hull, traits: p.traits });
      d.order.push(id);
    }

    d.objects[group] = { kind: "group", name: "Landmarks", group: null, visible: true, opacity: 1 };
    d.order.push(group);
    for (const l of LANDMARKS) {
      const id = ctx.newId("o");
      d.objects[id] = partObject({
        name: l.name,
        ...files[l.kind],
        transform: { position: turn(l.at, yaw, at), rotation: [0, yaw + (l.yaw ?? 0), 0] },
        group,
        locked: true,
        traits: l.traits,
      });
      d.order.push(id);
    }
  });
  return hull;
}
