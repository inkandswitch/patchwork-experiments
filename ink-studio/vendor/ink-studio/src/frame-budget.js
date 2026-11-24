// Shared rendering allocation and upload planning for WebGL and headless tools.
const FrameBudget = (() => {
  function artScale(width, height, preferred, budget, limit = 18) {
    if (budget == null) return preferred;
    if (!Number.isFinite(budget) || budget <= 0) throw new RangeError('Pixel budget must be a positive number');
    return Math.min(limit, Math.max(preferred, Math.ceil(Math.sqrt(width * height / budget))));
  }

  // Visit [start, end) runs. Nearby ranges may share an upload to reduce calls.
  // Keep dirty rows if the consumer throws before it finishes an upload.
  function uploadRows(rows, upload, gap = 0) {
    for (let start = 0; start < rows.length;) {
      if (!rows[start]) {
        start++;
        continue;
      }
      let end = start + 1;
      for (let next = end; next < rows.length && next - end <= gap; next++) {
        if (rows[next]) end = next + 1;
      }
      upload(start, end);
      rows.fill(0, start, end);
      start = end;
    }
  }

  // Contiguous groups preserve stable splat indices. Shader-driven movement or
  // an authored mutable range keeps the entire group eligible on every frame.
  function staticGroups(data, count, mutable = [], size = 128) {
    if (!Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(count) || count < 0 || count * 16 > data.length)
      throw new RangeError('Expected a positive group size and a splat count within the data');
    const groups = [];
    for (let start = 0; start < count; start += size) {
      const end = Math.min(count, start + size);
      if (mutable.some(([first, last]) => start < last && end > first)) {
        groups.push({ start, end });
        continue;
      }
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      let radius = 0, stable = true;
      for (let i = start; i < end; i++) {
        const offset = i * 16, kind = Math.round(data[offset + 11]) & 15;
        if (kind !== 0 && kind !== 1 && kind !== 4 && kind !== 7) {
          stable = false;
          break;
        }
        for (let axis = 0; axis < 3; axis++) {
          const coordinate = data[offset + axis];
          min[axis] = Math.min(min[axis], coordinate);
          max[axis] = Math.max(max[axis], coordinate);
        }
        radius = Math.max(radius, 3 * Math.sqrt(Math.max(0, data[offset + 4] + data[offset + 8] + data[offset + 10])));
      }
      groups.push(stable ? { start, end, center: min.map((v, i) => (v + max[i]) / 2),
        half: min.map((v, i) => (max[i] - v) / 2), radius } : { start, end });
    }
    return groups;
  }

  function visibleIndices(groups, clip, output, scale = 1, inset = 1.025, padding = .35) {
    const sides = [0, 1].flatMap(axis => [-1, 1].map(sign => [0, 4, 8, 12]
      .map(col => inset * clip[col + 3] + sign * clip[col + axis])));
    const normals = sides.map(([x, y, z]) => Math.hypot(x, y, z));
    let count = 0;
    for (const group of groups) {
      const { center, half, radius } = group;
      if (center && sides.some(([x,y,z,d], i) => {
        const support = Math.abs(x) * half[0] + Math.abs(y) * half[1] + Math.abs(z) * half[2];
        return x * center[0] + y * center[1] + z * center[2] + d +
          support + (radius * scale + padding) * normals[i] < 0;
      })) continue;
      for (let i = group.start; i < group.end; i++) output[count++] = i;
    }
    return count;
  }

  return { artScale, uploadRows, staticGroups, visibleIndices };
})();
if (typeof module !== 'undefined') module.exports = FrameBudget;
