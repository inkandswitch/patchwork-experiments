// What a level is made of: a few kinds of block, each a GLB drawn here, and
// the sample arena as a list of where they go. Pure; the scene shows the GLBs
// as ordinary objects, so a level is edited like any other scene.

/** A box's triangles, centred on x and z, standing on y = 0 (or centred, with `centre`). */
export function boxMesh([w, h, d], color, { centre = false, name } = {}) {
  const x = w / 2;
  const z = d / 2;
  const y0 = centre ? -h / 2 : 0;
  const y1 = y0 + h;
  // six faces, four corners each, outward normals
  const faces = [
    [[1, 0, 0], [[x, y0, z], [x, y0, -z], [x, y1, -z], [x, y1, z]]],
    [[-1, 0, 0], [[-x, y0, -z], [-x, y0, z], [-x, y1, z], [-x, y1, -z]]],
    [[0, 1, 0], [[-x, y1, z], [x, y1, z], [x, y1, -z], [-x, y1, -z]]],
    [[0, -1, 0], [[-x, y0, -z], [x, y0, -z], [x, y0, z], [-x, y0, z]]],
    [[0, 0, 1], [[-x, y0, z], [x, y0, z], [x, y1, z], [-x, y1, z]]],
    [[0, 0, -1], [[x, y0, -z], [-x, y0, -z], [-x, y1, -z], [x, y1, -z]]],
  ];
  return quads(faces, color, name);
}

/** A ramp: rising along -z from 0 at z = +d/2 to h at z = -d/2, standing on y = 0. */
export function rampMesh([w, h, d], color, { name } = {}) {
  const x = w / 2;
  const z = d / 2;
  const slope = Math.hypot(h, d);
  const n = [0, d / slope, h / slope];
  return quads(
    [
      [n, [[-x, 0, z], [x, 0, z], [x, h, -z], [-x, h, -z]]],
      [[0, -1, 0], [[-x, 0, -z], [x, 0, -z], [x, 0, z], [-x, 0, z]]],
      [[0, 0, -1], [[x, 0, -z], [-x, 0, -z], [-x, h, -z], [x, h, -z]]],
      [[1, 0, 0], [[x, 0, z], [x, 0, -z], [x, h, -z], [x, h, -z]]],
      [[-1, 0, 0], [[-x, 0, -z], [-x, 0, z], [-x, h, -z], [-x, h, -z]]],
    ],
    color,
    name,
  );
}

