// The viewer's own orbit camera, in ink-studio's camera terms: { target, dist,
// yaw, pitch }, the eye at target + dist·(cos p·sin y, sin p, cos p·cos y)
// (upstream cli/ink-studio.js). Until the viewer touches it, the scene's
// authored camera (world.cam, rails, staging) plays untouched.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function createOrbit() {
  let free = null; // { target, dist, yaw, pitch } once the viewer has taken the camera

  function take(world) {
    if (free) return free;
    const cam = world?.cam ?? {};
    free = {
      target: [...(cam.target ?? [0, 1, 0])],
      dist: cam.dist ?? 10,
      yaw: cam.yaw ?? 0,
      pitch: cam.pitch ?? 0.2,
    };
    return free;
  }

  return {
    /** The frame's camera override: none while the authored camera plays. */
    camera: () => (free ? { ...free, target: [...free.target] } : undefined),
    isFree: () => free !== null,
    release() {
      free = null;
    },
    turn(world, dx, dy) {
      const c = take(world);
      c.yaw -= dx * 0.008;
      c.pitch = clamp(c.pitch + dy * 0.008, -1.45, 1.45);
    },
    pan(world, dx, dy) {
      const c = take(world);
      const k = c.dist * 0.0025;
      const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw), sp = Math.sin(c.pitch), cp = Math.cos(c.pitch);
      const right = [cy, 0, -sy];
      const up = [-sp * sy, cp, -sp * cy];
      for (let i = 0; i < 3; i++) c.target[i] += (-dx * right[i] + dy * up[i]) * k;
    },
    dolly(world, deltaY) {
      const c = take(world);
      c.dist = clamp(c.dist * Math.exp(deltaY * 0.0015), 0.05, 1e5);
    },
  };
}
