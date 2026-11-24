const os = require('node:os');
const core = require('../index.js');
const { parity, profile, samples, buildFixture } = require('./look-renderer-fixtures.js');
const runWebGL = require('./look-webgl.js');

const host = { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model };

function runFixtures(kit, build, open, { fixtures, width, height, points, frames, warmup, splats, batch = 1 }) {
  const view = { ortho: true, colored: false, dither: 0, outline: false };
  if (points) {
    const backend = open(width, height, view);
    try {
      const cases = fixtures.map(fixture => {
        const world=build(kit,fixture);
        backend.draw(world);
        const ray={origin:[-.8,0,5],direction:[0,0,-1],maxDistance:10};
        return { id:fixture.id,colors:backend.sample(points),...(fixture.glass&&{pick:backend.pick(world,ray)}) };
      });
      return { driver: backend.driver, cases };
    } finally {
      backend.close();
    }
  }
  let driver;
  const ms = value => Math.round(value * 1000) / 1000;
  const cases = fixtures.map(fixture => {
    const start = performance.now();
    const world = build(kit, fixture, splats);
    const fixtureMs = ms(performance.now() - start);
    const beforeInit = performance.now();
    const backend = open(width, height, view);
    const initMs = ms(performance.now() - beforeInit);
    driver = backend.driver;
    try {
      const beforeFirst = performance.now();
      backend.draw(world);
      backend.fence?.();
      const firstFrameMs = ms(performance.now() - beforeFirst);
      for (let i = 0; i < warmup; i++) backend.draw(world);
      backend.fence?.();
      const times = [];
      let measured = 0;
      for (let done = 0; done < frames; done += batch) {
        const count = Math.min(batch, frames - done), before = performance.now();
        for (let i = 0; i < count; i++) backend.draw(world);
        backend.fence?.();
        const elapsed = performance.now() - before;
        measured += elapsed;
        times.push(elapsed / count);
      }
      times.sort((a, b) => a - b);
      const percentile = p => ms(times[Math.ceil(times.length * p) - 1]);

      // Time construction of the shared look plan separately from the actual render calls.
      // Use a fresh look definition so LUT preparation and target assignment start uncached.
      const planWorld = build(kit, fixture, splats);
      const { PixelLook } = kit;
      const beforePlan = performance.now();
      const grade = PixelLook.colorGrade(planWorld.pal, planWorld.paletteRoles, null, false, false, planWorld.look.colorLut);
      if (grade) PixelLook.gradePalette(grade);
      const plan = PixelLook.preparePaletteConstraints(planWorld.look.paletteConstraints, { palette: planWorld.pal });
      if (plan) plan.slots(planWorld);
      const lookPlanMs = ms(performance.now() - beforePlan);

      return { id: fixture.id, splats: world.count, setupMs: { fixture: fixtureMs, renderer: initMs,
        firstFrame: firstFrameMs, lookPlan: lookPlanMs },
        frameMs: { min: ms(times[0]), p50: percentile(.5), p95: percentile(.95), max: ms(times.at(-1)),
          mean: ms(measured / frames) } };
    } finally {
      backend.close();
    }
  });
  return { driver, batch, samples: Math.ceil(frames / batch), cases };
}

function headlessBackend(width, height, view) {
  let frame;
  return {
    draw(world) { frame = core.render(world, { ...view, w: width, h: height, px: 1 }); },
    pick(world,ray) { return core.createSplatPicker(world).ray(ray); },
    sample(points) {
      return Object.fromEntries(Object.entries(points).map(([name, [x, y]]) => {
        const i = (y * frame.w + x) * 3;
        return [name, Array.from(frame.rgb.slice(i, i + 3))];
      }));
    },
    close() {}
  };
}

function error(a, b) {
  return Math.max(...a.map((value, i) => Math.abs(value - b[i])));
}

