// Existing planar cameras, bounded captures, and source selection for live water.
export function waterReflectionPlan(world, frame, camera, width, height, reflection, textureLimit = Infinity, levelsFor) {
  const ids = frame.water !== false && frame.reflections !== false && world.water?.reflectionPlanes;
  if (!ids?.length) return null;
  if (!reflection) throw new TypeError('Water captures require KIT.reflection in the toolkit');
  const scale = frame.reflectionScale ?? 0.5, limit = frame.reflectionMaxSize ?? 512;
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > 2048)
    throw new RangeError('Reflection scale must be in (0,1] and max size in [1,2048]');
  const definitions = new Map();
  for (const value of world.reflections ?? []) {
    const plane = reflection.plane(value);
    if (definitions.has(plane.id)) throw new RangeError('Duplicate reflection plane ' + plane.id);
    definitions.set(plane.id, plane);
  }
  const factor = Math.min(scale, limit / Math.max(width, height), textureLimit / (2*Math.max(width,height)));
  const active = new Float32Array(4), heights = new Float32Array(4);
  const captures = ids.map((id, slot) => {
    const plane = definitions.get(id);
    if (!plane) throw new RangeError('Unknown water reflection plane ' + id);
    if (Math.abs(plane.normal[1] - 1) > 1e-6)
      throw new RangeError('Water reflection planes must face up');
    heights[slot] = plane.at[1];
    const capture = reflection.captureView(camera.view, plane, camera.eye);
    if (!capture) return null;
    const eye = camera.eye.slice();
    eye[1] = 2 * plane.at[1] - eye[1];
    const equation=capture.equation.slice();
    equation[3]-=capture.bias;
    return { slot, plane, equation,
      camera: { ...camera, eye, view: capture.view } };
  }).filter(Boolean);
  const w = Math.max(1, Math.round(width * factor)), h = Math.max(1, Math.round(height * factor));
  const levels = levelsFor?.(captures.map(capture => capture.plane.id));
  const retained = [];
  for (const capture of captures) {
    const scale = levels?.get(capture.plane.id) ?? 1;
    if (!scale) continue;
    active[capture.slot] = 1;
    retained.push({ ...capture, width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) });
  }
  return { captures: retained, active, heights, count: ids.length, width: w, height: h, grid: [2, Math.ceil(ids.length / 2)] };
}

export function selectReflectionWorld(world, plane, time, toolkit) {
  if (!plane.select) return world;
  const data = world.data.slice(), frames = toolkit.KIT.splatFrames.create(world, time, toolkit.KIT.M);
  for (let i = 0; i < world.count; i++) {
    const p = frames(i).position();
    if (!plane.select(i, ...p, world)) data[i * 16 + 3] = 0;
  }
  return { ...world, data };
}
