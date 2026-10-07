// Document frame → glTF frame. Pure.
//
// The document is engineering Z-up: x east, y north, z up, metres.
// glTF is Y-up, right-handed, metres. The rotation that keeps x and puts z up
// is X = x, Y = z, Z = −y (a proper rotation, det = +1, so handedness survives).

/** [x, y, z] (doc) → [X, Y, Z] (glTF). */
export function toGltf(p) {
  return [p[0], p[2], 0 - p[1]]; // 0 − y, not −y: no negative zeros
}

/** In place over a flat xyz array (positions or normals). Returns the array. */
export function toGltfInPlace(arr) {
  for (let i = 0; i < arr.length; i += 3) {
    const y = arr[i + 1];
    arr[i + 1] = arr[i + 2];
    arr[i + 2] = 0 - y;
  }
  return arr;
}

/** Axis-aligned doc box → glTF box. */
export function boxToGltf({ min, max }) {
  const a = toGltf(min);
  const b = toGltf(max);
  return {
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  };
}