function checkParity(options) {
  const inputs = { fixtures: parity, width: 120, height: 80, points: samples };
  const cpu = runFixtures(core.load(), buildFixture, headlessBackend, inputs);
  const gpu = runWebGL(options, buildFixture, runFixtures, inputs);
  const cases = parity.map(({ id, gap, expected, tolerance = 0 }, i) => {
    const checks = Object.fromEntries(Object.entries(samples).map(([name, at]) => {
      const headless = cpu.cases[i].colors[name], webgl = gpu.cases[i].colors[name];
      return [name, { at, headless, webgl, maxChannelError: error(headless, webgl) }];
    }));
    const matched = Object.entries(checks).every(([name, check]) => {
      if (gap?.sample === name) return true;
      const reference = expected?.[name];
      return check.maxChannelError <= tolerance &&
        (!reference || [check.headless, check.webgl].every(rgb => error(rgb, reference) <= tolerance));
    });
    let status = matched ? 'passed' : 'failed';
    let limitation;
    if (gap) {
      const check = checks[gap.sample];
      const controlIndex = parity.findIndex(fixture => fixture.id === gap.control);
      const headless = cpu.cases[controlIndex].colors[gap.sample], webgl = gpu.cases[controlIndex].colors[gap.sample];
      const headlessChange = error(headless, check.headless), webglChange = error(webgl, check.webgl);
      limitation = { ...gap, headlessChange, webglChange };
      if (!matched || headlessChange <= tolerance || error(check.headless, expected[gap.sample]) > tolerance)
        status = 'failed';
      else if (check.maxChannelError <= tolerance) status = 'passed';
      else status = webglChange <= tolerance ? 'known-gap' : 'failed';
    }
    let pick;
    if (cpu.cases[i].pick) {
      const headless=cpu.cases[i].pick,webgl=gpu.cases[i].pick;
      pick={headless,webgl,matched:JSON.stringify(headless)===JSON.stringify(webgl)};
      if(!pick.matched)status='failed';
    }
    return { id, status, tolerance, ...(expected && { expected }), ...(limitation && { limitation }), samples:checks, ...(pick&&{pick}) };
  });
  const summary = { passed: 0, knownGaps: 0, failed: 0 };
  for (const { status } of cases) summary[status === 'known-gap' ? 'knownGaps' : status]++;
  return { format: 'ink-studio/look-parity', version: 1, ...host, browser: gpu.browser, driver: gpu.driver,
    width: inputs.width, height: inputs.height, strict: options.strict === true,
    ok: !summary.failed && (!options.strict || !summary.knownGaps), summary, cases };
}

function integer(options, key, fallback, min, max) {
  const input = options[key];
  if (input === undefined) return fallback;
  const value = Number(input);
  if (typeof input !== 'string' || !/^\d+$/.test(input) || !Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError('--' + key + ' expects an integer from ' + min + ' to ' + max);
  return value;
}

function benchmark(options) {
  const renderer = options.renderer ?? 'headless';
  if (!['headless', 'webgl', 'both'].includes(renderer)) throw new Error('--renderer needs headless, webgl or both');
  if (renderer === 'headless' && (options.chrome !== undefined || options.hardware || options.batch !== undefined))
    throw new Error('--chrome, --hardware and --batch require --renderer webgl or both');
  const inputs = { fixtures: profile, width: integer(options, 'w', 160, 1, 1024),
    height: integer(options, 'h', 100, 1, 1024), frames: integer(options, 'frames', 60, 1, 120),
    warmup: integer(options, 'warmup', 5, 0, 60), splats: integer(options, 'splats', 256, 2, 10000) };
  const { width, height, frames, warmup, splats } = inputs;
  const results = {};
  if (renderer !== 'webgl') results.headless = runFixtures(core.load(), buildFixture, headlessBackend, inputs);
  if (renderer !== 'headless') {
    // Batch timings on WebGL so fast frames can exceed the browser clock's resolution.
    const batch = integer(options, 'batch', Math.min(frames, 4), 1, frames);
    results.webgl = runWebGL(options, buildFixture, runFixtures, { ...inputs, batch });
  }
  for (const { cases } of Object.values(results)) {
    const baseline = cases[0];
    for (const entry of cases) {
      const delta = (a, b) => Number((a - b).toFixed(3));
      entry.deltaMs = {
        lookPlan: delta(entry.setupMs.lookPlan, baseline.setupMs.lookPlan),
        p50Frame: delta(entry.frameMs.p50, baseline.frameMs.p50),
        meanFrame: delta(entry.frameMs.mean, baseline.frameMs.mean)
      };
    }
  }
  return { format: 'ink-studio/look-profile', version: 1, ...host, width, height, frames, warmup, splats, results };
}

async function run(mode, options) {
  const allowed = ['out', 'chrome', 'hardware', ...(mode === 'parity' ? ['strict'] :
    ['renderer', 'w', 'h', 'frames', 'warmup', 'splats', 'batch'])];
  for (const [name, value] of Object.entries(options)) {
    if (!allowed.includes(name) || (['hardware', 'strict'].includes(name) ? value !== true : typeof value !== 'string'))
      throw new TypeError('Invalid option --' + name + ' for look ' + mode);
  }
  const result = mode === 'parity' ? checkParity(options) : benchmark(options);
  await require('./look.js').report(result, options);
  if (result.ok === false) process.exitCode = 1;
}

module.exports = { run };
