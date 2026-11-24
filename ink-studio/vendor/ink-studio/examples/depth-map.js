// An original relief with a co-registered colour raster. Use this scene with ink-studio render or turn.
function input() {
  const width = 126,
    height = 102;
  const depth = new Float32Array(width * height);
  const data = new Uint8Array(width * height * 3);
  const tones = [
    [18, 40, 56],
    [31, 67, 83],
    [48, 101, 111],
    [76, 145, 141],
    [150, 181, 139],
    [221, 188, 131],
    [248, 221, 164]
  ];
  for (let r = 0; r < height; r++)
    for (let c = 0; c < width; c++) {
      const x = (c - (width - 1) / 2) / (width * 0.5);
      const y = ((height - 1) / 2 - r) / (height * 0.5);
      const outline = Math.hypot(x / 0.9, y / 0.84);
      if (outline > 1) continue;
      const mountain = (cx, cy, sx, sy) => Math.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2));
      const form = 0.67 * mountain(-0.29, 0.14, 0.37, 0.35) + 0.92 * mountain(0.3, -0.06, 0.45, 0.55);
      const ripple = 0.035 * Math.sin(18 * x + 5 * Math.cos(8 * y)) * Math.cos(11 * y);
      const relief = Math.max(0, (form + ripple) * Math.min(1, (1 - outline) * 8));
      const band = Math.min(6, Math.floor(relief * 7.7));
      const i = r * width + c;
      depth[i] = 2.1 - relief * 0.93;
      data.set(tones[band], i * 3);
    }
  return { width, height, depth, image: { width, height, data }, camera: { type: 'orthographic', height: 2.1 } };
}

module.exports = ({ KIT: K }) => ({
  id: 'depth-map-example',
  name: 'Contour relief',
  seed: 1,
  build() {
    return K.depth.fromMap(input()).world({ background: 0x161d26 });
  }
});
module.exports.input = input;
