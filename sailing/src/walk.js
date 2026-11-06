// Walking: one step of a first-person body against whatever the scene is made
// of. Pure. The world is two questions asked by ray: how far down to the
// ground, and how far until something is in the way. So the floor can be a
// level's slab, a crate, or the deck of a boat; nothing here knows which.
//
// The arena's walker (arena/src/walk.js), copied, plus what a deck needs:
// - a ledge: a body that says how far it will step down (`ledge`) won't walk
//   off a bigger drop, so the deck's edge holds you where the lifelines are
//   (thin wires no ray finds); a jump still takes you over the side;
// - swimming: the same step on the water's surface, head above it;
// - a third probe ahead at the brow, for a boom.
// Riding a moving deck is the caller's (crew.js): it runs this in the world
// and keeps the body in the ship's frame between steps.

export const BODY = Object.freeze({
  eye: 1.6, // eye above the feet (m)
  radius: 0.35, // how close a wall may come
  step: 0.45, // what you can walk up without jumping
  walk: 4.5, // m/s
  run: 7.5,
  jump: 5.2, // take-off speed (m/s): about a 1.4 m hop
  gravity: 16,
  accelGround: 40, // how fast you reach the speed you want, on the ground
  accelAir: 6,
  fallLimit: -60, // below this, you've fallen out of the world: respawn
});

/** On a yacht's deck: up onto the cabin top and the cockpit seats, never off the edge by walking. */
export const DECK = Object.freeze({
  ...BODY,
  step: 0.5,
  walk: 3.2,
  run: 5.5,
  jump: 4.6,
  ledge: 0.9, // the deepest drop you'll walk off (deck to cockpit sole is about half that)
});

/** In the water: slow, the head just above the surface. */
export const SWIM = Object.freeze({
  ...BODY,
  depth: 1.3, // feet below the surface, so the eye (BODY.eye up) is 0.3 above it
  eye: 0.3, // probes are from the waterline: the eye above it
  step: 0.2,
  walk: 1.3,
  run: 2.2,
  jump: 0,
  accelGround: 4,
  accelAir: 4,
});

const len2 = (x, z) => Math.hypot(x, z);

/**
 * The horizontal velocity the keys ask for, in world space.
 * @param {{ forward: number, strafe: number, run?: boolean }} input  each -1..1
 * @param {number} yaw  which way you face (radians about +Y; 0 looks down -Z)
 */
export function wishVelocity(input, yaw, body = BODY) {
  let f = Number(input.forward) || 0;
  let s = Number(input.strafe) || 0;
  const n = len2(f, s);
  if (n > 1) (f /= n), (s /= n);
  const speed = input.run ? body.run : body.walk;
  // forward is -Z at yaw 0; strafe right is +X
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return [(-sin * f + cos * s) * speed, (-cos * f - sin * s) * speed];
}

/** Move `v` toward `target` by at most `max` (2D). */
function approach(v, target, max) {
  const dx = target[0] - v[0];
  const dz = target[1] - v[1];
  const d = len2(dx, dz);
  if (d <= max || d === 0) return [target[0], target[1]];
  return [v[0] + (dx / d) * max, v[1] + (dz / d) * max];
}

/** Is there ground within `body.ledge` below (x, z)? */
const footing = (world, x, y, z, body) => world.down([x, y + body.step, z], body.step + body.ledge) != null;

/**
 * One step.
 * @param {{ feet: number[], vel: number[], onGround: boolean }} state  feet: [x, y, z]; vel: [x, y, z]
 * @param {{ forward: number, strafe: number, run?: boolean, jump?: boolean }} input
 * @param {number} yaw
 * @param {number} dt  seconds (the caller clamps it)
 * @param {{ down(from: number[], max: number): number | null,
 *           ahead(from: number[], dir: number[], max: number): { distance: number, normal: number[] | null } | null }} world
 *   down: the distance from `from` straight down to the first surface (or null);
 *   ahead: the first surface along a horizontal unit `dir`
 * @param {object} [body]  BODY, DECK or anything shaped like them; `ledge` turns on the edge check
 * @returns {{ feet: number[], vel: number[], onGround: boolean, landed: boolean }}
 */
