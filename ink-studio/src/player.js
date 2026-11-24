// Drives one ink-studio world the way upstream's example pages do: advance
// world.anim on a clock, tell the renderer which 512-splat rows changed (the
// stage's `rows` flags), and draw at an art resolution the page enlarges with
// image-rendering: pixelated.

export function createPlayer(renderer) {
  let world = null;
  let t = 0;
  let fresh = true; // next draw uploads everything

  return {
    get world() {
      return world;
    },
    get time() {
      return t;
    },
    set(next) {
      world = next;
      t = 0;
      fresh = true;
      world?.anim?.update?.(0, 0);
    },
    /** Advance the scene's own clock by dt seconds. */
    step(dt) {
      if (!world) return;
      t += dt;
      world.anim?.update?.(Math.min(dt, 0.1), t);
    },
    draw({ width, height, camera }) {
      if (!world) return;
      const frame = { width, height, time: t };
      if (camera) frame.camera = camera;
      const rows = world.anim?.rows;
      if (!fresh) {
        const changed = [];
        if (rows) for (let i = 0; i < rows.length; i++) if (rows[i]) changed.push(i);
        frame.changedRows = changed;
      }
      rows?.fill(0);
      fresh = false;
      renderer.render(world, frame);
    },
  };
}
