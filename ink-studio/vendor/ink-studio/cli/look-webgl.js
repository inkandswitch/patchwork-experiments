const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

function runWebGL({ chrome, hardware }, buildFixture, runFixtures, inputs) {
  const executable = chrome || process.env.INK_TEST_CHROME || [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].find(file => fs.existsSync(file)) || 'google-chrome';
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ink-look-webgl-'));
  try {
    fs.writeFileSync(path.join(temp, 'bundle.js'), require('../index.js').bundle());
    const page = path.join(temp, 'index.html');
    const renderer = pathToFileURL(path.resolve(__dirname, '../webgl.mjs')).href;
    fs.writeFileSync(page, `<!doctype html><pre id="result">pending</pre>
<script src="bundle.js"></script>
<script type="module">
import { createRenderer, createCameraAtlas } from ${JSON.stringify(renderer)};
const result = document.querySelector('#result');
try {
  const kit = { KIT, PixelLook, makeBuilder, makeSculpt, ContributionRules, RenderStages };
  const cases = (${runFixtures.toString()})(kit, ${buildFixture.toString()},
    (${browserBackend.toString()})(kit, createRenderer, createCameraAtlas), ${JSON.stringify(inputs)});
  result.textContent = encodeURIComponent(JSON.stringify({ ...cases, browser: navigator.userAgent }));
} catch (error) {
  result.textContent = encodeURIComponent(JSON.stringify({ error: error.stack ?? error.message }));
}
</script>`);
    const software = hardware ? [] : ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'];
    const html = execFileSync(executable, ['--headless', '--no-first-run', '--disable-background-networking',
      '--allow-file-access-from-files', ...software,
      '--user-data-dir=' + path.join(temp, 'profile'), '--dump-dom', pathToFileURL(page).href],
    { timeout: 120000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const output = /<pre id="result">([^<]*)<\/pre>/.exec(html)?.[1];
    if (!output || output === 'pending') throw new Error('Chrome did not complete the WebGL fixture page');
    const result = JSON.parse(decodeURIComponent(output));
    if (result.error) throw new Error(result.error);
    return result;
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('A Chrome or Chromium executable is required. Set --chrome or INK_TEST_CHROME.');
    throw error;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function browserBackend(kit, createRenderer, createCameraAtlas) {
  return (width, height, view) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const renderer = createRenderer(canvas, { toolkit: kit });
    const gl = canvas.getContext('webgl2');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const driver = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    const pixel = new Uint8Array(4);
    let target, texture;
    if (view?.offscreen) {
      texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
      const framebuffer = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
        throw new Error('WebGL test framebuffer is incomplete');
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      target = { width, height, framebuffer };
    }
    function read() {
      if (target) gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
      const pixels = new Uint8Array(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const error = gl.getError();
      if (error !== gl.NO_ERROR) throw new Error('WebGL readback failed with error ' + error);
      return pixels;
    }
    return {
      driver,
      cameraAtlas(definition) { return createCameraAtlas(canvas, { toolkit: kit, ...definition }); },
      draw(world, overrides) { renderer.render(world, { changedRows:[], target, ...view,...overrides }); },
      fence() { gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel); },
      pick(world, ray, frame) { return renderer.pick(world,ray,frame); },
      sample(points) {
        const pixels = read();
        return Object.fromEntries(Object.entries(points).map(([name, [x, y]]) => {
          const offset = ((height - 1 - y) * width + x) * 4;
          return [name, Array.from(pixels.subarray(offset, offset + 3))];
        }));
      },
      image() {
        const data = read();
        let rgb = '';
        for (let y = height-1; y >= 0; y--) for (let x = 0; x < width; x++) {
          const p = 4*(y*width+x);
          rgb += String.fromCharCode(data[p],data[p+1],data[p+2]);
        }
        return btoa(rgb);
      },
      close() {
        renderer.dispose();
        if (target) {
          gl.deleteFramebuffer(target.framebuffer);
          gl.deleteTexture(texture);
        }
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    };
  };
}

module.exports = runWebGL;