export function step(state, input, yaw, dt, world, body = BODY) {
  const start = state.feet;
  const feet = [...state.feet];
  let vel = [...state.vel];
  let onGround = state.onGround;

  const want = wishVelocity(input, yaw, body);
  const h = approach([vel[0], vel[2]], want, (onGround ? body.accelGround : body.accelAir) * dt);
  vel[0] = h[0];
  vel[2] = h[1];
  if (onGround && input.jump && body.jump > 0) {
    vel[1] = body.jump;
    onGround = false;
  }
  if (!onGround) vel[1] -= body.gravity * dt;

  // horizontal: probe at the knee and the chest; slide along what's hit
  let mx = vel[0] * dt;
  let mz = vel[2] * dt;
  for (let pass = 0; pass < 2; pass++) {
    const dist = len2(mx, mz);
    if (dist < 1e-9) break;
    const dir = [mx / dist, 0, mz / dist];
    let hit = null;
    for (const y of [body.step + 0.05, body.eye * 0.75, body.eye - 0.1]) {
      // far enough to see a wall met at a glancing angle (see `cos` below)
      const h2 = world.ahead([feet[0], feet[1] + y, feet[2]], dir, dist + body.radius / 0.2);
      if (h2 && (!hit || h2.distance < hit.distance)) hit = h2;
    }
    if (!hit) break;
    const n = hit.normal && Math.abs(hit.normal[1]) < 0.7 ? [hit.normal[0], hit.normal[2]] : [-dir[0], -dir[2]];
    const nl = len2(n[0], n[1]) || 1;
    const nx = n[0] / nl;
    const nz = n[1] / nl;
    // the radius is kept square to the wall, so a glancing approach stops as far off as a head-on one
    const cos = Math.max(0.2, -(dir[0] * nx + dir[2] * nz));
    const free = Math.max(0, Math.min(dist, hit.distance - body.radius / cos));
    if (hit.distance - body.radius / cos > dist) break;
    // go as far as is free, then slide what's left along the wall
    const rest = dist - free;
    feet[0] += dir[0] * free;
    feet[2] += dir[2] * free;
    const rx = dir[0] * rest;
    const rz = dir[2] * rest;
    const into = rx * nx + rz * nz;
    mx = rx - into * nx;
    mz = rz - into * nz;
    // stop pushing into it
    const vInto = vel[0] * nx + vel[2] * nz;
    if (vInto < 0) {
      vel[0] -= vInto * nx;
      vel[2] -= vInto * nz;
    }
    if (pass === 1) (mx = 0), (mz = 0);
  }
  feet[0] += mx;
  feet[2] += mz;

  // the ledge: on the ground, each axis of the move goes only as far as
  // keeps ground a radius ahead (so you stop with your toes at the edge, and
  // slide along it)
  if (onGround && body.ledge > 0) {
    const dx = feet[0] - start[0];
    const dz = feet[2] - start[2];
    if (dx && !footing(world, feet[0] + Math.sign(dx) * body.radius, start[1], start[2], body)) {
      feet[0] = start[0];
      vel[0] = 0;
    }
    if (dz && !footing(world, feet[0], start[1], feet[2] + Math.sign(dz) * body.radius, body)) {
      feet[2] = start[2];
      vel[2] = 0;
    }
  }

  // vertical: fall, or stand on whatever is under you (stepping up what's low enough)
  const dy = vel[1] * dt;
  const probeFrom = [feet[0], feet[1] + body.step, feet[2]];
  const below = world.down(probeFrom, body.step + Math.max(0, -dy) + 0.05);
  let landed = false;
  if (below != null && vel[1] <= 0) {
    const ground = probeFrom[1] - below;
    if (feet[1] + dy <= ground + 1e-4) {
      landed = !state.onGround;
      feet[1] = ground;
      vel[1] = 0;
      onGround = true;
    } else {
      feet[1] += dy;
      onGround = false;
    }
  } else {
    // a head bump stops a jump
    if (vel[1] > 0) {
      const up = world.ahead([feet[0], feet[1] + body.eye, feet[2]], [0, 1, 0], dy + 0.1);
      if (up) vel[1] = 0;
    }
    feet[1] += vel[1] * dt;
    onGround = false;
  }
  return { feet, vel, onGround, landed };
}

/**
 * One stroke in the water: the walker's horizontal step at the waterline
 * (so the hull is in the way as a wall is), then the body put back at the
 * surface, wherever the waves have it now: you bob.
 * @param {{ feet: number[], vel: number[] }} state  feet: the real feet, `body.depth` under the surface
 * @param {{ forward: number, strafe: number, run?: boolean }} input
 * @param {number} yaw
 * @param {number} dt
 * @param {{ surface(x: number, z: number): number, ahead: Function }} world  surface: the water's height there, now
 * @returns {{ feet: number[], vel: number[], onGround: false, landed: false }}
 */
export function swim(state, input, yaw, dt, world, body = SWIM) {
  const [x, , z] = state.feet;
  const level = world.surface(x, z);
  const water = { down: (from) => from[1] - world.surface(from[0], from[2]), ahead: world.ahead };
  const s = step({ feet: [x, level, z], vel: [state.vel[0], 0, state.vel[2]], onGround: true }, { ...input, jump: false }, yaw, dt, water, body);
  const y = world.surface(s.feet[0], s.feet[2]) - body.depth;
  return { feet: [s.feet[0], y, s.feet[2]], vel: [s.vel[0], 0, s.vel[2]], onGround: false, landed: false };
}

/** The eye's forward unit vector for a yaw and pitch (pitch up is positive). */
export function lookDir(yaw, pitch) {
  const c = Math.cos(pitch);
  return [-Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c];
}

/** Turn by a mouse movement: pitch held short of straight up and down. */
export function look(yaw, pitch, dx, dy, sensitivity = 0.0022) {
  const limit = Math.PI / 2 - 0.01;
  return { yaw: yaw - dx * sensitivity, pitch: Math.max(-limit, Math.min(limit, pitch - dy * sensitivity)) };
}
