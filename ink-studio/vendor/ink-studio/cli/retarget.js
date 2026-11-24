const fs = require('node:fs');
const path = require('node:path');
const { previewTimeline } = require('./animation-timeline.js');
const { writeAtlas } = require('./sprite-atlas.js');

function read(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

function save(file, value) {
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value, null, 2) + '\n');
}

function run({ K, build, pos, options: opt, view }) {
  const retarget = K.anim.retarget;
  if (opt.profiles) {
    if (pos.length) throw new Error('--profiles lists profiles without building scenes');
    process.stdout.write(JSON.stringify(retarget.profiles, null, 2) + '\n');
    return;
  }
  if (pos.length !== 2) throw new Error('Usage: ink-studio retarget <source-scene> <target-scene>');
  for (const key of ['clip', 'motion', 'profile', 'source-map', 'target-map', 'fps', 'travel', 'out', 'bake', 'preview',
    'at', 'frames', 'direction', 'w', 'h'])
    if (opt[key] === true) throw new Error('--' + key + ' needs a value');
  if (opt.clip && opt.motion) throw new Error('Choose either --clip or --motion');
  if (opt.out && opt.bake && path.resolve(opt.out) === path.resolve(opt.bake))
    throw new Error('Use separate files for --out and --bake');
  if (opt.preview) {
    const previewFiles = ['source', 'target'].flatMap(side => ['atlas.json', 'color.png', 'silhouette.png']
      .map(file => path.resolve(opt.preview, side, file)));
    if ([opt.out, opt.bake].some(file => file && previewFiles.includes(path.resolve(file))))
      throw new Error('Keep baked clips and reports separate from preview files');
  }

  const sourceWorld = build(pos[0]), targetWorld = build(pos[1]);
  const from = sourceWorld.retargetRig, to = targetWorld.retargetRig;
  if (!from?.puppet || !to?.puppet) throw new Error('Both scenes must publish world.retargetRig with a puppet');
  const source = opt['source-map'] ? { ...from, ...read(opt['source-map']), puppet: from.puppet } : from;
  const target = opt['target-map'] ? { ...to, ...read(opt['target-map']), puppet: to.puppet } : to;
  if (!opt.profile && source.profile && target.profile && source.profile !== target.profile)
    throw new Error('The scenes declare different profiles; supply a shared --profile to map them');
  const profile = opt.profile ? (Object.hasOwn(retarget.profiles, opt.profile) ? opt.profile : read(opt.profile))
    : source.profile ?? target.profile;

  const clips = from.clips ?? {}, names = Object.keys(clips);
  const selected = opt.clip ?? (names.length === 1 ? names[0] : undefined);
  const motion = opt.motion && read(opt.motion);
  if (opt.motion && (!motion?.tracks || typeof motion.tracks !== 'object'))
    throw new TypeError('--motion needs an Ink clip definition with tracks');
  const clip = opt.motion ? K.anim.clip(motion) : Object.hasOwn(clips, selected) ? clips[selected] : undefined;
  if (!clip) throw new Error('Choose --clip or --motion. Available clips: ' + (names.join(', ') || 'none'));
  const plan = retarget.create({ clip, source, target, profile, travel: opt.travel });
  const report = { sourceScene: sourceWorld.id, targetScene: targetWorld.id,
    clip: (opt.motion ? clip.id : selected) ?? null, ...plan.report() };
  const time = opt.at === undefined ? undefined : Number(opt.at);
  if (time !== undefined && (!Number.isFinite(time) || time < 0 || time > plan.duration))
    throw new RangeError('--at must be within the source clip');
  if (time !== undefined && plan.status !== 'unsupported') report.landmarks = plan.landmarks(time);
  const note = opt.preview || opt.bake;
  if (note && plan.status === 'unsupported') {
    if (opt.out) save(opt.out, report);
    else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    throw new Error('Cannot bake or preview an unsupported retarget; see the missing controls in the report');
  }

  if (opt.preview || opt.bake) {
    const baked = plan.bake({ fps: opt.fps === undefined ? undefined : Number(opt.fps) });
    report.bake = { frames: baked.frames, fps: baked.definition.fps, tracks: baked.definition.tracks.length };
    if (opt.preview) {
      const frames = time !== undefined ? 1 : Number(opt.frames ?? 12);
      const direction = Number(opt.direction ?? 0);
      const render = (world, rig, motion) => {
        const timeline = K.anim.timeline.create({ world, puppet: rig.puppet, clip: motion,
          sprite: { ...rig.sprite, fps: baked.definition.fps } });
        timeline.set({ stage: 'spline', direction, ...(time !== undefined ? { time }
          : { loop: { start: 0, end: motion.dur } }) });
        return previewTimeline(world, { timeline, frames, view,
          width: opt.w === undefined ? undefined : Number(opt.w), height: opt.h === undefined ? undefined : Number(opt.h) });
      };
      const previews = { source: render(sourceWorld, source, clip), target: render(targetWorld, target, baked.clip) };
      const dest = path.resolve(opt.preview);
      report.preview = {};
      for (const [side, atlas] of Object.entries(previews)) {
        const dir = path.join(dest, side);
        writeAtlas(dir, atlas);
        report.preview[side] = { dir, ...atlas.metadata };
      }
    }
    if (opt.bake) {
      save(opt.bake, baked.definition);
      report.bake.file = path.resolve(opt.bake);
    }
  }
  if (opt.out) save(opt.out, report);
  else process.stdout.write(JSON.stringify(report, null, 2) + '\n');
}

module.exports = { run };
