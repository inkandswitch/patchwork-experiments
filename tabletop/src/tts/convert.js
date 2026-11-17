// Tabletop Simulator space → the scene's space. Pure.
//
// TTS is Unity: left-handed, Y up, +Z away from the usual seats (most mods put
// their players' hands at -Z, facing +Z), lengths in "in-game units" that the
// TTS knowledge base calls "about an inch", rotations as Euler angles in
// degrees applied Z, then X, then Y (Quaternion.Euler).
//
// The scene is glTF: right-handed, Y up, metres, Euler XYZ in radians, uniform
// scale only (scene/README.md).
//
// The conversion is the mirror z → -z, then × metresPerUnit:
//
//   position (x, y, z)            → (x, y - tableY, -z) · u
//   rotation R = Ry(y)·Rx(x)·Rz(z) → M·R·M = Ry(-y)·Rx(-x)·Rz(z), M = diag(1, 1, -1)
//   a local point p of the mesh   → M·(S·p) · u        (S, the object's scale, is baked in)
//
// so world points agree: M·(T + R·S·p)·u = M·T·u + (M·R·M)·(M·S·p·u). Mirroring
// z (rather than x) keeps the seats at -Z in TTS where the scene's default
// camera is, at +Z, looking the same way. A mirror turns triangles inside out,
// so baking reverses each triangle's winding. Non-uniform scale goes into the
// geometry (each scale its own GLB), since the scene's scale is one number.

export const DEFAULT_METRES_PER_UNIT = 0.0254;
const DEG = Math.PI / 180;

const n = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clean = (v, places = 6) => {
  const r = +v.toFixed(places);
  return Object.is(r, -0) ? 0 : r;
};

/** A TTS Transform's parts: { position: [x,y,z], rotation: [x,y,z] (degrees), scale: [x,y,z] }. */
export function readTransform(t) {
  return {
    position: [n(t?.posX), n(t?.posY), n(t?.posZ)],
    rotation: [n(t?.rotX), n(t?.rotY), n(t?.rotZ)],
    scale: [n(t?.scaleX, 1), n(t?.scaleY, 1), n(t?.scaleZ, 1)],
  };
}

// 3×3 matrices, row-major [[a,b,c],[d,e,f],[g,h,i]]
const mul = (A, B) => A.map((row) => [0, 1, 2].map((j) => row[0] * B[0][j] + row[1] * B[1][j] + row[2] * B[2][j]));
const rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const rz = (a) => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];
export const applyMat3 = (m, [x, y, z]) => [m[0][0] * x + m[0][1] * y + m[0][2] * z, m[1][0] * x + m[1][1] * y + m[1][2] * z, m[2][0] * x + m[2][1] * y + m[2][2] * z];
export const transpose = (m) => [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j][i]));

/** Unity's rotation matrix for Euler degrees (x, y, z): z first, then x, then y. */
export function unityRotation([x, y, z]) {
  return mul(ry(y * DEG), mul(rx(x * DEG), rz(z * DEG)));
}

/** Euler XYZ (three.js order: R = Rx·Ry·Rz) of a rotation matrix, radians. Same branches as three's Euler.setFromRotationMatrix. */
export function eulerXYZ(m) {
  const m13 = Math.max(-1, Math.min(1, m[0][2]));
  const y = Math.asin(m13);
  if (Math.abs(m13) >= 0.9999999) return [Math.atan2(m[2][1], m[1][1]), y, 0];
  const a = [Math.atan2(-m[1][2], m[2][2]), y, Math.atan2(-m[0][1], m[0][0])];
  // every rotation has a second XYZ triple, (x ± π, π - y, z ± π); prefer the one
  // with less roll and pitch, so a card turned to face the other way reads
  // (0, π, 0) rather than (-π, 0, -π)
  const wrap = (v) => (v > Math.PI ? v - 2 * Math.PI : v <= -Math.PI ? v + 2 * Math.PI : v);
  const b = [wrap(a[0] + Math.PI), wrap(Math.PI - a[1]), wrap(a[2] + Math.PI)];
  const cost = (e) => Math.abs(e[0]) + Math.abs(e[2]);
  return cost(b) < cost(a) - 1e-9 ? b : a;
}

/** Rx·Ry·Rz, the scene's rotation matrix for Euler XYZ radians. */
export function sceneRotationMatrix([x, y, z]) {
  return mul(rx(x), mul(ry(y), rz(z)));
}

/** A TTS rotation (degrees) → the scene's Euler XYZ (radians). */
export function convertRotation(degrees) {
  const m = mul(ry(-n(degrees[1]) * DEG), mul(rx(-n(degrees[0]) * DEG), rz(n(degrees[2]) * DEG)));
  return eulerXYZ(m).map((v) => clean(v));
}

/** A TTS world position → the scene's (metres, table top at y = 0). */
export function convertPosition([x, y, z], { unit = DEFAULT_METRES_PER_UNIT, tableY = 0 } = {}) {
  return [clean(x * unit), clean((y - tableY) * unit), clean(-z * unit)];
}

/** A TTS Transform → a scene transform (scale is baked into the GLB, so 1). */
export function convertTransform(t, opts) {
  const { position, rotation } = readTransform(t);
  return { position: convertPosition(position, opts), rotation: convertRotation(rotation), scale: 1 };
}

/** A point in an object's local (unscaled) TTS frame → its GLB's frame: M·(S·p)·u. */
export function bakePoint([x, y, z], scale = [1, 1, 1], unit = DEFAULT_METRES_PER_UNIT) {
  return [x * scale[0] * unit, y * scale[1] * unit, -z * scale[2] * unit];
}

/** TTS world point of a local point, the way Unity computes it (for tests and layout). */
export function ttsLocalToWorld(transform, p) {
  const { position, rotation, scale } = readTransform(transform);
  const r = applyMat3(unityRotation(rotation), [p[0] * scale[0], p[1] * scale[1], p[2] * scale[2]]);
  return [position[0] + r[0], position[1] + r[1], position[2] + r[2]];
}

/** The scene's world point of a point in an object's GLB frame (transform from convertTransform). */
export function sceneLocalToWorld(transform, p) {
  const r = applyMat3(sceneRotationMatrix(transform.rotation), p.map((v) => v * (transform.scale ?? 1)));
  return [transform.position[0] + r[0], transform.position[1] + r[1], transform.position[2] + r[2]];
}

/** The object's own up axis in the TTS world (where its local +Y points). */
export function ttsUp(rotationDegrees) {
  return applyMat3(unityRotation(rotationDegrees), [0, 1, 0]);
}

/** A TTS colour { r, g, b, a? } → "#rrggbb" (sRGB), or null. */
export function colorHex(c) {
  if (!c || typeof c !== "object") return null;
  const ch = (v) => Math.round(Math.max(0, Math.min(1, n(v))) * 255).toString(16).padStart(2, "0");
  return `#${ch(c.r)}${ch(c.g)}${ch(c.b)}`;
}