function quads(faces, color, name) {
  const positions = [];
  const normals = [];
  const indices = [];
  for (const [n, corners] of faces) {
    const base = positions.length / 3;
    for (const c of corners) positions.push(...c), normals.push(...n);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { name, positions, normals, indices, color };
}

/** Several meshes, each moved by [dx, dy, dz]. */
function moved(mesh, [dx, dy, dz]) {
  const p = mesh.positions.slice();
  for (let i = 0; i < p.length; i += 3) (p[i] += dx), (p[i + 1] += dy), (p[i + 2] += dz);
  return { ...mesh, positions: p };
}

/**
 * The kinds of block. Each is drawn once and placed many times. A target
 * stands on its base, so knocking it over is a turn about its foot.
 */
export const KINDS = {
  floor: { name: "Floor", meshes: () => [boxMesh([40, 0.4, 40], "#8a8f98", { name: "floor" })].map((m) => moved(m, [0, -0.4, 0])) },
  wall: { name: "Wall", meshes: () => [boxMesh([40, 3, 0.6], "#5d6470", { name: "wall" })] },
  crate: { name: "Crate", meshes: () => [boxMesh([1.2, 1.2, 1.2], "#b0793c", { name: "crate" })] },
  block: { name: "Block", meshes: () => [boxMesh([3, 2.4, 3], "#6f7b8c", { name: "block" })] },
  ramp: { name: "Ramp", meshes: () => [rampMesh([2.4, 2.4, 5], "#7d8796", { name: "ramp" })] },
  target: {
    name: "Target",
    meshes: () => [
      boxMesh([0.12, 1.1, 0.12], "#444a52", { name: "post" }),
      moved(boxMesh([0.9, 0.9, 0.08], "#f1f1f1", { name: "face" }), [0, 1.1, 0]),
      moved(boxMesh([0.5, 0.5, 0.1], "#d8402f", { name: "ring" }), [0, 1.3, 0]),
      moved(boxMesh([0.16, 0.16, 0.12], "#f1f1f1", { name: "bull" }), [0, 1.47, 0]),
    ],
  },
  spawn: { name: "Spawn", meshes: () => [boxMesh([1.2, 0.05, 1.2], "#2bb39a", { name: "spawn" })] },
};

const T = (position, yaw = 0) => ({ position, rotation: [0, yaw, 0], scale: 1 });

/**
 * The sample arena: a walled floor, a raised block with a ramp up to it,
 * crates to hide behind, targets to knock down and four places to start.
 * @returns {{ kind: string, name: string, transform: object, traits?: object }[]}
 */
export function sampleArena() {
  const out = [];
  const add = (kind, name, transform, traits) => out.push({ kind, name, transform, ...(traits ? { traits } : {}) });
  add("floor", "Floor", T([0, 0, 0]));
  add("wall", "North wall", T([0, 0, -20]));
  add("wall", "South wall", T([0, 0, 20]));
  add("wall", "East wall", T([20, 0, 0], Math.PI / 2));
  add("wall", "West wall", T([-20, 0, 0], Math.PI / 2));
  add("block", "Tower", T([0, 0, 0]));
  add("ramp", "Ramp", T([0, 0, 4]));
  const crates = [[-6, -5], [-7, -3.6], [6, 6], [7.4, 6.4], [-9, 9], [10, -9], [10, -7.6], [-3, -12], [4, 12]];
  crates.forEach(([x, z], i) => add("crate", `Crate ${i + 1}`, T([x, 0, z], (i * 0.7) % 1.3)));
  add("crate", "Crate on crate", T([-6, 1.2, -5], 0.4));
  const targets = [[0, -16], [12, -14], [-14, -10], [16, 4], [-16, 12], [8, 16], [0, 2.4, -0.6], [-12, 0]];
  targets.forEach(([x, a, b], i) => {
    // [x, z] on the floor, or [x, y, z] standing on something
    const at = b === undefined ? [x, 0, a] : [x, a, b];
    // each faces the middle
    const yaw = Math.atan2(-at[0], -at[2]) + Math.PI;
    add("target", `Target ${i + 1}`, T(at, yaw), { "arena.target": {} });
  });
  for (const [i, [x, z]] of [[-15, 15], [15, 15], [15, -15], [-15, -15]].entries()) {
    add("spawn", `Spawn ${i + 1}`, T([x, 0, z], Math.atan2(x, z)), { "arena.spawn": {} });
  }
  return out;
}

/** A standing target knocked over: turned a quarter about its foot, away from whoever hit it. */
export function knockedOver(transform, fromYaw) {
  const facing = transform?.rotation?.[1] ?? 0;
  // fall away from the shot: a shooter in front (facing it) pushes it over backwards
  const tilt = (Math.cos(fromYaw - facing) <= 0 ? -1 : 1) * (Math.PI / 2 - 0.02);
  return { position: [...(transform?.position ?? [0, 0, 0])], rotation: yawThenTilt(facing, tilt), scale: transform?.scale ?? 1 };
}

/**
 * Euler XYZ (the scene's rotation order) for a turn of `yaw` about +Y and
 * then a tilt about the turned X axis: R = Ry(yaw) · Rx(tilt).
 */
export function yawThenTilt(yaw, tilt) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const ca = Math.cos(tilt), sa = Math.sin(tilt);
  // M = [[cy, sy·sa, sy·ca], [0, ca, -sa], [-sy, cy·sa, cy·ca]], read back as three's XYZ
  const m13 = Math.max(-1, Math.min(1, sy * ca));
  const y = Math.asin(m13);
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(sa, cy * ca), y, Math.atan2(-sy * sa, cy)];
  return [Math.atan2(cy * sa, ca), y, 0];
}
