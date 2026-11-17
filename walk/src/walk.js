// Walking's pure helpers and the body's numbers: which way the keys ask to
// go, how the mouse turns the head, how the drawn eye eases across a STEP.
// The walking itself is walker.js over each support's navmesh (navmesh.js).

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
