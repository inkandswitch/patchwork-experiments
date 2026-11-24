const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const PNG = require('./png.js');

const format = 'ink-studio/reel', maxFrames = 600, maxPixels = 120_000_000;
const maxBytes = 96 * 1024 * 1024;
const bounded = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min, max) => Number.isSafeInteger(value) && bounded(value, min, max);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const sceneFile = /\.(?:js|json|obj|gltf|glb)$/i;
const escapeHTML = value => value.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const scriptJSON = value => JSON.stringify(value).replace(/</g, '\\u003c');

function check(condition, message) {
  if (!condition) throw new TypeError(message);
}

function plan(manifest, directory) {
  check(object(manifest) && (manifest.format ?? format) === format && (manifest.version ?? 1) === 1,
    'Expected an Ink Studio reel manifest');
  const { title = 'Ink Studio reel', width = 640, height = 360, pixelSize = 2, fps = 12, shots } = manifest;
  check(text(title, 120) && integer(width, 64, 1920) && integer(height, 64, 1080) &&
    integer(pixelSize, 1, 16) && width % pixelSize === 0 && height % pixelSize === 0 && integer(fps, 1, 60),
    'Invalid reel title, dimensions, pixel size or frame rate');
  check(Array.isArray(shots) && integer(shots.length, 1, 48), 'A reel needs between 1 and 48 shots');
  const cameraFlags = { target: 'target', zoom: 'zoom', pitch: 'pitch', yaw: 'yaw',
    pan: 'camera-pan', orbit: 'camera-orbit' };
  let frameCount = 0;
  const clips = shots.map((shot, i) => {
    const location = 'Reel shot ' + (i + 1);
    check(object(shot) && text(shot.scene, 1024) && !shot.scene.startsWith('--'), location + ' needs a scene');
    const { scene, label = path.basename(shot.scene).replace(sceneFile, ''), from = 0, to,
      hold, seed, camera = {} } = shot;
    const moving = to !== undefined, frames = moving ? Math.max(2, Math.round((to - from) * fps)) : 1;
    check(text(label, 160) && bounded(from, 0, 120) && (!moving || bounded(to, 0, 120) && to >= from + 1 / fps) &&
      (hold === undefined || !moving && bounded(hold, .1, 60)) &&
      (seed === undefined || Number.isSafeInteger(seed)), 'Invalid label, time or seed for ' + location);
    check(object(camera) && Object.entries(camera).every(([key, value]) =>
      Object.hasOwn(cameraFlags, key) && (key === 'target' || key === 'pan' ?
        Array.isArray(value) && value.length === 3 && value.every(Number.isFinite) : Number.isFinite(value)) &&
      (key !== 'zoom' || value > 0) && (moving || !['pan', 'orbit'].includes(key))),
    'Invalid camera for ' + location);
    const source = sceneFile.test(scene) ? path.resolve(directory, scene) : scene;
    const args = [moving ? 'clip' : 'render', source, '--w', String(width), '--h', String(height),
      '--px', String(pixelSize)];
    if (moving) args.push('--from', String(from), '--to', String(to), '--fps', String(fps));
    else args.push('--t', String(from));
    if (seed !== undefined) args.push('--seed', String(seed));
    for (const [name, value] of Object.entries(camera)) args.push('--' + cameraFlags[name], String(value));
    frameCount += frames;
    return { label, args, moving, seconds: moving ? frames / fps : hold ?? 3 };
  });
  check(frameCount <= maxFrames && frameCount * width * height <= maxPixels,
    'Reel exceeds the export budget. Shorten the ranges, lower dimensions or reduce FPS.');
  return { title, width, height, frameCount, clips };
}

