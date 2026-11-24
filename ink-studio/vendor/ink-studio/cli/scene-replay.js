const fs = require('node:fs');
const path = require('node:path');
const { write } = require('./asset-files.js');
const { frameIndex, mount } = require('../src/scene-replay.js');

const format = 'ink-studio/scene-replay';
const maxFrames = 600, maxPixels = 120_000_000, maxImagePixels = 16_777_216;
const maxReplayBytes = 128 * 1024 * 1024;
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;
const dimensions = (width, height) => [width, height].every(n => integer(n, 1, 8192)) && width * height <= maxImagePixels;

function validate(document) {
  const { version, width, height, start, fps, frames, title } = document ?? {};
  if (document?.format !== format || version !== 1 || !dimensions(width, height) ||
      !Number.isFinite(start) || !integer(fps, 1, 120) || typeof title !== 'string' ||
      !Array.isArray(frames) || !integer(frames.length, 1, maxFrames) || frames.length * width * height > maxPixels)
    throw new TypeError('Invalid Ink Studio scene replay');
  return document;
}

function pixels(data, width, height) {
  if (typeof data !== 'string' || data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data))
    throw new TypeError('Scene replay frames need base64 PNG data');
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length < 45 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== width || bytes.readUInt32BE(20) !== height)
    throw new TypeError('Scene replay PNG dimensions must match its recording');
  return bytes;
}

function readSceneReplay(file) {
  if (fs.statSync(file).size > maxReplayBytes) throw new RangeError('Scene replay exceeds the file size budget');
  const document = validate(JSON.parse(fs.readFileSync(file, 'utf8')));
  for (const frame of document.frames) pixels(frame, document.width, document.height);
  return document;
}

function sampleSceneReplay(document, seconds = 0, { loop = false } = {}) {
  const { frames, fps, start, width, height } = validate(document);
  if (!Number.isFinite(seconds)) throw new RangeError('Replay time must be finite');
  const index = frameIndex(frames.length, fps, seconds, loop);
  return { index, time: start + index / fps, width, height, png: pixels(frames[index], width, height) };
}

function embedSettings(options = {}, title = 'Ink Studio scene') {
  if (!options || typeof options !== 'object' || Array.isArray(options))
    throw new TypeError('Invalid scene embed settings');
  const settings = { title, alt: options.title ?? title, controls: true, autoplay: false, loop: true, fit: 'contain',
    pixelated: true, background: '#17212a', color: '#edf3f3', accent: '#8addc9', ...options };
  if (Object.keys(options).some(key => !['title', 'alt', 'controls', 'autoplay', 'loop', 'fit', 'pixelated', 'background', 'color', 'accent'].includes(key)) ||
      ![settings.title, settings.alt].every(value => typeof value === 'string' && value.length <= 500) ||
      ![settings.autoplay, settings.controls, settings.loop, settings.pixelated].every(value => typeof value === 'boolean') ||
      !['contain', 'cover'].includes(settings.fit) ||
      ![settings.background, settings.color, settings.accent].every(value => typeof value === 'string' &&
        /^(?:#[0-9a-f]{6}|#[0-9a-f]{3}|transparent)$/i.test(value)))
    throw new TypeError('Invalid scene embed settings');
  return settings;
}

const escapeHTML = value => value.replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const safeJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');

function embedPage(document, settings) {
  const { width, height, fps, frames } = document;
  const { title, alt, controls, autoplay, loop, fit, pixelated, background, color, accent } = settings;
  const player = frames.length > 1 && controls ? `<nav aria-label="Scene playback">
    <button type="button">Play</button>
    <input type="range" min="0" max="${frames.length - 1}" value="0" step="1" aria-label="Frame">
    <output aria-live="off"></output>
  </nav>` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHTML(title)}</title>
<style>
  * { box-sizing: border-box; }
  :root { --scene-background: ${background}; --scene-color: ${color}; --scene-accent: ${accent}; }
  body { margin: 0; font: 14px system-ui, sans-serif; color: var(--scene-color); background: var(--scene-background); }
  main { display: grid; height: 100dvh; grid-template-rows: minmax(0, 1fr) auto; }
  figure { margin: 0; min-height: 0; display: grid; overflow: hidden; }
  img { display: block; width: 100%; height: 100%; min-height: 0; object-fit: ${fit}; image-rendering: ${pixelated ? 'pixelated' : 'auto'}; }
  nav { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; padding: 9px 12px; border-top: 1px solid var(--scene-accent); }
  button { color: inherit; background: transparent; border: 1px solid var(--scene-accent); border-radius: 5px; padding: 4px 11px; font: inherit; }
  input { flex: 1 1 75px; accent-color: var(--scene-accent); }
  output { font-variant-numeric: tabular-nums; white-space: nowrap; }
  :focus-visible { outline: 2px solid var(--scene-accent); outline-offset: 2px; }
</style>
</head>
<body>
<main id="ink-scene">
  <figure><img width="${width}" height="${height}" alt="${escapeHTML(alt)}" draggable="false" src="data:image/png;base64,${frames[0]}"></figure>
  ${player}
</main>
<script id="ink-scene-recording" type="application/json">${safeJSON({ fps, frames, ...(document.simulationInputs !== undefined && {
  scene: document.scene, seed: document.seed, simulationInputs: document.simulationInputs }) })}</script>
<script>
window.inkScene = (${mount})(document.getElementById('ink-scene'),
  JSON.parse(document.getElementById('ink-scene-recording').textContent), ${safeJSON({ autoplay, loop })}, ${frameIndex});
</script>
</body>
</html>
`;
}

function writeSceneEmbed(document, { out, settings } = {}) {
  if (typeof out !== 'string' || !/\.html$/i.test(out)) throw new TypeError('Choose an .html embed filename');
  const source = validate(document), file = path.resolve(out);
  for (const frame of source.frames) pixels(frame, source.width, source.height);
  write(file, embedPage(source, embedSettings(settings, source.title)));
  return { file };
}

module.exports = { format, maxFrames, maxPixels, maxReplayBytes, dimensions, embedSettings, embedPage,
  readSceneReplay, sampleSceneReplay, writeSceneEmbed };
