/* Camera and clipping geometry for planar captures, independent of materials and render backend. */
const ReflectionPlane = (() => {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  function planeDistance({ at, normal }, x, y, z) {
    return (x - at[0]) * normal[0] + (y - at[1]) * normal[1] + (z - at[2]) * normal[2];
  }

  // Multiply the column-major world-to-view matrix by a world-space mirror.
  function reflectedView(matrix, { at, normal }) {
    const out = matrix.slice(), offset = dot(at, normal);
    for (let row = 0; row < 3; row++) {
      const projection = matrix[row] * normal[0] + matrix[4 + row] * normal[1] + matrix[8 + row] * normal[2];
      for (let col = 0; col < 3; col++) out[col * 4 + row] -= 2 * projection * normal[col];
      out[12 + row] += 2 * projection * offset;
    }
    return out;
  }

  function captureView(matrix, plane, eye) {
    const { at, normal, bias } = plane;
    if (planeDistance(plane, ...eye) <= bias) return null;
    return { view: reflectedView(matrix, plane), equation: [...normal, -dot(at, normal)], bias };
  }

  return { planeDistance, reflectedView, captureView };
})();
if (typeof module !== 'undefined') module.exports = ReflectionPlane;