function page({ title, width, height }, clips, clean) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHTML(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; background: #0b0e15; color: #edf1ff; font: 15px system-ui, sans-serif; }
  main { display: grid; grid-template-rows: minmax(0,1fr) auto; height: 100dvh; }
  figure { margin: 0; display: grid; place-items: center; min-height: 0; overflow: hidden; background: #06080c; }
  img { width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
  nav { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; padding: 10px 14px; background: #151c2a; }
  nav[hidden] { display: none; }
  button, select { color: inherit; font: inherit; background: #222d41; border: 1px solid #475774;
    border-radius: 6px; padding: 6px 10px; }
  nav span { color: #bcc8dd; margin-left: auto; }
  :focus-visible { outline: 2px solid #a3d9ff; outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <figure id="stage"><img id="shot" width="${width}" height="${height}" alt="" draggable="false"></figure>
  <nav id="controls" aria-label="Reel controls"${clean ? ' hidden' : ''}>
    <button id="prev" type="button" aria-label="Previous shot">Previous</button>
    <button id="play" type="button">Play reel</button>
    <button id="next" type="button" aria-label="Next shot">Next</button>
    <select id="select" aria-label="Shot"></select>
    <button id="clean" type="button" title="Press H or Escape to show controls">Clean view</button>
    <span>Space plays · H hides controls</span>
  </nav>
</main>
<script id="reel" type="application/json">${scriptJSON(clips)}</script>
<script>
(() => {
  const byId = id => document.getElementById(id);
  const clips = JSON.parse(byId('reel').textContent), shot = byId('shot'), select = byId('select');
  const play = byId('play'), controls = byId('controls');
  let current = 0, playing = false, finished = false, timer, movie;
  clips.forEach((clip, i) => select.add(new Option(clip.label, i)));
  function show() {
    clearTimeout(timer);
    shot.onload = null;
    if (movie) URL.revokeObjectURL(movie);
    movie = undefined;
    const clip = clips[current];
    select.value = current;
    shot.alt = clip.label;
    play.textContent = playing ? 'Stop reel' : 'Play reel';
    if (!playing) {
      shot.src = 'data:image/png;base64,' + clip.poster;
      return;
    }
    const bytes = Uint8Array.from(atob(clip.animation ?? clip.poster), c => c.charCodeAt(0));
    movie = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    shot.onload = () => {
      timer = setTimeout(() => {
        if (current + 1 < clips.length) current++;
        else { playing = false; finished = true; }
        show();
      }, clip.seconds * 1000);
    };
    shot.src = movie;
  }
  function change(step) {
    finished = false;
    current = (current + step + clips.length) % clips.length;
    show();
  }
  function toggle() {
    if (finished) current = 0;
    finished = false;
    playing = !playing;
    show();
  }
  function clean(value) {
    controls.hidden = value;
    if (!value) play.focus({ preventScroll: true });
  }
  byId('prev').onclick = () => change(-1);
  byId('next').onclick = () => change(1);
  byId('clean').onclick = () => clean(true);
  byId('stage').ondblclick = () => clean(!controls.hidden);
  select.onchange = () => { finished = false; current = Number(select.value); show(); };
  play.onclick = toggle;
  window.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
    const key = event.key.toLowerCase();
    if (key === 'h') clean(!controls.hidden);
    else if (key === 'escape' && controls.hidden) clean(false);
    else if (event.target instanceof HTMLButtonElement || event.target instanceof HTMLSelectElement) return;
    else if (key === 'arrowleft') change(-1);
    else if (key === 'arrowright') change(1);
    else if (key === ' ') toggle();
    else return;
    event.preventDefault();
  });
  show();
})();
</script>
</body>
</html>
`;
}

function write(file, manifest, { clean = false, cwd = process.cwd() } = {}) {
  const spec = plan(JSON.parse(fs.readFileSync(manifest, 'utf8')), path.dirname(path.resolve(manifest)));
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-reel-'));
  const temporary = path.join(path.dirname(file), '.ink-reel-' + randomUUID());
  let bytes = 0;
  try {
    const clips = spec.clips.map(({ label, args, seconds, moving }, i) => {
      const capture = path.join(folder, i + '.png');
      try {
        execFileSync(process.execPath, [path.join(__dirname, 'ink-studio.js'), ...args, '--out', capture],
          { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (error) {
        throw new Error('Reel shot ' + (i + 1) + ' (' + label + '): ' + (error.stderr?.toString().trim() || error.message));
      }
      const captured = fs.readFileSync(capture), image = PNG.raster(captured);
      check(image.w === spec.width && image.h === spec.height, 'Unexpected capture size for ' + label);
      const poster = moving ? PNG.encode(image.w, image.h, Uint8Array.from(image.data), 4) : captured;
      bytes += poster.length + (moving ? captured.length : 0);
      check(bytes <= maxBytes, 'Reel exceeds the file size budget. Reduce its resolution or duration.');
      return { label, seconds, poster: poster.toString('base64'),
        ...(moving && { animation: captured.toString('base64') }) };
    });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(temporary, page(spec, clips, clean));
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
    fs.rmSync(temporary, { force: true });
  }
  return { shots: spec.clips.length, frames: spec.frameCount };
}

module.exports = { write };
