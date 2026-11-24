const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const ContributionRules = require('../src/contribution-rules.js');

const sparseOffsets = [-.25, .25];
const exportOffsets = [-.375, -.125, .125, .375];

function footprint(dx, dy, k0, k1, k2, gain, hard, edge, continuous, offsets = sparseOffsets) {
  let total = 0;
  for (const v of offsets) for (const u of offsets) {
    const x = dx + u, y = dy + v;
    total += ContributionRules.alpha(-.5 * (k0 * x * x + k2 * y * y) - k1 * x * y, gain, hard, edge, continuous);
  }
  return total / (offsets.length * offsets.length);
}

function sampledDepth(ray, normal, center, depth, reach) {
  if (!normal) return depth;
  const { direction, origin, axial } = ray;
  const facing = normal[0] * direction[0] + normal[1] * direction[1] + normal[2] * direction[2];
  if (Math.abs(facing) < .025) return depth;
  const distance = (normal[0] * (center[0] - origin[0]) + normal[1] * (center[1] - origin[1]) +
    normal[2] * (center[2] - origin[2])) / facing;
  return distance > 0 ? depth + clamp(axial * distance - depth, -reach, reach) : depth;
}
module.exports = { footprint, exportOffsets, sampledDepth };
