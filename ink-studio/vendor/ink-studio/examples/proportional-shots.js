const studio = require('..');
const facade = require('./proportional-facade.js');

module.exports = toolkit => ({
  id: 'proportional-shots',
  name: 'Phi Exchange camera study',
  seed: 31,
  build(seed) {
    const { KIT: K } = toolkit;
    const world = facade(toolkit).build(seed);
    const { phi, subdivide, pixelRect } = K.procedural.proportions;
    const ratio = seed % 2 ? 1.85 : phi;
    const width = 450, height = 270;
    const layout = subdivide({ min: [9, 33], max: [441, 251] }, { ratio, depth: 2, gap: 6 });
    const cameras = [
      { name: 'FRONT ELEVATION', target: [0, 2.60, .12], dist: 14.7, fov: .57, pitch: .09, yaw: -.045 },
      { name: 'SIGN DETAIL', target: [-1.48, 2.88, .71], dist: 7.0, fov: .58, pitch: -.03, yaw: .10 },
      { name: 'INTAKE DETAIL', target: [2.4, 1.60, .72], dist: 5.4, fov: .55, pitch: .10, yaw: -.18 }
    ];
    const ink = [
      { type: 'rect', rect: [0, 0, width, height], color: '#142126' },
      { type: 'rect', rect: [9, 25, 432, 1], color: '#667e76' },
      { type: 'text', text: 'PHI EXCHANGE - CAMERA STUDY', at: [103, 16], size: 7, width: 1, color: '#f5ca87' },
      { type: 'text', text: seed % 2 ? 'CUSTOM 1.85 TO 1' : 'GOLDEN 1.618 TO 1',
        at: [382, 16], size: 7, width: 1, color: '#a8c4b3' }
    ];
    const views = layout.leaves.map((leaf, i) => {
      const [x, y, w, h] = pixelRect(leaf.bounds);
      const { name, ...camera } = cameras[i];
      ink.push(
        { type: 'rect', rect: [x - 1, y - 1, w + 2, h - 9], color: '#54716e' },
        { type: 'text', text: name, at: [x + w / 2, y + h], size: 6, width: .9, color: '#b2c7b9' }
      );
      return {
        id: leaf.path.join('-'), rect: [x, y, w, h - 11], fps: 16,
        frame: ({ time }) => {
          const angle = time * Math.PI / 2;
          return { camera: { ...camera, yaw: camera.yaw + [.10, -.16, .14][i] * Math.sin(angle),
            pitch: camera.pitch + .032 * Math.cos(angle) } };
        }
      };
    });
    const atlas = studio.createCameraAtlas({ width, height, views });
    const plan = K.frameComposite.prepare({ layers: [{ draw: ink }] }, width, height);
    const [chrome] = K.frameComposite.layers(plan, world, 0);
    world.look = { ...world.look, composite: {
      layers: [{ source: { w: width, h: height, rgba: chrome.data } }, atlas.layer()]
    } };
    K.stage(world).add({ update(_dt, time) { atlas.capture(world, { time }); } });
    return world;
  }
});
