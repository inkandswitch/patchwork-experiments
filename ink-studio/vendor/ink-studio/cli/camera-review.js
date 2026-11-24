const { render, grid, upscale } = require('./render.js');

function cameraReview(world, { width = 160, height = 96, from = 0, to = from, frames = 1, columns = 4, scale = 1,
  view = {}, pose } = {}) {
  const int = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
  const rows = Math.ceil(frames / columns);
  if (!int(width,1,2048) || !int(height,1,2048) || !int(frames,1,60) || !int(columns,1,12) || !int(scale,1,8) ||
    !Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from ||
    (width+4)*(height+4)*rows*Math.min(columns,frames)*scale*scale > 32e6)
    throw new RangeError('Invalid camera review range, dimensions or pixel budget');
  const images = [], samples = [];
  for (let i = 0; i < frames; i++) {
    const time = frames === 1 ? from : from + (to-from)*(i/(frames-1));
    pose?.(world, time);
    const image = render(world, {
      ...view, t: time, w: width, h: height, px: 1, cameraGuides: view.cameraGuides ?? true,
      cameraStaging: (view.cameraStaging ?? world.look?.cameraStaging) || true
    });
    samples.push({ time, ...image.cameraStaging });
    images.push(image);
  }
  const image = grid(images, Math.min(columns, frames));
  const flagCount = samples.reduce((sum, sample) => sum + sample.subjects.filter(row => row.issues.length).length, 0);
  return { image: scale === 1 ? image : upscale(image, scale), report: { width, height, from, to, flagCount, frames: samples } };
}

module.exports = { cameraReview };
