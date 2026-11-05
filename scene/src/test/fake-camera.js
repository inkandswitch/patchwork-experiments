// A camera rig standing in for the stage's, for parts' tests (no WebGL).

/** frame() moves it to look at the box, and records the box. */
export function fakeCamera({ touched = false } = {}) {
  const cam = { position: [5, 5, 5], target: [0, 0, 0], fov: 45 };
  const frames = [];
  const rig = {
    object: null,
    get: () => ({ position: [...cam.position], target: [...cam.target], fov: cam.fov }),
    set: () => {},
    frame(box) {
      frames.push(box);
      cam.target = box ? box.min.map((v, i) => (v + box.max[i]) / 2) : [0, 0.5, 0];
      cam.position = cam.target.map((v) => v + 3);
    },
    hold: () => () => {},
    limit: () => () => {},
    touched: () => touched,
    watch: () => () => {},
  };
  return { cam, frames, rig };
}
