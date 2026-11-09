// Walking's pure helpers and its parameters: which way the keys ask to go,
// how the mouse turns the head, and the body's numbers. The walking itself is
// walker.js over a ship's navmesh (navmesh.js); nothing here asks the scene
// anything (DESIGN.md, "Walking: a navmesh in the ship's frame").

export const BODY = Object.freeze({
  eye: 1.6, // eye above the feet (m)
  radius: 0.35, // how close a wall may come
  step: 0.45, // what you can walk up without jumping (the arena's; DECK has the deck's)
  walk: 4.5, // m/s
  run: 7.5,
  jump: 5.2, // take-off speed (m/s): about a 1.4 m hop
  gravity: 16,
  accelGround: 40, // how fast you reach the speed you want, on the ground
  accelAir: 6,
  fallLimit: -60, // below this, you've fallen out of the world: respawn
});

/**
 * On a yacht's deck: the navmesh's numbers (navmesh.js NAV) and the walk's.
 * `step` is symmetric (up and down without jumping), so a drop deeper than
 * it is a ledge you can jump off but not walk off; `height` is the headroom
 * a body needs; the jump's apex (0.661 m) clears the lifelines (0.61–0.625
 * over the deck beside them) and never reaches the windlass's top (0.68).
 */
export const DECK = Object.freeze({
  ...BODY,
  cell: 0.05,
  slope: 35,
  step: 0.58,
  height: 1.75,
  radius: 0.25,
  march: 1.5,
  walk: 3.2,
  run: 5.5,
  jump: 4.6,
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
 * The drawn eye's lag behind the true eye, along her up (m), one frame on.
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
