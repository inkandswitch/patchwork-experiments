// Walking's pure helpers and the body's numbers: which way the keys ask to
// go, how the mouse turns the head, how the drawn eye eases across a STEP.
// The walking itself is walker.js over each support's navmesh (navmesh.js).
// `step` below is the ray walker, until walk's body moves onto the walker
// (DESIGN.md, "Standing on supports", step 4).

/**
 * The body: one set of numbers for a person on any support (DESIGN.md, "One
 * body"). The geometry is the one proved on a yacht's deck (the cockpit's
 * 0.546 rise a STEP, the lifelines' 0.61 a WALL, the shroud passage at r);
 * the speeds and the jump are walk's. `step` is symmetric (up and down
 * without jumping), so a drop deeper than it inside one support is a ledge
 * you jump off; an OPEN side drops you up to `drop` onto another support.
 */
export const BODY = Object.freeze({
  eye: 1.6, // eye above the feet (m)
  cell: 0.05, // the bake's column (m)
  slope: 35, // the steepest floor (degrees)
  step: 0.58, // what you can walk up (or down) without jumping
  height: 1.75, // the headroom a body needs
  radius: 0.25, // how close anything may come
  march: 1.5, // how far a side looks for where a jump comes down (m)
  walk: 4.5, // m/s
  run: 7.5,
  jump: 5.2, // take-off speed (m/s): apex 0.845 m
  gravity: 16,
  accelGround: 40, // how fast you reach the speed you want, on a floor
  accelAir: 6,
  drop: 2, // the furthest down an OPEN side puts you onto another support (W3)
  sunk: 1.5, // feet this far under the water: awash, you swim
  rest: 0.5, // held this long, falling, by a surface that is no cell: placed again (F5)
  fallLimit: -60, // below this (the stage's frame), you've fallen out of the world: respawn
});

/** In the water: slow, the head just above the surface. */
export const SWIM = Object.freeze({
  ...BODY,
  depth: 1.3, // feet below the surface, so the eye (BODY.eye up) is 0.3 above it
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
 * @returns {{ feet: number[], vel: number[], onGround: boolean, landed: boolean }}
 */
export function step(state, input, yaw, dt, world, body = BODY) {
  const feet = [...state.feet];
  let vel = [...state.vel];
  let onGround = state.onGround;

  const want = wishVelocity(input, yaw, body);
  const h = approach([vel[0], vel[2]], want, (onGround ? body.accelGround : body.accelAir) * dt);
  vel[0] = h[0];
  vel[2] = h[1];
  if (onGround && input.jump) {
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
    for (const y of [body.step + 0.05, body.eye * 0.75]) {
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

/** How fast the drawn eye catches up with the feet after a STEP: going up (faster, so it doesn't drag through what you stepped onto), going down (m/s). */
export const EYE_EASE = Object.freeze({ up: 5, down: 3.5 });

/**
 * The drawn eye's lag behind the true eye, along the support's up (m), one frame on.
 * `lag` is last frame's; `lift` how far the feet jumped at a STEP this frame
 * (walker.step's). The walker's state stays exact: only the camera eases, at
 * most EYE_EASE per second, so a 0.52 m step reads as a step (about 0.1 s up,
 * 0.15 s down) and not a jump cut.
 */
export function easeEye(lag, lift, dt, E = EYE_EASE) {
  let d = lag - (Number(lift) || 0);
  const rate = d < 0 ? E.up : E.down;
  const by = rate * Math.max(0, dt);
  return Math.abs(d) <= by ? 0 : d - Math.sign(d) * by;
}
