/* Inspect a portable impulse definition or checkpoint at an explicit unshaken listener pose. */
const fs = require('node:fs'),
  path = require('node:path');
module.exports = (pos, opt, { CameraImpulses: I, CameraLens: L }) => {
  if (!pos[0]) throw new Error('camera-impulses needs a definition or checkpoint JSON file');
  const input = JSON.parse(fs.readFileSync(path.resolve(pos[0]), 'utf8')),
    engine = input.format === 'ink-studio/camera-impulses' ? I.restore(input) : I.create(input),
    eye = opt.eye === undefined ? [0, 0, 0] : String(opt.eye).split(',').map(Number),
    yaw = Number(opt.yaw ?? 0),
    pitch = Number(opt.pitch ?? 0),
    time = Number(opt.at ?? 0);
  if (![yaw, pitch, time].every(Number.isFinite))
    throw new Error('camera-impulses needs finite --at, --yaw and --pitch values');
  const c = Math.cos(yaw),
    s = Math.sin(yaw),
    cp = Math.cos(pitch),
    sp = Math.sin(pitch),
    pose = L.pose({ eye, right: [c, 0, -s], up: [-sp * s, cp, -sp * c], back: [cp * s, sp, cp * c] }),
    frame = engine.sample(time, { pose }),
    report = { ...frame, listener: pose, pose: L.applyMotion(pose, frame) };
  const json = JSON.stringify(report, null, 2) + '\n';
  if (opt.out) {
    const out = path.resolve(opt.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, json);
    console.log('wrote ' + out);
  } else console.log(json.trimEnd());
};
